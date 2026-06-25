// ─── Mock fetch before imports ─────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── Mock crypto.createSign — avoids needing a real RSA key in CI ─────────────
jest.mock('crypto', () => {
  const real = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...real,
    createSign: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      sign: jest.fn().mockReturnValue('mock-rsa-signature'),
    }),
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FcmService } from './fcm.service';

// ─── Config stub ───────────────────────────────────────────────────────────────

const mockConfig = {
  getOrThrow: jest.fn((key: string) => {
    const values: Record<string, string> = {
      FCM_PROJECT_ID: 'bidride-test',
      FCM_SERVICE_ACCOUNT_EMAIL: 'test@bidride-test.iam.gserviceaccount.com',
      FCM_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\\nMOCKKEY\\n-----END RSA PRIVATE KEY-----',
    };
    if (key in values) return values[key];
    throw new Error(`Missing config: ${key}`);
  }),
};

async function buildService(): Promise<FcmService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FcmService,
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile();
  return module.get(FcmService);
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function mockTokenResponse(token = 'test-access-token') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ access_token: token }),
    text: jest.fn().mockResolvedValue(''),
  });
}

function mockFcmSendResponse(ok = true) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 400,
    text: jest.fn().mockResolvedValue(ok ? '' : 'INVALID_ARGUMENT'),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Token acquisition ────────────────────────────────────────────────────────

describe('FcmService — getAccessToken', () => {
  it('POSTs to Google token endpoint with JWT grant type', async () => {
    const service = await buildService();
    mockTokenResponse();

    await service.getAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(opts.method).toBe('POST');
    expect(opts.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
  });

  it('includes the signed JWT assertion in the request body', async () => {
    const service = await buildService();
    mockTokenResponse();

    await service.getAccessToken();

    const body = mockFetch.mock.calls[0][1].body as string;
    expect(body).toContain('assertion=');
    // JWT has 3 base64url parts separated by dots
    const jwt = decodeURIComponent(body.split('assertion=')[1]);
    expect(jwt.split('.').length).toBe(3);
  });

  it('caches the token and does not re-fetch on second call', async () => {
    const service = await buildService();
    mockTokenResponse('cached-token');

    const t1 = await service.getAccessToken();
    const t2 = await service.getAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(t1).toBe('cached-token');
    expect(t2).toBe('cached-token');
  });

  it('re-fetches when cached token is expired', async () => {
    const service = await buildService();
    mockTokenResponse('old-token');
    await service.getAccessToken();

    // Force expiry
    (service as any).tokenExpiresAt = Date.now() - 1;
    mockTokenResponse('new-token');
    const t = await service.getAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(t).toBe('new-token');
  });

  it('throws when token endpoint returns non-OK', async () => {
    const service = await buildService();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: jest.fn() });

    await expect(service.getAccessToken()).rejects.toThrow('FCM token request failed: HTTP 401');
  });

  it('normalizes \\n literal in private key to real newlines', async () => {
    const service = await buildService();
    expect((service as any).privateKey).toContain('\n');
    expect((service as any).privateKey).not.toContain('\\n');
  });
});

// ─── Single send ──────────────────────────────────────────────────────────────

