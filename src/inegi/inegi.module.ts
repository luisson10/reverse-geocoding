import { Module } from '@nestjs/common';
import { InegiLoaderService } from './inegi-loader.service';
import { ReverseGeocodeService } from './reverse-geocode.service';
import { ReverseGeocodeController } from './reverse-geocode.controller';

/**
 * Feature module that groups everything related to INEGI reverse geocoding:
 * the data loader singleton, the resolver service, and the HTTP controller.
 */
@Module({
  providers: [InegiLoaderService, ReverseGeocodeService],
  controllers: [ReverseGeocodeController],
  exports: [InegiLoaderService],
})
export class InegiModule {}
