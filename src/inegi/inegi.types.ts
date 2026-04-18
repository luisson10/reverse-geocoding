import type { Feature, Polygon, MultiPolygon } from 'geojson';

/**
 * Properties we read from INEGI GeoJSON features.
 * ogr2ogr lowercases DBF field names, but some pipelines keep them uppercase,
 * so consumers should use the `prop()` helper in the service to read safely.
 */
export interface InegiProperties {
  cvegeo: string;
  cve_ent: string;
  cve_mun: string;
  cve_loc?: string;
  cve_asen?: string;
  cp?: string;
  nom_asen?: string;
  tipo?: string;
}

/** A single asentamiento or municipio polygon feature in WGS84. */
export type InegiFeature = Feature<Polygon | MultiPolygon, InegiProperties>;

/** R-tree entry: bbox of a feature plus its index into the features array. */
export interface BboxEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: number;
}

/** AGEEML catalog row — canonical names for a (CVE_ENT, CVE_MUN) pair. */
export interface Municipio {
  nom_ent: string;
  nom_abr: string;
  nom_mun: string;
  nom_cab?: string;
}
