import { registry, testing } from '@bidride/observability';
import { authMetrics } from './auth-metrics';

describe('auth-domain metrics preservation', () => {
  it('registers every preserved auth metric name verbatim (no renames)', () => {
    const text = registry.toPrometheusText();
    expect(text).toContain('bidride_auth_otp_attempts_total');
    expect(text).toContain('bidride_auth_login_attempts_total');
    expect(text).toContain('bidride_auth_active_sessions');
    expect(text).toContain('bidride_auth_http_requests_total');
    expect(text).toContain('bidride_auth_http_errors_total');
  });

  it('dual-publishes: old auth HTTP series and new shared HTTP series co-exist', () => {
    const text = registry.toPrometheusText();
    expect(text).toContain('bidride_auth_http_requests_total'); // old, preserved
    expect(text).toContain('bidride_http_requests_total'); // new shared standard
  });

  it('exposes the gauge with an explicit zero sample (output parity)', () => {
    expect(registry.toPrometheusText()).toContain('bidride_auth_active_sessions 0');
  });

  it('preserved counters increment', () => {
    authMetrics.otpAttempts.inc();
    expect(authMetrics.otpAttempts.get()).toBeGreaterThanOrEqual(1);
  });
});

// ─── PO-1C-i: auth metrics now emit ─────────────────────────────────────────
// These three metrics were DECLARED and never incremented — they appeared in
// /metrics as flat zero series, which is worse than absent because a dashboard
// reads them as healthy forever. These tests exist so that cannot recur
// silently: each asserts a real emission with bounded dimensions.

describe('auth metrics', () => {
  let capture: ReturnType<typeof testing.captureMetrics>;

  beforeEach(() => { testing.withTestIdentity(); capture = testing.captureMetrics(); });
  afterEach(() => { capture.stop(); testing.restoreIdentity(); });

  it('keeps the original metric names — /metrics stays compatible', () => {
    const text = registry.toPrometheusText();

    expect(text).toContain('bidride_auth_otp_attempts_total');
    expect(text).toContain('bidride_auth_login_attempts_total');
    expect(text).toContain('bidride_auth_active_sessions');
  });

  it.each([
    ['sent'], ['rate_limited'], ['verified'], ['incorrect'], ['expired'], ['attempts_exhausted'],
  ])('otpAttempts admits outcome %s', (outcome) => {
    authMetrics.otpAttempts.inc({ outcome });

    expect(capture.named('bidride_auth_otp_attempts_total')[0].dimensions.outcome).toBe(outcome);
  });

  it('otpAttempts collapses an unknown outcome rather than minting a series', () => {
    authMetrics.otpAttempts.inc({ outcome: 'invented' });

    expect(capture.named('bidride_auth_otp_attempts_total')[0].dimensions.outcome).toBe('other');
  });

  it.each([['rider'], ['driver']])('loginAttempts carries role %s', (role) => {
    authMetrics.loginAttempts.inc({ outcome: 'succeeded', role, is_new: 'false' });

    expect(capture.named('bidride_auth_login_attempts_total')[0].dimensions)
      .toMatchObject({ outcome: 'succeeded', role });
  });

  it.each([['phone'], ['userId'], ['email']])('refuses the identifier %s as a dimension', (dim) => {
    authMetrics.otpAttempts.inc({ outcome: 'sent', [dim]: '+15551234567' });

    const d = capture.named('bidride_auth_otp_attempts_total')[0].dimensions;
    expect(d).not.toHaveProperty(dim);
    expect(JSON.stringify(d)).not.toContain('+15551234567');
  });

  it('activeSessions is a gauge — it does not emit on write', () => {
    authMetrics.activeSessions.inc();

    expect(capture.named('bidride_auth_active_sessions')).toHaveLength(0);
  });

  it('activeSessions publishes when sampled', () => {
    authMetrics.activeSessions.set(0);
    authMetrics.activeSessions.inc();
    authMetrics.activeSessions.inc();
    authMetrics.activeSessions.dec({}, 1);

    authMetrics.activeSessions.publish();

    expect(capture.named('bidride_auth_active_sessions')[0].value).toBe(1);
  });
});
