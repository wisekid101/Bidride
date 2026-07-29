import { BidRideLogger, redact, serializeError } from '../logger';
import { getServiceIdentity } from '../service-identity';
import { captureLogs, withTestIdentity, restoreIdentity } from '../testing';

// ─── PO-1A: redaction and log identity ──────────────────────────────────────
// Everything logged lands in a CloudWatch log group with 30-day retention.
// Anything sensitive that reaches it is there for a month, searchable.
//
// Redaction is the ONE part of telemetry that does not fail open: if we cannot
// prove a line is safe, the line is dropped.

describe('redaction — credentials and secrets', () => {
  it.each([
    ['password'], ['secret'], ['token'], ['accessToken'], ['refreshToken'],
    ['authorization'], ['cookie'], ['otp'], ['apiKey'], ['webhookSecret'],
    ['sessionToken'], ['jwt'], ['clientSecret'], ['privateKey'],
  ])('redacts %s', (key) => {
    expect((redact({ [key]: 'super-secret' }) as Record<string, unknown>)[key])
      .toBe('[REDACTED]');
  });
});

describe('redaction — personal identity', () => {
  it.each([
    ['phone'], ['phoneNumber'], ['email'], ['firstName'], ['lastName'],
    ['legalFirstName'], ['legalLastName'], ['dateOfBirth'], ['licenseNumber'],
    ['documentNumber'], ['address'],
  ])('redacts %s', (key) => {
    expect((redact({ [key]: 'personal' }) as Record<string, unknown>)[key])
      .toBe('[REDACTED]');
  });
});

describe('redaction — payment instruments', () => {
  it.each([
    ['stripeCustomerId'], ['paymentMethodId'], ['last4'], ['fingerprint'],
    ['cardNumber'], ['cvv'], ['accountNumber'], ['iban'],
  ])('redacts %s', (key) => {
    expect((redact({ [key]: 'x' }) as Record<string, unknown>)[key]).toBe('[REDACTED]');
  });

  it('does NOT redact the amounts or ids operations need', () => {
    // Redacting these would make the logs useless for the payment work they
    // exist to support. paymentIntentId is already in the Payment table.
    const out = redact({
      amountCents: 2364, tripId: 't-1', paymentIntentId: 'pi_1', outcome: 'failed',
    }) as Record<string, unknown>;

    expect(out).toEqual({
      amountCents: 2364, tripId: 't-1', paymentIntentId: 'pi_1', outcome: 'failed',
    });
  });
});

describe('redaction — presigned URLs', () => {
  it.each([
    ['uploadUrl'], ['signedUrl'], ['presignedUrl'], ['downloadUrl'],
  ])('redacts %s — the signature IS the credential', (key) => {
    const url = 'https://s3.amazonaws.com/bucket/doc.pdf?X-Amz-Signature=deadbeef';

    const out = redact({ [key]: url }) as Record<string, unknown>;

    expect(out[key]).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('X-Amz-Signature');
  });
});

describe('redaction — coordinates are rounded, not dropped', () => {
  it.each([
    ['lat'], ['lng'], ['latitude'], ['longitude'],
    ['pickupLat'], ['pickupLng'], ['dropoffLat'], ['dropoffLng'], ['currentLat'],
  ])('rounds %s to ~1km', (key) => {
    // Precise enough to tell Newark from Manhattan when debugging; not precise
    // enough to identify a doorstep.
    expect((redact({ [key]: 40.735712345 }) as Record<string, number>)[key]).toBe(40.74);
  });

  it('handles a non-numeric coordinate without leaking it', () => {
    expect((redact({ lat: 'not-a-number' }) as Record<string, unknown>).lat)
      .toBe('[REDACTED]');
  });

  it('rounds coordinates nested inside a trip payload', () => {
    const out = redact({ trip: { id: 't-1', pickupLat: 40.735712, pickupLng: -74.172433 } }) as
      { trip: Record<string, unknown> };

    expect(out.trip.pickupLat).toBe(40.74);
    expect(out.trip.pickupLng).toBe(-74.17);
    expect(out.trip.id).toBe('t-1');
  });
});

