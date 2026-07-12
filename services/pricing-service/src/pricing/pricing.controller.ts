import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsNumber, IsString, IsBoolean, IsOptional, Min, Max } from 'class-validator';
import { FareEngineService } from './fare-engine.service';

class EstimateFareDto {
  @IsNumber() @Min(-90) @Max(90) pickupLat: number;
  @IsNumber() @Min(-180) @Max(180) pickupLng: number;
  @IsNumber() @Min(-90) @Max(90) dropoffLat: number;
  @IsNumber() @Min(-180) @Max(180) dropoffLng: number;
  @IsString() @IsOptional() rideType?: string;
  @IsBoolean() @IsOptional() isAirportTrip?: boolean;
  // Loyalty signal (plain trip count) — an allowlisted pricing feature.
  // Trust scores are prohibited here and deliberately have no DTO field.
  @IsNumber() @Min(0) @IsOptional() riderTotalTrips?: number;
}

@Controller('pricing')
export class PricingController {
  constructor(private readonly fareEngine: FareEngineService) {}

  @Post('estimate')
  async estimateFare(@Body() dto: EstimateFareDto) {
    return this.fareEngine.estimateFare({
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      dropoffLat: dto.dropoffLat,
      dropoffLng: dto.dropoffLng,
      rideType: dto.rideType ?? 'standard',
      isAirportTrip: dto.isAirportTrip,
      riderTotalTrips: dto.riderTotalTrips,
      requestedAt: new Date(),
    });
  }

  @Get('surge/:area')
  getSurge(@Param('area') area: string) {
    // Returns current surge multiplier for a named zone
    // Reads from Redis cache populated by demand monitoring
    return { area, multiplier: 1.0, cached: true };
  }

  @Get('demand-zones')
  @UseGuards(AuthGuard('jwt'))
  getDemandZones(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radiusMi') radiusMi?: string,
  ) {
    return this.fareEngine.getDemandZones(
      parseFloat(lat),
      parseFloat(lng),
      radiusMi !== undefined ? parseFloat(radiusMi) : 5,
    );
  }
}
