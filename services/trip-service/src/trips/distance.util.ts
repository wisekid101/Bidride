/**
 * Route-distance helper for the earnings-floor distance-persistence fix
 * (Commit 1). Sanitizes an ESTIMATED route distance for storage in
 * Trip.routeDistanceMiles. It never touches Trip.actualDistanceMiles, which is
 * reserved for a future verified GPS distance.
 */

/**
 * Sanitize a route-distance estimate (miles) for persistence into
 * Trip.routeDistanceMiles (Decimal(6,2)).
 * - Rejects only impossible values: negative, NaN, Infinity, non-numeric.
 *   No business-distance limit is invented here.
 * - Zero is a VALID distance (pickup == dropoff) and is preserved.
 * - Rounds to 2dp to match the Decimal(6,2) column.
 * Returns null when the input is missing/impossible; callers MUST NOT persist
 * null as 0 for a normally-completed trip.
 */
export function sanitizeRouteDistanceMiles(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null; // NaN / Infinity / undefined / non-numeric
  if (n < 0) return null; // negative distance is impossible
  return Math.round(n * 100) / 100; // 2dp, matching Decimal(6,2)
}
