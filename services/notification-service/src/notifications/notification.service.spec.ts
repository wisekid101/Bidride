import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { FcmService } from './fcm.service';

const mockFcm = {
  send: jest.fn().mockResolvedValue(undefined),
  sendMultiple: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  get: jest.fn((key: string, def?: string) => def ?? undefined),
  getOrThrow: jest.fn((key: string) => {
    const values: Record<string, string> = {
      TWILIO_ACCOUNT_SID: 'ACtest',
      TWILIO_AUTH_TOKEN: 'test-token',
      TWILIO_PHONE_NUMBER: '+15550000000',
      AWS_REGION: 'us-east-1',
    };
    if (key in values) return values[key];
    throw new Error(`Missing config: ${key}`);
  }),
};

async function buildService(): Promise<NotificationService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      NotificationService,
      { provide: FcmService, useValue: mockFcm },
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile();
  return module.get(NotificationService);
}

beforeEach(() => jest.clearAllMocks());

// ─── notifyDriverCancellation ─────────────────────────────────────────────────

describe('NotificationService — notifyDriverCancellation', () => {
  it('sends correct title and body — no rider PII', async () => {
    const service = await buildService();
    await service.notifyDriverCancellation('driver-token-abc');
    expect(mockFcm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'driver-token-abc',
        title: 'Trip Cancelled',
        body: 'The rider cancelled this trip.',
        data: expect.objectContaining({ type: 'TRIP_CANCELLED' }),
      }),
    );
    const call = mockFcm.send.mock.calls[0][0];
    expect(call.body).not.toMatch(/\d{10}/); // no phone number
    expect(call.body.toLowerCase()).not.toContain('phone');
    expect(call.body.toLowerCase()).not.toContain('address');
  });

  it('returns early when pushToken is empty — no FCM call', async () => {
    const service = await buildService();
    await service.notifyDriverCancellation('');
    expect(mockFcm.send).not.toHaveBeenCalled();
  });
});

// ─── notifyDriverRatingReceived ───────────────────────────────────────────────

describe('NotificationService — notifyDriverRatingReceived', () => {
  it('sends generic body with no numerical score', async () => {
    const service = await buildService();
    await service.notifyDriverRatingReceived('driver-token-xyz');
    expect(mockFcm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'driver-token-xyz',
        title: 'New Feedback',
        data: expect.objectContaining({ type: 'RATING_RECEIVED' }),
      }),
    );
    const body: string = mockFcm.send.mock.calls[0][0].body;
    // Must not include any digit (star count, rating value, etc.)
    expect(body).not.toMatch(/\d/);
  });

  it('returns early when pushToken is empty — no FCM call', async () => {
    const service = await buildService();
    await service.notifyDriverRatingReceived('');
    expect(mockFcm.send).not.toHaveBeenCalled();
  });
});

// ─── notifyRiderTripStarted ───────────────────────────────────────────────────

describe('NotificationService — notifyRiderTripStarted', () => {
  it('includes driver name in body', async () => {
    const service = await buildService();
    await service.notifyRiderTripStarted('rider-token-123', 'Marcus');
    expect(mockFcm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'rider-token-123',
        title: 'Trip Started',
        data: expect.objectContaining({ type: 'TRIP_STARTED' }),
      }),
    );
    const body: string = mockFcm.send.mock.calls[0][0].body;
    expect(body).toContain('Marcus');
  });

  it('returns early when pushToken is empty — no FCM call', async () => {
    const service = await buildService();
    await service.notifyRiderTripStarted('', 'Marcus');
    expect(mockFcm.send).not.toHaveBeenCalled();
  });
});

// ─── notifyRiderDriverAssigned (regression) ───────────────────────────────────

describe('NotificationService — notifyRiderDriverAssigned regression', () => {
  it('sends correct payload with driver name, vehicle, and ETA', async () => {
    const service = await buildService();
    await service.notifyRiderDriverAssigned('rider-token', 'Jordan Lee', 'White Toyota Camry', '4 min');
    expect(mockFcm.send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'rider-token',
        title: 'Driver on the way!',
        data: expect.objectContaining({ type: 'DRIVER_ASSIGNED' }),
      }),
    );
    const body: string = mockFcm.send.mock.calls[0][0].body;
    expect(body).toContain('Jordan Lee');
    expect(body).toContain('White Toyota Camry');
    expect(body).toContain('4 min');
  });
});
