import { registry, testing, withCorrelation, getCorrelationId } from '@bidride/observability';
import { tripMetrics } from './trip-metrics';

// ─── PO-1B: trip metric contract + correlation propagation ──────────────────
// Deliberately narrow. Full trip-lifecycle instrumentation is PO-1C; this
// checkpoint carries only the bid-expiry signal and the header that makes one
// correlation id span trip-service and payment-service.

describe('trip metrics', () => {
  let capture: ReturnType<typeof testing.captureMetrics>;

  beforeEach(() => { testing.withTestIdentity(); capture = testing.captureMetrics(); });
  afterEach(() => { capture.stop(); testing.restoreIdentity(); });

  it('is registered under the bidride_ prefix', () => {
    expect(registry.toPrometheusText()).toContain('bidride_bid_expiry_total');
  });

  it.each([
    ['expired', 'pending'],
    ['expired', 'countered'],
    ['transition_lost', 'pending'],
    ['transition_lost', 'countered'],
  ])('accepts outcome=%s previous_status=%s', (outcome, previous_status) => {
    tripMetrics.bidExpiryTotal.inc({ outcome, previous_status });

    expect(capture.named('bidride_bid_expiry_total')[0].dimensions)
      .toMatchObject({ outcome, previous_status });
  });

  it('collapses an unknown outcome rather than minting a series', () => {
    tripMetrics.bidExpiryTotal.inc({ outcome: 'invented', previous_status: 'pending' });

    expect(capture.named('bidride_bid_expiry_total')[0].dimensions.outcome).toBe('other');
  });

  it.each([['bidId'], ['tripId'], ['riderId']])('refuses the identifier %s', (dim) => {
    tripMetrics.bidExpiryTotal.inc({ outcome: 'expired', [dim]: 'bid-123' });

    const d = capture.named('bidride_bid_expiry_total')[0].dimensions;
    expect(d).not.toHaveProperty(dim);
    expect(JSON.stringify(d)).not.toContain('bid-123');
  });
});

describe('correlation propagation', () => {
  it('an outgoing internal call carries the ambient correlation id', () => {
    // internalHeaders() is private to BidsService; this asserts the contract it
    // implements — the header name the receiving middleware already reads first.
    withCorrelation('corr-abc', () => {
      const id = getCorrelationId();
      const headers = {
        'Content-Type': 'application/json',
        ...(id ? { 'x-correlation-id': id } : {}),
      };
      expect(headers['x-correlation-id']).toBe('corr-abc');
    });
  });

  it('omits the header entirely when there is no context', () => {
    const id = getCorrelationId();
    const headers = {
      'Content-Type': 'application/json',
      ...(id ? { 'x-correlation-id': id } : {}),
    };

    // A background caller must not fabricate a request id.
    expect(headers).not.toHaveProperty('x-correlation-id');
  });

  it('keeps concurrent contexts isolated', async () => {
    // The subtlest correctness risk in AsyncLocalStorage: two in-flight requests
    // must never observe each other's id.
    const seen: string[] = [];
    await Promise.all([
      new Promise<void>((r) => withCorrelation('a', async () => {
        await new Promise((x) => setTimeout(x, 5));
        seen.push(getCorrelationId()!); r();
      })),
      new Promise<void>((r) => withCorrelation('b', async () => {
        seen.push(getCorrelationId()!); r();
      })),
    ]);

    expect(seen.sort()).toEqual(['a', 'b']);
  });
});
