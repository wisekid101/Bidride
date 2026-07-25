/**
 * S0-B3B1 — Client-IP resolver used ONLY for request throttling.
 *
 * Behind the AWS ALB (a single trusted proxy hop; ECS tasks run in private
 * subnets and are unreachable directly), the ALB APPENDS the real client IP as
 * the LAST entry of X-Forwarded-For. Any left-side entries are client-supplied
 * and therefore spoofable, so we trust ONLY the rightmost entry. With no
 * forwarding header (local dev / direct call), we fall back to the socket IP.
 *
 * Wired into ThrottlerModule.forRoot({ getTracker }) so it changes the throttle
 * bucket ONLY. It does NOT call app.set('trust proxy', ...) and does NOT change
 * req.ip anywhere, so audit logging, driver zero-tolerance compliance IP
 * recording, fraud logic, and every other req.ip consumer are unaffected.
 */
export function throttlerClientIp(req: Record<string, any>): string {
  const raw = req?.headers?.['x-forwarded-for'];
  const xff = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (typeof xff === 'string' && xff.trim().length > 0) {
    // AWS ALB appends the real client as the rightmost entry; trust only it.
    const rightmost = xff.split(',').pop()?.trim();
    if (rightmost) return rightmost;
  }
  // No X-Forwarded-For (local/dev/direct) → the socket peer IP.
  return req?.ip;
}
