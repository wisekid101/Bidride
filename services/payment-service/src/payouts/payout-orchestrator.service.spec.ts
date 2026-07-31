import { BadRequestException } from '@nestjs/common';
import {
  PayoutOrchestratorService,
  INSTANT_PAYOUT_MIN_BALANCE,
  INSTANT_PAYOUT_DAILY_CAP,
} from './payout-orchestrator.service';

/**
 * Unit coverage for the payout orchestrator — the connection between
 * PayoutAllocationService (which owns eligibility + the DB double-pay
 * invariant) and PayoutSubmissionService (which owns the Stripe transfer).
 *
 * The orchestrator deliberately owns NO money logic of its own: it must never
 * compute a payable amount from Trip rows. Concurrency and cross-day duplicate
 * protection are proven against real Postgres in
 * payout-orchestrator.integration.spec.ts — mocks cannot prove an advisory lock
 * or a partial unique index.
 */

const REQUEST = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  driverId: 'drv-1',
  amount: 40,
  currency: 'usd',
  status: 'PAID',
  allocations: [{ id: 'alloc-1', earningLedgerId: 'led-1', amount: 40, status: 'PAID' }],
  ...over,
});

function build(over: {
  available?: number;
  todayPaid?: number;
  allocate?: jest.Mock;
  submit?: jest.Mock;
  release?: jest.Mock;
} = {}) {
  const allocation = {
    getAvailableBalance: jest.fn().mockResolvedValue(over.available ?? 40),
    allocate: over.allocate ?? jest.fn().mockResolvedValue(REQUEST()),
    releasePayoutRequest: over.release ?? jest.fn().mockResolvedValue(undefined),
  };
  const submission = {
    submitPayoutRequest: over.submit ?? jest.fn().mockResolvedValue(REQUEST()),
  };
  const prisma = {
    payoutRequest: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: over.todayPaid ?? 0 } }),
    },
  };
  const svc = new PayoutOrchestratorService(
    prisma as never,
    allocation as never,
    submission as never,
  );
  return { svc, allocation, submission, prisma };
}

describe('PayoutOrchestratorService — eligibility gates', () => {
  it('rejects below the minimum balance without allocating or submitting', async () => {
    const { svc, allocation, submission } = build({ available: INSTANT_PAYOUT_MIN_BALANCE - 0.01 });
    await expect(svc.requestInstantPayout('drv-1')).rejects.toThrow(BadRequestException);
    expect(allocation.allocate).not.toHaveBeenCalled();
    expect(submission.submitPayoutRequest).not.toHaveBeenCalled();
  });

  it('rejects when the daily cap would be exceeded, without allocating', async () => {
    const { svc, allocation } = build({ available: 100, todayPaid: INSTANT_PAYOUT_DAILY_CAP - 50 });
    await expect(svc.requestInstantPayout('drv-1')).rejects.toThrow(BadRequestException);
    expect(allocation.allocate).not.toHaveBeenCalled();
  });

  it('allows a payout that exactly reaches the daily cap', async () => {
    const { svc, allocation } = build({ available: 50, todayPaid: INSTANT_PAYOUT_DAILY_CAP - 50 });
    await svc.requestInstantPayout('drv-1');
    expect(allocation.allocate).toHaveBeenCalled();
  });
});