describe('FcmService — send', () => {
  it('sends to FCM HTTP v1 endpoint with Bearer token', async () => {
    const service = await buildService();
    mockTokenResponse('bearer-xyz');
    mockFcmSendResponse();

    await service.send({ token: 'device-token-abc', title: 'Test', body: 'Hello' });

    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/bidride-test/messages:send');
    expect(opts.headers['Authorization']).toBe('Bearer bearer-xyz');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('wraps message in the FCM v1 message envelope', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse();

    await service.send({
      token: 'tok-1',
      title: 'Ride arrived',
      body: 'Driver is here',
      data: { type: 'DRIVER_ARRIVED' },
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(body.message.token).toBe('tok-1');
    expect(body.message.notification.title).toBe('Ride arrived');
    expect(body.message.notification.body).toBe('Driver is here');
    expect(body.message.data.type).toBe('DRIVER_ARRIVED');
  });

  it('sets Android priority to HIGH (uppercase)', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse();

    await service.send({ token: 'tok', title: 'T', body: 'B' });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(body.message.android.priority).toBe('HIGH');
  });

  it('sets APNS priority header to 10', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse();

    await service.send({ token: 'tok', title: 'T', body: 'B' });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(body.message.apns.headers['apns-priority']).toBe('10');
  });

  it('does not throw when FCM returns non-OK — graceful failure', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse(false);

    await expect(service.send({ token: 'tok', title: 'T', body: 'B' })).resolves.toBeUndefined();
  });

  it('does not throw when FCM fetch itself throws — graceful failure', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.send({ token: 'tok', title: 'T', body: 'B' })).resolves.toBeUndefined();
  });

  it('does not throw when token fetch fails — graceful failure', async () => {
    const service = await buildService();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: jest.fn() });

    await expect(service.send({ token: 'tok', title: 'T', body: 'B' })).resolves.toBeUndefined();
    // FCM send fetch must NOT be called
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── Rider push ───────────────────────────────────────────────────────────────

describe('FcmService — rider notification', () => {
  it('sends DRIVER_ASSIGNED push to rider device', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse();

    await service.send({
      token: 'rider-push-token',
      title: 'Driver on the way!',
      body: 'John Doe · Toyota Camry · ETA 4 min',
      data: { type: 'DRIVER_ASSIGNED' },
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(body.message.data.type).toBe('DRIVER_ASSIGNED');
    expect(body.message.token).toBe('rider-push-token');
  });
});

// ─── Driver push ──────────────────────────────────────────────────────────────

describe('FcmService — driver notification', () => {
  it('sends NEW_REQUEST push to driver device', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse();

    await service.send({
      token: 'driver-push-token',
      title: 'New ride request',
      body: 'Pickup: Penn Station · Take-home: $18.50',
      data: { type: 'NEW_REQUEST' },
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(body.message.data.type).toBe('NEW_REQUEST');
    expect(body.message.token).toBe('driver-push-token');
  });
});

// ─── SOS / trusted contact push ──────────────────────────────────────────────

describe('FcmService — SOS notification', () => {
  it('sends SOS_ALERT push to trusted contact device', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse();

    await service.send({
      token: 'contact-push-token',
      title: '🚨 Safety Alert',
      body: 'Jane Doe activated an SOS during their ride. Trip: abc12345',
      data: { type: 'SOS_ALERT', tripId: 'abc12345-full-uuid' },
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(body.message.data.type).toBe('SOS_ALERT');
    expect(body.message.data.tripId).toBe('abc12345-full-uuid');
  });
});

// ─── Multi-device send ────────────────────────────────────────────────────────

describe('FcmService — sendMultiple', () => {
  it('skips fetch entirely when tokens array is empty', async () => {
    const service = await buildService();
    await service.sendMultiple([], 'T', 'B');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends one FCM request per device token', async () => {
    const service = await buildService();
    mockTokenResponse(); // token fetch (cached after first)
    mockFcmSendResponse(); // device 1
    mockFcmSendResponse(); // device 2
    mockFcmSendResponse(); // device 3

    await service.sendMultiple(['tok-1', 'tok-2', 'tok-3'], 'Alert', 'Message');

    // 1 token fetch + 3 FCM sends
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('does not throw when some sends fail — Promise.allSettled', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFcmSendResponse(true);   // tok-1 succeeds
    mockFcmSendResponse(false);  // tok-2 fails with non-OK

    await expect(
      service.sendMultiple(['tok-1', 'tok-2'], 'T', 'B'),
    ).resolves.toBeUndefined();
  });

  it('does not throw when all sends fail — full graceful degradation', async () => {
    const service = await buildService();
    mockTokenResponse();
    mockFetch.mockRejectedValueOnce(new Error('network'));
    mockFetch.mockRejectedValueOnce(new Error('network'));

    await expect(
      service.sendMultiple(['tok-1', 'tok-2'], 'T', 'B'),
    ).resolves.toBeUndefined();
  });
});
