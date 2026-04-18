import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, Point } from 'geojson';
import RBush from 'rbush';
import { InegiLoaderService } from './inegi-loader.service';
import {
  MatchLevel,
  ReverseGeocodeResponseDto,
} from './dto/reverse-geocode-response.dto';
import type { BboxEntry, InegiFeature, Municipio } from './inegi.types';

/**
 * Resolves a (lat, lng) WGS84 point to INEGI administrative data.
 *
 * Uses a two-tier strategy: first try the asentamiento (colonia) index;
 * if nothing contains the point, fall back to the municipio index so rural
 * points still return an answer instead of 404.
 */
@Injectable()
export class ReverseGeocodeService {
  private readonly logger = new Logger(ReverseGeocodeService.name);

  // Tracks CVE keys already warned about so we don't spam logs when the same
  // missing entry is hit on every request.
  private readonly warnedMissingKeys = new Set<string>();

  constructor(private readonly loader: InegiLoaderService) {}

  /**
   * Two-tier resolution:
   *  1) RBush bbox prefilter + Turf ray-casting against asentamientos → "asentamiento".
   *  2) Same technique against municipios → "municipio" (asen-only fields nulled).
   *  3) Neither → throws NotFoundException (HTTP 404).
   */
  resolve(lat: number, lng: number): ReverseGeocodeResponseDto {
    const pt = point([lng, lat]);

    // Tier 1: asentamiento-level match.
    const asen = this.findContaining(this.loader.tree, this.loader.features, pt);
    if (asen) return this.buildAsentamientoResponse(asen);

    // Tier 2: municipio-level fallback for rural points without colonia.
    const mun = this.findContaining(this.loader.munTree, this.loader.munFeatures, pt);
    if (mun) return this.buildMunicipioResponse(mun);

    throw new NotFoundException(
      `No INEGI polygon contains point (${lat}, ${lng})`,
    );
  }

  /**
   * Generic two-step containment check used by both tiers:
   * rbush bbox prefilter (O(log n)) followed by exact ray casting on
   * the real polygon. Returns the first feature that truly contains `pt`.
   */
  private findContaining(
    tree: RBush<BboxEntry>,
    features: InegiFeature[],
    pt: Feature<Point>,
  ): InegiFeature | null {
    const [lng, lat] = pt.geometry.coordinates;
    const candidates = tree.search({
      minX: lng,
      minY: lat,
      maxX: lng,
      maxY: lat,
    });
    for (const c of candidates) {
      const feat = features[c.id];
      if (!feat) continue;
      if (booleanPointInPolygon(pt, feat)) return feat;
    }
    return null;
  }

  private buildAsentamientoResponse(feature: InegiFeature): ReverseGeocodeResponseDto {
    const props = (feature.properties ?? {}) as unknown as Record<string, unknown>;
    const { cveEnt, cveMun, muni } = this.resolveAdmin(props);

    return new ReverseGeocodeResponseDto({
      match_level: MatchLevel.Asentamiento,
      cve_ent: cveEnt,
      nom_ent: muni?.nom_ent ?? null,
      nom_abr: muni?.nom_abr ?? null,
      cve_mun: cveMun,
      nom_mun: muni?.nom_mun ?? null,
      cve_loc: this.propOrNull(props, 'cve_loc'),
      cve_asen: this.propOrNull(props, 'cve_asen'),
      nom_asen: this.propOrNull(props, 'nom_asen'),
      tipo: this.propOrNull(props, 'tipo'),
      cp: this.propOrNull(props, 'cp'),
      cvegeo: this.propOrNull(props, 'cvegeo'),
    });
  }

  private buildMunicipioResponse(feature: InegiFeature): ReverseGeocodeResponseDto {
    const props = (feature.properties ?? {}) as unknown as Record<string, unknown>;
    const { cveEnt, cveMun, muni } = this.resolveAdmin(props);

    return new ReverseGeocodeResponseDto({
      match_level: MatchLevel.Municipio,
      cve_ent: cveEnt,
      nom_ent: muni?.nom_ent ?? null,
      nom_abr: muni?.nom_abr ?? null,
      cve_mun: cveMun,
      nom_mun: muni?.nom_mun ?? null,
      cve_loc: null,
      cve_asen: null,
      nom_asen: null,
      tipo: null,
      cp: null,
      cvegeo: this.propOrNull(props, 'cvegeo'),
    });
  }

  /**
   * Extracts `CVE_ENT` + `CVE_MUN` (zero-padded) and joins against the
   * AGEEML catalog. Warns once per missing key so data drift is visible
   * without spamming the logs.
   */
  private resolveAdmin(props: Record<string, unknown>): {
    cveEnt: string;
    cveMun: string;
    muni: Municipio | undefined;
  } {
    const cveEnt = String(this.prop(props, 'cve_ent') ?? '').padStart(2, '0');
    const cveMun = String(this.prop(props, 'cve_mun') ?? '').padStart(3, '0');
    const key = `${cveEnt}${cveMun}`;
    const muni = this.loader.municipios.get(key);
    if (!muni && !this.warnedMissingKeys.has(key)) {
      this.warnedMissingKeys.add(key);
      this.logger.warn(`AGEEML catalog missing municipio for key ${key}`);
    }
    return { cveEnt, cveMun, muni };
  }

  /**
   * ogr2ogr normally lowercases DBF field names, but some pipelines keep them
   * uppercase. Accept either to survive re-processing differences.
   */
  private prop(props: Record<string, unknown>, key: string): unknown {
    return props[key] ?? props[key.toUpperCase()] ?? null;
  }

  private propOrNull(props: Record<string, unknown>, key: string): string | null {
    const v = this.prop(props, key);
    return v == null ? null : String(v);
  }
}
