import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parse } from 'csv-parse';
import RBush from 'rbush';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { BboxEntry, InegiFeature, Municipio } from './inegi.types';

/**
 * Singleton that loads all INEGI geospatial data into memory once at boot.
 *
 * Reads 4 GeoJSONs (asentamientos + municipios for Colima and Jalisco),
 * builds two independent R-tree bbox indexes for fast candidate lookup,
 * and parses the AGEEML catalog into a Map for CVE → nombre joins.
 *
 * The data root is resolved from the `INEGI_DATA_ROOT` env var when present,
 * otherwise it falls back to `<cwd>/data`. This keeps the service portable
 * across Docker, CI, tests, and different `outDir` settings.
 */
@Injectable()
export class InegiLoaderService implements OnModuleInit {
  private readonly logger = new Logger(InegiLoaderService.name);

  // Populated in onModuleInit before any consumer uses them. Readonly so
  // downstream services cannot mutate the loaded indexes by accident.
  public readonly features!: InegiFeature[];
  public readonly tree!: RBush<BboxEntry>;
  public readonly munFeatures!: InegiFeature[];
  public readonly munTree!: RBush<BboxEntry>;
  public readonly municipios!: Map<string, Municipio>;

  // Resolve the data root from env var first so the service stays portable.
  // At runtime the default `<cwd>/data` matches what `preprocess.sh` produces.
  private readonly dataRoot: string =
    process.env.INEGI_DATA_ROOT ?? path.resolve(process.cwd(), 'data');

  async onModuleInit(): Promise<void> {
    const asSources = [
      { state: 'Colima', path: path.resolve(this.dataRoot, 'geojson/06as.geojson') },
      { state: 'Jalisco', path: path.resolve(this.dataRoot, 'geojson/14as.geojson') },
    ];
    const munSources = [
      { state: 'Colima', path: path.resolve(this.dataRoot, 'geojson/06mun.geojson') },
      { state: 'Jalisco', path: path.resolve(this.dataRoot, 'geojson/14mun.geojson') },
    ];

    const { features, tree } = await this.loadFeatureSet(asSources, 'polygons');
    const { features: munFeatures, tree: munTree } = await this.loadFeatureSet(
      munSources,
      'mun polygons',
    );

    // Assign via `as` to bypass the `readonly` guard: these are only written
    // once here, during module init, before any consumer touches them.
    (this as { features: InegiFeature[] }).features = features;
    (this as { tree: RBush<BboxEntry> }).tree = tree;
    (this as { munFeatures: InegiFeature[] }).munFeatures = munFeatures;
    (this as { munTree: RBush<BboxEntry> }).munTree = munTree;
    (this as { municipios: Map<string, Municipio> }).municipios =
      await this.loadMunicipios();

    this.logger.log(
      `Total polygons indexed: ${features.length} asentamientos, ${munFeatures.length} municipios`,
    );
  }

  /** Reads each GeoJSON, indexes features by bbox, and loads a single RBush. */
  private async loadFeatureSet(
    sources: { state: string; path: string }[],
    label: string,
  ): Promise<{ features: InegiFeature[]; tree: RBush<BboxEntry> }> {
    const features: InegiFeature[] = [];
    const items: BboxEntry[] = [];

    for (const { state, path: filePath } of sources) {
      const fc = await this.readJsonFile<FeatureCollection<Polygon | MultiPolygon>>(
        filePath,
      );
      this.logger.log(`Loaded ${fc.features.length} ${label} from ${state}`);

      for (const feature of fc.features) {
        if (!feature?.geometry) continue;
        const id = features.length;
        const typed = feature as InegiFeature;
        typed.id = id;
        features.push(typed);
        items.push({ ...this.computeBbox(typed.geometry), id });
      }
    }

    const tree = new RBush<BboxEntry>();
    tree.load(items);
    return { features, tree };
  }

  /**
   * Reads and parses a JSON file. Wraps any read/parse error with the full
   * file path so failures at boot point at the exact offending file.
   */
  private async readJsonFile<T>(filePath: string): Promise<T> {
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new Error(
        `Failed loading ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Computes an axis-aligned bbox over a Polygon or MultiPolygon.
   * MultiPolygon requires iterating all child polygons (not just the first one).
   */
  private computeBbox(geometry: Polygon | MultiPolygon): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const visit = (coords: number[][]): void => {
      for (const [x, y] of coords) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    };

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) visit(ring);
    } else {
      for (const poly of geometry.coordinates) {
        for (const ring of poly) visit(ring);
      }
    }

    return { minX, minY, maxX, maxY };
  }

  /** Parses AGEEML CSV into a Map keyed by `${CVE_ENT}${CVE_MUN}` (zero-padded). */
  private async loadMunicipios(): Promise<Map<string, Municipio>> {
    const csvPath = path.resolve(this.dataRoot, 'catalogs/municipios.csv');

    let raw: string;
    try {
      raw = await readFile(csvPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Failed loading ${csvPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Async parse: csv-parse's sync module would block the event loop during boot.
    const records = await new Promise<Record<string, string>[]>((resolve, reject) => {
      parse(
        raw,
        { columns: true, skip_empty_lines: true },
        (err, parsed: Record<string, string>[]) => {
          if (err) {
            reject(
              new Error(
                `Failed loading ${csvPath}: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
            return;
          }
          resolve(parsed);
        },
      );
    });

    const map = new Map<string, Municipio>();
    for (const row of records) {
      const cveEnt = String(row.CVE_ENT).padStart(2, '0');
      const cveMun = String(row.CVE_MUN).padStart(3, '0');
      map.set(`${cveEnt}${cveMun}`, {
        nom_ent: row.NOM_ENT,
        nom_abr: row.NOM_ABR,
        nom_mun: row.NOM_MUN,
        nom_cab: row.NOM_CAB,
      });
    }
    this.logger.log(`Loaded ${map.size} municipios from catalog`);
    return map;
  }
}
