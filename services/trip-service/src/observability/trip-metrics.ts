import { registry } from '@bidride/observability';

/**
 * Trip-domain metrics (PO-1B).
 *
 * Deliberately minimal. Full trip-lifecycle instrumentation is PO-1C; this
 * checkpoint carries only the signal the payment work depends on.
 *
 * Bid expiry is here because F2 made the sweep conditional: a bid selected for
 * expiry may lose the race to an accept, a withdraw or a decline, and the
 * difference between "expired" and "another transition won" is invisible in
 * logs at any useful volume. Identifiers stay in logs; only bounded outcomes
 * become dimensions.
 */
export const tripMetrics = {
  /**
   * Bid expiry sweep outcomes.
   * OWNER: BidsService.sweepExpiredBids, emitted AFTER the per-bid transaction
   * commits — a rollback must record nothing.
   *
   *   expired          the conditional write won; the bid is now expired
   *   transition_lost  another workflow won the race; nothing was changed
   */
  bidExpiryTotal: registry.counter(
    'bidride_bid_expiry_total',
    'Bid expiry sweep outcomes',
    {
      outcome: ['expired', 'transition_lost'],
      previous_status: ['pending', 'countered'],
    },
  ),
};
