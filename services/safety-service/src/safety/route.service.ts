import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface LatLng { lat: number; lng: number }

// Decode Google's encoded polyline format (Algorithm V):
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// Encode a two-point fallback polyline (start → end)
export function encodeFallbackPolyline(from: LatLng, to: LatLng): string {
  const encodeValue = (v: number): string => {
    let value = Math.round(v * 1e5);
    value = value < 0 ? ~(value << 1) : value << 1;
    let encoded = '';
    while (value >= 0x20) {
      encoded += String.fromCharCode(((0x20 | (value & 0x1f)) + 63));
      value >>= 5;
    }
    encoded += String.fromCharCode(value + 63);
    return encoded;
  };
  // Encode first point as absolute; second point as delta (polyline algo accumulates)
  return (
    encodeValue(from.lat) +
    encodeValue(from.lng) +
    encodeValue(to.lat - from.lat) +
    encodeValue(to.lng - from.lng)
  );
}

// Haversine distance in miles between two points
export function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlng = Math.sin(dLng / 2);
  const c = sinDlat * sinDlat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDlng * sinDlng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

// Minimum perpendicular distance from point P to segment AB
function pointToSegmentMiles(p: LatLng, a: LatLng, b: LatLng): number {
  const abLat = b.lat - a.lat;
  const abLng = b.lng - a.lng;
  const abLen2 = abLat * abLat + abLng * abLng;
  if (abLen2 === 0) return haversineMiles(p, a);

  // Project p onto ab, clamped to [0,1]
  const t = Math.max(0, Math.min(1, ((p.lat - a.lat) * abLat + (p.lng - a.lng) * abLng) / abLen2));
  const closest: LatLng = { lat: a.lat + t * abLat, lng: a.lng + t * abLng };
  return haversineMiles(p, closest);
}

// Minimum distance from point to polyline in miles
export function minDistanceToPolylineMiles(point: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineMiles(point, polyline[0]);

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentMiles(point, polyline[i], polyline[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Fetch and store route for a trip (fire-and-forget from trip-service via HTTP)
  async fetchAndStoreRoute(
    tripId: string,
    pickup: LatLng,
    dropoff: LatLng,
  ): Promise<void> {
    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    let encodedPolyline: string;
    let distanceMiles: number | undefined;
    let durationMin: number | undefined;
    let source = 'fallback';

    if (apiKey) {
      try {
        const url =
          `https://maps.googleapis.com/maps/api/directions/json` +
          `?origin=${pickup.lat},${pickup.lng}` +
          `&destination=${dropoff.lat},${dropoff.lng}` +
          `&key=${apiKey}`;

        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const body = await res.json() as {
            status: string;
            routes?: Array<{
              overview_polyline: { points: string };
              legs: Array<{
                distance: { value: number };
                duration: { value: number };
              }>;
            }>;
          };
          if (body.status === 'OK' && body.routes?.length) {
            const route = body.routes[0];
            encodedPolyline = route.overview_polyline.points;
            distanceMiles = route.legs.reduce((s, l) => s + l.distance.value, 0) / 1609.34;
            durationMin = Math.round(route.legs.reduce((s, l) => s + l.duration.value, 0) / 60);
            source = 'google';
          }
        }
      } catch (err) {
        this.logger.warn(`[RouteService] Google Directions failed for trip ${tripId}: ${(err as Error).message}`);
      }
    }

    // Fallback: straight-line polyline between pickup and dropoff
    if (!encodedPolyline!) {
      encodedPolyline = encodeFallbackPolyline(pickup, dropoff);
      distanceMiles = haversineMiles(pickup, dropoff);
      durationMin = Math.max(3, Math.round(distanceMiles * 2.5));
      source = 'fallback';
    }

    await this.prisma.tripRoute.upsert({
      where: { tripId },
      create: {
        tripId,
        encodedPolyline,
        distanceMiles,
        durationMin,
        source,
      },
      update: {
        encodedPolyline,
        distanceMiles,
        durationMin,
        source,
      },
    });
  }

  // Load decoded polyline for a trip — returns [] if no route stored
  async getPolyline(tripId: string): Promise<LatLng[]> {
    const route = await this.prisma.tripRoute.findUnique({ where: { tripId } }).catch(() => null);
    if (!route) return [];
    return decodePolyline(route.encodedPolyline);
  }
}
