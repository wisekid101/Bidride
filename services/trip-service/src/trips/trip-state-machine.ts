import { BadRequestException } from '@nestjs/common';
import { TripStatus } from '@bidride/database/generated/client';

// Valid state transitions for the trip lifecycle
const TRANSITIONS: Partial<Record<TripStatus, TripStatus[]>> = {
  [TripStatus.searching]:       [TripStatus.accepted, TripStatus.cancelled],
  [TripStatus.accepted]:        [TripStatus.driver_en_route, TripStatus.driver_arrived, TripStatus.cancelled],
  [TripStatus.driver_en_route]: [TripStatus.driver_arrived, TripStatus.cancelled],
  [TripStatus.driver_arrived]:  [TripStatus.in_progress, TripStatus.no_show],
  [TripStatus.in_progress]:     [TripStatus.completed, TripStatus.cancelled],
  // Terminal states — no further transitions
  [TripStatus.completed]:       [],
  [TripStatus.cancelled]:       [],
  [TripStatus.no_show]:         [],
};

export function assertValidTransition(current: TripStatus, next: TripStatus): void {
  const allowed = TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new BadRequestException({
      code: 'TRIP_INVALID_STATE',
      message: `Cannot transition trip from '${current}' to '${next}'.`,
    });
  }
}

export function isTerminal(status: TripStatus): boolean {
  const terminals: TripStatus[] = [TripStatus.completed, TripStatus.cancelled, TripStatus.no_show];
  return terminals.includes(status);
}

export function isNightRide(requestedAt: Date): boolean {
  const hour = requestedAt.getHours();
  return hour >= 22 || hour < 5;
}
