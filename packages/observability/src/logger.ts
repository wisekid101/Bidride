import { getCorrelationId } from './correlation';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'accessToken', 'refreshToken',
  'authorization', 'otp', 'pin', 'cvv', 'cardNumber', 'ssn', 'dob',
  'privateKey', 'apiKey', 'webhookSecret', 'stripeKey', 'signingKey',
  'access_token', 'refresh_token', 'card_number', 'api_key', 'webhook_secret',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_KEYS.has(k)
      ? '[REDACTED]'
      : redact(v, depth + 1);
  }
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
    const errMeta: Record<string, unknown> = err instanceof Error
      ? { errorMessage: err.message, stack: err.stack, errorName: err.name }
      : err != null ? { error: err } : {};
    this.emit('error', message, { ...errMeta, ...meta });
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_VALUES[level] < LEVEL_VALUES[this.minLevel]) return;

    const entry = {
      level,
      message,
      context: this.context,
      correlationId: getCorrelationId(),
      timestamp: new Date().toISOString(),
      ...(meta ? redact(meta) as Record<string, unknown> : {}),
    };

    const json = JSON.stringify(entry);
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

export { redact };
