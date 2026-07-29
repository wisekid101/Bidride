import { getCorrelationId } from './correlation';
import { getServiceIdentity } from './service-identity';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Keys whose VALUE is replaced with [REDACTED] (PO-1A).
 *
 * Three groups, all of which end up in a 30-day CloudWatch log group if they
 * are not caught here:
 *
 *   - credentials and secrets, which grant access;
 *   - personal identity, which is the platform's obligation to protect;
 *   - presigned URLs, which are bearer credentials wearing a URL costume — the
 *     signature is in the query string, so logging the "link" logs the key.
 *
 * Coordinates are handled separately (see COORDINATE_KEYS): precise pickup and
 * dropoff points sitting in searchable logs are a stalking risk, so they are
 * rounded rather than dropped, keeping them useful for debugging.
 */
const SENSITIVE_KEYS = new Set([
  // Credentials and secrets
  'password', 'passwd', 'secret', 'token', 'accessToken', 'refreshToken',
  'authorization', 'otp', 'pin', 'cvv', 'cardNumber', 'ssn', 'dob',
  'privateKey', 'apiKey', 'webhookSecret', 'stripeKey', 'signingKey',
  'access_token', 'refresh_token', 'card_number', 'api_key', 'webhook_secret',
  'cookie', 'set-cookie', 'setcookie', 'sessiontoken', 'session_token',
  'jwt', 'bearer', 'clientsecret', 'client_secret',
  // Personal identity
  'phone', 'phonenumber', 'phone_number', 'email', 'emailaddress', 'email_address',
  'firstname', 'first_name', 'lastname', 'last_name', 'fullname', 'full_name',
  'legalfirstname', 'legal_first_name', 'legallastname', 'legal_last_name',
  'dateofbirth', 'date_of_birth', 'licensenumber', 'license_number',
  'documentnumber', 'document_number', 'address', 'street',
  // Payment instruments — the identifiers, not the amounts
  'stripecustomerid', 'stripe_customer_id', 'paymentmethodid', 'payment_method_id',
  'last4', 'fingerprint', 'iban', 'accountnumber', 'account_number', 'routingnumber',
  // Presigned URLs carry their own credential
  'uploadurl', 'upload_url', 'signedurl', 'signed_url',
  'presignedurl', 'presigned_url', 'downloadurl', 'download_url',
]);

/**
 * Coordinate keys, rounded rather than redacted.
 *
 * Two decimal places is roughly a kilometre — enough to tell Newark from
 * Manhattan when debugging, not enough to identify a doorstep.
 */
const COORDINATE_KEYS = new Set([
  'lat', 'lng', 'latitude', 'longitude',
  'pickuplat', 'pickuplng', 'dropofflat', 'dropofflng',
  'currentlat', 'currentlng', 'gpslat', 'gpslng',
]);

const COORDINATE_PRECISION = 2;

function roundCoordinate(value: unknown): unknown {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '[REDACTED]';
  const f = 10 ** COORDINATE_PRECISION;
  return Math.round(n * f) / f;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (COORDINATE_KEYS.has(lower)) {
      out[k] = roundCoordinate(v);
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

/**
 * Serialize an error, including its cause chain.
 *
 * A wrapped error whose cause is dropped loses the only line that says what
 * actually went wrong. Bounded at 5 links so a self-referential chain cannot
 * spin.
 */
function serializeError(err: unknown, depth = 0): Record<string, unknown> {
  if (!(err instanceof Error)) return err != null ? { error: err } : {};

  const out: Record<string, unknown> = {
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack,
  };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') out.errorCode = code;

  const cause = (err as { cause?: unknown }).cause;
  if (cause != null && depth < 5) out.cause = serializeError(cause, depth + 1);

  return out;
}

export class BidRideLogger {
  private readonly context: string;
  private readonly minLevel: LogLevel;

  constructor(context: string, minLevel: LogLevel = 'info') {
    this.context = context;
    this.minLevel = minLevel;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.emit('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.emit('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, meta);
  }

  error(message: string, err?: Error | unknown, meta?: Record<string, unknown>): void {
    this.emit('error', message, { ...serializeError(err), ...meta });
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_VALUES[level] < LEVEL_VALUES[this.minLevel]) return;

    let json: string;
    try {
      const id = getServiceIdentity();
      const entry = {
        level,
        message,
        context: this.context,
        correlationId: getCorrelationId(),
        timestamp: new Date().toISOString(),
        service: id.service,
        env: id.env,
        version: id.version,
        commitSha: id.commitSha,
        ...(meta ? redact(meta) as Record<string, unknown> : {}),
      };
      json = JSON.stringify(entry);
    } catch {
      // Telemetry fails open everywhere EXCEPT here. If redaction or
      // serialization failed we cannot prove the payload is safe, so the line
      // is dropped rather than emitted unredacted. A lost log beats a leaked
      // credential.
      try {
        const fallback = JSON.stringify({
          level, message, context: this.context,
          timestamp: new Date().toISOString(),
          logSerializationFailed: true,
        });
        process.stderr.write(fallback + '\n');
      } catch {
        /* nothing further is safe to attempt */
      }
      return;
    }

    if (level === 'error' || level === 'warn') {
      process.stderr.write(json + '\n');
    } else {
      process.stdout.write(json + '\n');
    }
  }

  child(subcontext: string): BidRideLogger {
    return new BidRideLogger(`${this.context}:${subcontext}`, this.minLevel);
  }
}

export { redact, serializeError };
