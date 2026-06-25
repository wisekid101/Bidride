import {
  Controller,
  Get,
  Query,
  Param,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GeocodingService } from './geocoding.service';

@UseGuards(ThrottlerGuard)
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
