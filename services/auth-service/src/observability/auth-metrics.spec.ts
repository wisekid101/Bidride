import { registry } from '@bidride/observability';
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