describe('redaction — structure', () => {
  it('redacts deep inside nested objects and arrays', () => {
    const out = redact({ a: { b: [{ password: 'p', keep: 1 }] } }) as
      { a: { b: Array<Record<string, unknown>> } };

    expect(out.a.b[0].password).toBe('[REDACTED]');
    expect(out.a.b[0].keep).toBe(1);
  });

  it('is case-insensitive — PASSWORD is the same mistake as password', () => {
    const out = redact({ PASSWORD: 'x', Phone: 'y' }) as Record<string, unknown>;

    expect(out.PASSWORD).toBe('[REDACTED]');
    expect(out.Phone).toBe('[REDACTED]');
  });

  it('a full sensitive payload leaks nothing into the serialized text', () => {
    // The assertion that matters: the VALUE is absent from the whole line, not
    // merely that a key looks redacted.
    const payload = {
      password: 'hunter2', email: 'rider@example.com', phone: '+15551234567',
      authorization: 'Bearer abc.def.ghi', last4: '4242',
      uploadUrl: 'https://s3/x?X-Amz-Signature=sig',
      nested: { otp: '123456', stripeCustomerId: 'cus_secret' },
    };

    const text = JSON.stringify(redact(payload));

    for (const secret of [
      'hunter2', 'rider@example.com', '+15551234567', 'abc.def.ghi',
      '4242', 'X-Amz-Signature', '123456', 'cus_secret',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('error serialization', () => {
  it('captures name, message, stack and code', () => {
    const err = Object.assign(new Error('boom'), { code: 'P2002' });

    expect(serializeError(err)).toMatchObject({
      errorName: 'Error', errorMessage: 'boom', errorCode: 'P2002',
    });
  });

  it('follows the cause chain — the wrapped error is usually the real one', () => {
    const root = new Error('connection refused');
    // The package targets ES2021, whose Error constructor has no `cause`
    // option; Node 20 reads the property either way.
    const wrapped = Object.assign(new Error('booking failed'), { cause: root });

    const out = serializeError(wrapped) as { cause: Record<string, unknown> };

    expect(out.cause.errorMessage).toBe('connection refused');
  });

  it('bounds a self-referential cause chain', () => {
    const a = new Error('a');
    (a as { cause?: unknown }).cause = a;

    expect(() => serializeError(a)).not.toThrow();
  });

  it('handles a non-Error throw', () => {
    expect(serializeError('just a string')).toEqual({ error: 'just a string' });
    expect(serializeError(undefined)).toEqual({});
  });
});

describe('logger output', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => { withTestIdentity(); logs = captureLogs(); });
  afterEach(() => { logs.stop(); restoreIdentity(); });

  it('stamps service identity on every line', () => {
    new BidRideLogger('test').info('hello');

    expect(logs.lines()[0]).toMatchObject({
      level: 'info', message: 'hello', context: 'test',
      service: 'test-service', env: 'test', version: '0.0.0-test', commitSha: 'testsha',
    });
  });

  it('redacts metadata on the way out', () => {
    new BidRideLogger('test').info('login', { email: 'a@b.com', outcome: 'ok' });

    expect(logs.text()).not.toContain('a@b.com');
    expect(logs.lines()[0]).toMatchObject({ email: '[REDACTED]', outcome: 'ok' });
  });

  it('serializes an error with its cause', () => {
    new BidRideLogger('test').error('failed', new Error('inner'));

    expect(logs.lines()[0]).toMatchObject({ errorName: 'Error', errorMessage: 'inner' });
  });

  it('drops the line rather than emitting unredacted when serialization fails', () => {
    // Redaction is the one place telemetry must NOT fail open: a lost log beats
    // a leaked credential.
    const circular: Record<string, unknown> = { password: 'hunter2' };
    circular.self = circular;

    new BidRideLogger('test').info('boom', circular);

    expect(logs.text()).not.toContain('hunter2');
    expect(logs.lines()[0]).toMatchObject({ logSerializationFailed: true });
  });

  it('respects the level threshold', () => {
    new BidRideLogger('test', 'warn').info('quiet');

    expect(logs.lines()).toHaveLength(0);
  });
});

describe('service identity', () => {
  afterEach(restoreIdentity);

  it('reads from the environment by default', () => {
    expect(typeof getServiceIdentity().service).toBe('string');
  });

  it('can be overridden for tests', () => {
    withTestIdentity();

    expect(getServiceIdentity()).toEqual({
      service: 'test-service', env: 'test', version: '0.0.0-test', commitSha: 'testsha',
    });
  });
});
