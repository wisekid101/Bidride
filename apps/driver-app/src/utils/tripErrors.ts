// Trip transition error handling.
//
// The trip-service rejects an out-of-order transition with error code
// `TRIP_INVALID_STATE` (see trip-service trip-state-machine). This most often
// means the trip is ALREADY in (or past) the target state — e.g. the driver
// tapped Arrived/Start, the app reloaded, and the tap is retried. In that case
// the recovery path is to advance the UI, not to show a hard error.
//
// NOTE: the client previously checked the wrong code (`TRIP_INVALID_TRANSITION`),
// which the server never emits, so the recovery path never ran. Keep this in
// one place so both driver screens stay correct.
export const TRIP_ALREADY_ADVANCED_CODE = 'TRIP_INVALID_STATE';

export function isAlreadyAdvancedError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === TRIP_ALREADY_ADVANCED_CODE;
}
