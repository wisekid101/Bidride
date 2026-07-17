/**
 * Centralized, pure distance utilities for the trip / earnings-floor pipeline.
 *
 * There is ONE great-circle formula here (centralAngleRadians); the mile and
 * meter helpers only multiply it by their radius. Route-distance sanitization
 * and effective-distance selection also live here so the completion path and
 * the earnings-floor service can never diverge.
 *
 * None of these functions touch the database or any service. None of them
 * write Trip.actualDistanceMiles, which is reserved for a future verified
 * GPS-measured distance (source 'actual').
 */

/** Source of the distance value the earnings floor actually used. */
export type DistanceSource = 'actual' | 'route' | 'haversine';

export interface EffectiveDistance {
  miles: number;
  /** null when no valid distance source exists (floor uses duration + base). */
  source: DistanceSource | null;
}

export const EARTH_RADIUS_MILES = 3958.8;
export const EARTH_RADIUS_METERS = 6371000;

/**
 * The single great-circle formula: central angle (radians) between two
 * lat/lng points. Every haversine in this service derives from this.
 */
function centralAngleRadians(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Great-circle distance in miles (unrounded). */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return EARTH_RADIUS_MILES * centralAngleRadians(lat1, lng1, lat2, lng2);
}

/** Great-circle distance in meters (unrounded). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return EARTH_RADIUS_METERS * centralAngleRadians(lat1, lng1, lat2, lng2);
}

/**
 * Sanitize a route-distance value (miles) for storage / calculation.
 * - Missing is not zero: Number(null) and Number('') both coerce to 0, which
 *   would silently invent a zero-distance trip. Reject them up front.
 * - Rejects only impossible values: negative, NaN, Infinity, non-numeric.
 *   No business-distance limit is invented here.
 * - Zero is a VALID distance (pickup == dropoff) and is preserved.
 * - Rounds to 2dp to match the Decimal(6,2) column.
 * Returns null when the input is missing/impossible; callers MUST NOT persist
 * null as 0 for a normally-completed trip.
 */
export function sanitizeRouteDistanceMiles(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null; // NaN / Infinity / non-numeric
  if (n < 0) return null; // negative distance is impossible
  return Math.round(n * 100) / 100; // 2dp, matching Decimal(6,2)
}

/**
 * Deterministic pickup->dropoff haversine distance, validated and sanitized.
 * - Returns null when any of the four coordinates is missing/non-finite.
 * - Returns 0 when pickup == dropoff (a legitimate zero-distance trip).
 * - Otherwise returns a sanitized 2dp mileage.
 * No database or service dependency.
 */
export function haversineRouteDistanceMiles(
  pickupLat: unknown,
  pickupLng: unknown,
  dropoffLat: unknown,
  dropoffLng: unknown,
): number | null {
  const pLat = Number(pickupLat);
  const pLng = Number(pickupLng);
  const dLat = Number(dropoffLat);
  const dLng = Number(dropoffLng);
  if (![pLat, pLng, dLat, dLng].every((n) => Number.isFinite(n))) return null; // missing/invalid coords
  return sanitizeRouteDistanceMiles(haversineMiles(pLat, pLng, dLat, dLng));
}

/**
 * Select the effective trip distance for the earnings floor, honestly labeled.
 *
 * Priority (never MAX, never treat an estimate as verified actual):
 *   1. valid actualDistanceMiles  -> source 'actual'   (verified GPS distance)
 *   2. valid routeDistanceMiles   -> source 'route'    (pricing/bid estimate)
 *   3. valid pickup->dropoff haversine -> source 'haversine' (legacy fallback)
 *   4. otherwise 0                -> source null (floor is duration + base only)
 *
 * Zero is preserved as a legitimate distance at every level. The function
 * never returns NaN/Infinity: an unusable input falls through to the next
 * source, and the final fallback is a definite 0 with a null source.
 */
export function resolveEffectiveDistance(input: {
  actualDistanceMiles: unknown;
  routeDistanceMiles: unknown;
  pickupLat: unknown;
  pickupLng: unknown;
  dropoffLat: unknown;
  dropoffLng: unknown;
}): EffectiveDistance {
  const actual = sanitizeRouteDistanceMiles(input.actualDistanceMiles);
  if (actual != null) return { miles: actual, source: 'actual' };

  const route = sanitizeRouteDistanceMiles(input.routeDistanceMiles);
  if (route != null) return { miles: route, source: 'route' };

  const haversine = haversineRouteDistanceMiles(
    input.pickupLat,
    input.pickupLng,
    input.dropoffLat,
    input.dropoffLng,
  );
  if (haversine != null) return { miles: haversine, source: 'haversine' };

  return { miles: 0, source: null };
}
