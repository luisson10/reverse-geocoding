/** Which spatial layer produced the match. Asentamiento is preferred; municipio is the fallback. */
export enum MatchLevel {
  Asentamiento = 'asentamiento',
  Municipio = 'municipio',
}

/**
 * Response body for POST /reverse-geocode.
 *
 * Fields are `readonly` and populated via the constructor so a response,
 * once built, cannot be mutated by downstream code. When
 * `match_level === MatchLevel.Municipio`, asentamiento-specific fields
 * (cve_loc, cve_asen, nom_asen, tipo, cp) are `null` because the point fell
 * in a rural area without a delimited colonia.
 */
export class ReverseGeocodeResponseDto {
  /** Layer that matched: asentamiento (colonia) or municipio (fallback). */
  readonly match_level!: MatchLevel;

  /** 2-digit INEGI state code (e.g. "14" for Jalisco). */
  readonly cve_ent!: string;

  /** Full state name from AGEEML; null if the CVE is not in the catalog. */
  readonly nom_ent!: string | null;

  /** Abbreviated state name from AGEEML (e.g. "Jal."). */
  readonly nom_abr!: string | null;

  /** 3-digit INEGI municipio code. */
  readonly cve_mun!: string;

  /** Municipio name from AGEEML; null if the CVE is not in the catalog. */
  readonly nom_mun!: string | null;

  /** Localidad code; null on municipio-level fallback. */
  readonly cve_loc!: string | null;

  /** Asentamiento code; null on municipio-level fallback. */
  readonly cve_asen!: string | null;

  /** Asentamiento name (e.g. "CENTRO"); null on municipio-level fallback. */
  readonly nom_asen!: string | null;

  /** INEGI asentamiento type label (e.g. "COLONIA"); null on municipio-level fallback. */
  readonly tipo!: string | null;

  /** Postal code as delivered by INEGI; null on municipio-level fallback. Not validated against Correos de México. */
  readonly cp!: string | null;

  /** Geostatistical code: 13 digits for asentamiento, 5 digits for municipio. */
  readonly cvegeo!: string | null;

  /**
   * Builds an immutable response from a partial object. All fields are assigned
   * once and then frozen by the `readonly` contract — no downstream mutation.
   */
  constructor(init: ReverseGeocodeResponseDto) {
    Object.assign(this, init);
  }
}
