import {
  redactSensitive,
  buildSafeWebhookLog,
  WebhookSignatureVerifier,
  ProviderEventIdentifier,
  DeadLetterSink,
} from './webhook-security';

describe('redactSensitive', () => {
  it('redacts a dashed SSN/ITIN', () => {
    expect(redactSensitive('ssn is 123-45-6789 ok')).toBe('ssn is [REDACTED] ok');
  });

  it('redacts a dashed EIN', () => {
    expect(redactSensitive('ein 12-3456789 here')).toBe('ein [REDACTED] here');
  });

  it('redacts a bare 9-digit run (undashed TIN/EIN/ITIN)', () => {
    expect(redactSensitive('tin=123456789;')).toBe('tin=[REDACTED];');
  });

  it('redacts multiple occurrences and leaves non-sensitive text intact', () => {
    expect(redactSensitive('a 111-22-3333 b 987654321 c')).toBe('a [REDACTED] b [REDACTED] c');
    expect(redactSensitive('driver ref acct_abc123')).toBe('driver ref acct_abc123');
  });
});

describe('buildSafeWebhookLog', () => {
  it('emits ONLY allowlisted, non-sensitive fields (structurally cannot carry a raw payload)', () => {
    const log = buildSafeWebhookLog({
      providerEventId: 'evt_1',
      normalizedStatus: 'verified',
      providerReference: 'acct_1',
      outcome: 'accepted',
    });
    expect(Object.keys(log).sort()).toEqual(
      ['normalizedStatus', 'outcome', 'providerEventId', 'providerReference'].sort(),
    );
    // No way to smuggle a rawBody/payload through the typed builder.
    expect((log as any).rawBody).toBeUndefined();
    expect((log as any).payload).toBeUndefined();
  });

  it('defaults optional references to null', () => {
    const log = buildSafeWebhookLog({
      providerEventId: null,
      normalizedStatus: null,
      providerReference: null,
      outcome: 'rejected',
    });
    expect(log).toEqual({
      providerEventId: null,
      normalizedStatus: null,
      providerReference: null,
      outcome: 'rejected',
    });
  });
});

describe('webhook-security contracts are satisfiable (interface shape)', () => {
  it('a stub verifier / event-identifier / dead-letter sink implement their contracts', async () => {
    const verifier: WebhookSignatureVerifier = { verify: () => false };
    const identifier: ProviderEventIdentifier = { extractEventId: () => 'evt_1' };
    const captured: any[] = [];
    const sink: DeadLetterSink = {
      deadLetter: async (e) => {
        captured.push(e);
      },
    };
    expect(verifier.verify('body', {})).toBe(false);
    expect(identifier.extractEventId('body')).toBe('evt_1');
    await sink.deadLetter({ providerEventId: null, reason: 'signature_invalid', receivedAt: new Date() });
    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty('rawBody');
  });
});
