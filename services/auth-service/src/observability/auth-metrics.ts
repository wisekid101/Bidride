import { registry } from '@bidride/observability';

/**
 * Auth-domain metrics, preserved from the previous local MetricsService and
 * migrated onto the shared observability registry. Every original metric name
 * and help string is retained verbatim so /metrics output stays byte-compatible
 * (no renames). The shared standard HTTP metrics (bidride_http_requests_total,
 * bidride_http_errors_total) are published in ADDITION by the shared middleware,
 * so old and new series co-exist during the migration period (dual-publishing).
 *
 *   - bidride_auth_otp_attempts_total   (counter)  — preserved
 *   - bidride_auth_login_attempts_total (counter)  — preserved
 *   - bidride_auth_active_sessions      (gauge)     — preserved
 *   - bidride_auth_http_requests_total  (counter)  — preserved (dual-published)
 *   - bidride_auth_http_errors_total    (counter)  — preserved (dual-published)
 */
/**
 * PO-1C-i: these metrics were DECLARED and never incremented. They appeared in
 * /metrics as flat zero series, which is worse than absent — a dashboard shows
 * them healthy forever. Each now has an authoritative owner (see the comments
 * below) and a bounded outcome dimension.
 *
 * The metric NAMES and help strings are unchanged, so /metrics output stays
 * compatible with anything already reading them.
 */
export const authMetrics = {
  /** OWNER: OtpService.sendOtp and OtpService.verifyOtp — the only OTP paths. */
  otpAttempts: registry.counter('bidride_auth_otp_attempts_total', 'Total OTP attempts', {
    outcome: ['sent', 'rate_limited', 'verified', 'incorrect', 'expired', 'attempts_exhausted'],
  }),
  /** OWNER: AuthService.verifyOtp, after the token pair is issued. */
  loginAttempts: registry.counter('bidride_auth_login_attempts_total', 'Total login attempts', {
    outcome: ['succeeded'], role: ['rider', 'driver'], is_new: ['true', 'false'],
  }),
  /** OWNER: TokenService — issue increments, revoke decrements. */
  activeSessions: registry.gauge('bidride_auth_active_sessions', 'Current active JWT sessions'),
  httpRequests: registry.counter('bidride_auth_http_requests_total', 'Total HTTP requests to auth-service'),
  httpErrors: registry.counter('bidride_auth_http_errors_total', 'Total HTTP errors in auth-service'),
};

// Emit an explicit zero sample so the gauge appears in /metrics from boot,
// matching the previous implementation's `bidride_auth_active_sessions 0` output.
authMetrics.activeSessions.set(0);
