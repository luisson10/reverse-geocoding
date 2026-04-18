import { IsNumber, Max, Min } from 'class-validator';

/**
 * Input body for POST /reverse-geocode.
 * Validated by the global ValidationPipe; invalid payloads become HTTP 400.
 */
export class ReverseGeocodeRequestDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}
