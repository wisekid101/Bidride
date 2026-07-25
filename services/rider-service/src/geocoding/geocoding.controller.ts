import {
  Controller,
  Get,
  Query,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

// S0-B3A: ThrottlerGuard now runs globally (APP_GUARD); the redundant
// controller-level guard (the only guard here) is removed to avoid a second
// execution. Throttling still applies via the global guard at the module default.
@Controller('geocode')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get('autocomplete')
  autocomplete(
    @Query('query') query: string,
    @Query('sessionToken') sessionToken?: string,
  ) {
    if (!query) throw new BadRequestException('query is required');
    return this.geocoding.autocomplete(query, sessionToken);
  }

  @Get('place/:placeId')
  getPlaceCoordinates(@Param('placeId') placeId: string) {
    return this.geocoding.getPlaceCoordinates(placeId);
  }

  @Get('reverse')
  reverseGeocode(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new BadRequestException('lat and lng must be valid numbers');
    }
    return this.geocoding.reverseGeocode(latNum, lngNum);
  }
}
