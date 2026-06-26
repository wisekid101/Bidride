import { Controller, Post, Body, Get } from '@nestjs/common';
import { RouteService, haversineMiles } from './route.service';
import { SafetyService } from './safety.service';

interface StoreRouteBody {
  tripId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  isNightRide: boolean;
  isAirportTrip: boolean;
}

@Controller('internal')
export class SafetyController {
  constructor(
    private readonly routeService: RouteService,
    private readonly safetyService: SafetyService,
  ) {}

  // Called by trip-service after trip creation (fire-and-forget)
  @Post('routes')
  async storeRoute(@Body() body: StoreRouteBody) {
    await this.routeService.fetchAndStoreRoute(
      body.tripId,
      { lat: body.pickupLat, lng: body.pickupLng },
      { lat: body.dropoffLat, lng: body.dropoffLng },
    );

    // Estimate distance for risk scoring
    const distanceMiles = haversineMiles(
      { lat: body.pickupLat, lng: body.pickupLng },
      { lat: body.dropoffLat, lng: body.dropoffLng },
    );

    // Fire-and-forget safety score computation
    void this.safetyService.computeAndStoreSafetyScore(body.tripId, {
      isNightRide: body.isNightRide,
      isAirportTrip: body.isAirportTrip,
      distanceMiles,
    }).catch(() => {});

    return { stored: true };
  }

  @Get('health')
  health() {
    return { ok: true };
  }
}
