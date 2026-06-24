import { BadRequestException } from '@nestjs/common';
import { BidStatus } from '@bidride/database/generated/client';

export const MAX_COUNTER_ROUNDS = 2;
export const BID_TTL_SECONDS = 120;
export const COUNTER_TTL_SECONDS = 90;
// Rider may bid no lower than 65% of the standard fare
export const BID_FLOOR_RATE = 0.65;

const TRANSITIONS: Partial<Record<BidStatus, BidStatus[]>> = {
  [BidStatus.pending]:   [BidStatus.accepted, BidStatus.declined, BidStatus.countered, BidStatus.expired, BidStatus.withdrawn],
  [BidStatus.countered]: [BidStatus.accepted, BidStatus.declined, BidStatus.expired, BidStatus.withdrawn],
  [BidStatus.accepted]:  [],
  [BidStatus.declined]:  [],
  [BidStatus.expired]:   [],
  [BidStatus.withdrawn]: [],
};

export function assertValidBidTransition(current: BidStatus, next: BidStatus): void {
  const allowed = TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new BadRequestException({
      code: 'BID_INVALID_TRANSITION',
      message: `Cannot transition bid from '${current}' to '${next}'.`,
    });
  }
}

export function isBidTerminal(status: BidStatus): boolean {
  return ([
    BidStatus.accepted,
    BidStatus.declined,
    BidStatus.expired,
    BidStatus.withdrawn,
  ] as BidStatus[]).includes(status);
}