describe('PayoutOrchestratorService — allocation handoff', () => {
  it('allocates exactly the ledger-derived available balance in usd', async () => {
    const { svc, allocation } = build({ available: 37.5 });
    await svc.requestInstantPayout('drv-1');
    expect(allocation.getAvailableBalance).toHaveBeenCalledWith('drv-1', 'usd');
    const arg = allocation.allocate.mock.calls[0][0];
    expect(arg.amount).toBe(37.5);
    expect(arg.currency).toBe('usd');
    expect(arg.driverId).toBe('drv-1');
    expect(arg.initiatorType).toBe('driver');
    expect(arg.reason).toBeTruthy();
  });

  it('submits the allocated request by id', async () => {
    const { svc, submission } = build();
    await svc.requestInstantPayout('drv-1');
    expect(submission.submitPayoutRequest).toHaveBeenCalledWith('req-1');
  });

  it('generates a distinct idempotency key per attempt', async () => {
    const { svc, allocation } = build();
    await svc.requestInstantPayout('drv-1');
    await svc.requestInstantPayout('drv-1');
    const k1 = allocation.allocate.mock.calls[0][0].idempotencyKey;
    const k2 = allocation.allocate.mock.calls[1][0].idempotencyKey;
    expect(k1).toEqual(expect.stringContaining('drv-1'));
    expect(k1).not.toEqual(k2);
  });

  it('honours a caller-supplied idempotency key verbatim', async () => {
    const { svc, allocation } = build();
    await svc.requestInstantPayout('drv-1', { idempotencyKey: 'caller-key-1' });
    expect(allocation.allocate.mock.calls[0][0].idempotencyKey).toBe('caller-key-1');
  });
});

describe('PayoutOrchestratorService — failure and recovery', () => {
  it('releases the allocation with an explicit reason when submission throws, and rethrows', async () => {
    const boom = new Error('stripe exploded');
    const release = jest.fn().mockResolvedValue(undefined);
    const { svc } = build({ submit: jest.fn().mockRejectedValue(boom), release });
    await expect(svc.requestInstantPayout('drv-1')).rejects.toThrow('stripe exploded');
    expect(release).toHaveBeenCalledTimes(1);
    const arg = release.mock.calls[0][0];
    expect(arg.payoutRequestId).toBe('req-1');
    expect(arg.reason).toEqual(expect.stringContaining('submission_failed'));
    expect(arg.initiatorType).toBeTruthy();
  });

  it('surfaces the original submission error even if the release itself fails', async () => {
    const boom = new Error('stripe exploded');
    const { svc } = build({
      submit: jest.fn().mockRejectedValue(boom),
      release: jest.fn().mockRejectedValue(new Error('release failed')),
    });
    await expect(svc.requestInstantPayout('drv-1')).rejects.toThrow('stripe exploded');
  });

  it('does NOT release when submission returns a blocked request (recoverable, keeps evidence)', async () => {
    const release = jest.fn();
    const { svc } = build({
      submit: jest.fn().mockResolvedValue(REQUEST({ status: 'SUBMISSION_BLOCKED' })),
      release,
    });
    const res = await svc.requestInstantPayout('drv-1');
    expect(res.status).toBe('SUBMISSION_BLOCKED');
    expect(res.paid).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });

  it('reports paid=false for any non-PAID terminal state (no false success)', async () => {
    for (const status of ['SUBMISSION_BLOCKED', 'RECONCILIATION_REQUIRED', 'SUBMISSION_PENDING']) {
      const { svc } = build({ submit: jest.fn().mockResolvedValue(REQUEST({ status })) });
      const res = await svc.requestInstantPayout('drv-1');
      expect(res.paid).toBe(false);
      expect(res.status).toBe(status);
    }
  });

  it('reports paid=true only when the durable request reached PAID', async () => {
    const { svc } = build();
    const res = await svc.requestInstantPayout('drv-1');
    expect(res.paid).toBe(true);
    expect(res.status).toBe('PAID');
  });
});

describe('PayoutOrchestratorService — legacy path is not reachable', () => {
  it('exposes no trip-summing surface and never depends on PaymentService', () => {
    const methods = Object.getOwnPropertyNames(PayoutOrchestratorService.prototype)
      .filter((m) => m !== 'constructor');
    expect(methods).not.toContain('getDriverWallet');
    expect(methods).not.toContain('instantPayout');
    // Constructor arity is the structural guarantee: prisma, allocation,
    // submission. No PaymentService, so the lifetime Trip sum is unreachable.
    expect(PayoutOrchestratorService.length).toBe(3);
  });
});
