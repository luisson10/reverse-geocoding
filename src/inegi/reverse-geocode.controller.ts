import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { InegiLoaderService } from './inegi-loader.service';
import { ReverseGeocodeService } from './reverse-geocode.service';
import { ReverseGeocodeRequestDto } from './dto/reverse-geocode-request.dto';
import { ReverseGeocodeResponseDto } from './dto/reverse-geocode-response.dto';

/**
 * HTTP surface of the service.
 * Exposes /health for liveness + data counts and POST /reverse-geocode for lookups.
 */
@Controller()
export class ReverseGeocodeController {
  constructor(
    private readonly loader: InegiLoaderService,
    private readonly service: ReverseGeocodeService,
  ) {}

  /** Liveness probe + sanity check on loaded dataset sizes. */
  @Get('health')
  health(): {
    status: string;
    polygons: number;
    munPolygons: number;
    municipios: number;
  } {
    return {
      status: 'ok',
      polygons: this.loader.features.length,
      munPolygons: this.loader.munFeatures.length,
      municipios: this.loader.municipios.size,
    };
  }

  /**
   * Body is validated by the global ValidationPipe (class-validator).
   * Throws NotFoundException when no polygon contains the point — Nest maps it to 404.
   */
  // Override Nest's POST default (201) to preserve HTTP 200 parity with the Fastify version.
  @HttpCode(HttpStatus.OK)
  @Post('reverse-geocode')
  reverseGeocode(@Body() dto: ReverseGeocodeRequestDto): ReverseGeocodeResponseDto {
    return this.service.resolve(dto.lat, dto.lng);
  }
}
