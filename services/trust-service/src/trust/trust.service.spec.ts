import { TrustService } from './trust.service';
import { TicketCategory } from '@bidride/database/generated/client';

const mockPrisma = {
  trustScore: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ts-1' }),
    upsert: jest.fn(),
  },
  trustScoreHistory: { create: jest.fn() },
  fraudAlert: {
    create: jest.fn(),
    count: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  supportTicket: { count: jest.fn() },
  trip: { count: jest.fn() },
} as any;

// AI_SERVICE_URL not set in tests — getFraudProbability uses rule-based fallback
const service = new TrustService(mockPrisma);

beforeEach(() => jest.clearAllMocks());

// ─── triggerFraudHold ─────────────────────────────────────────────────────────

describe('TrustService — triggerFraudHold', () => {
  it('writes a fraud_alerts record to the database', async () => {
    mockPrisma.trustScore.findUnique.mockResolvedValue({ userRole: 'rider' });
    mockPrisma.fraudAlert.create.mockResolvedValue({ id: 'alert-1' });

    await service.triggerFraudHold('user-1', 92, { linkedAccounts: 3 });

    expect(mockPrisma.fraudAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          fraudProbability: 92,
          status: 'pending',
          triggerSignals: { linkedAccounts: 3 },
        }),
      }),
    );
  });

  it('defaults userRole to "rider" when no trust score record exists', async () => {
    mockPrisma.trustScore.findUnique.mockResolvedValue(null);
    mockPrisma.fraudAlert.create.mockResolvedValue({ id: 'alert-2' });

    await service.triggerFraudHold('user-unknown', 95);

    expect(mockPrisma.fraudAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userRole: 'rider' }),
      }),
    );
  });
});

// ─── recalculateForUser ───────────────────────────────────────────────────────

describe('TrustService — recalculateForUser', () => {
  const baseUser = {
    id: 'user-1',
    createdAt: new Date(Date.now() - 90 * 24 * 3600 * 1000),
    phoneVerified: true,
    emailVerified: true,
    rider: { id: 'rider-1', totalTrips: 20, stripeCustomerId: 'cus_abc' },
    driver: null,
    deviceFingerprints: [{ id: 'fp-1' }],
    multiAccountLinksA: [],
    multiAccountLinksB: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.fraudAlert.count.mockResolvedValue(0);
    mockPrisma.supportTicket.count.mockResolvedValue(0);
    mockPrisma.trip.count.mockResolvedValue(15);
    mockPrisma.trustScore.upsert.mockResolvedValue({ id: 'ts-1' });
    mockPrisma.trustScore.findUniqueOrThrow.mockResolvedValue({ id: 'ts-1' });
    mockPrisma.trustScoreHistory.create.mockResolvedValue({});
    mockPrisma.trustScore.findUnique.mockResolvedValue(null);
    mockPrisma.fraudAlert.create.mockResolvedValue({ id: 'alert-1' });
  });

  it('returns early without error when userId does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.recalculateForUser('nonexistent')).resolves.toBeUndefined();
    expect(mockPrisma.trustScore.upsert).not.toHaveBeenCalled();
  });

  it('fetches real inputs from DB and calls calculateTrustScore for a rider', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(baseUser);

    await service.recalculateForUser('user-1');

    expect(mockPrisma.supportTicket.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          category: {
            in: [
              TicketCategory.driver_complaint,
              TicketCategory.rider_complaint,
              TicketCategory.payment_issue,
            ],
          },
        }),
      }),
    );
    expect(mockPrisma.trustScore.upsert).toHaveBeenCalled();
  });

  it('uses payoutBankVerified as paymentVerified for drivers', async () => {
    const driverUser = {
      ...baseUser,
      rider: null,
      driver: {
        id: 'driver-1',
        totalTrips: 50,
        avgRating: 4.8,
        payoutBankVerified: true,
        backgroundCheckStatus: 'clear',
      },
    };
    mockPrisma.user.findUnique.mockResolvedValue(driverUser);

    await service.recalculateForUser('user-1');

    expect(mockPrisma.trustScore.upsert).toHaveBeenCalled();
  });

  it('counts open fraud alerts as fraudFlagCount input', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(baseUser);
    mockPrisma.fraudAlert.count.mockResolvedValue(2);

    await service.recalculateForUser('user-1');

    expect(mockPrisma.fraudAlert.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          status: { in: ['pending', 'under_review', 'escalated'] },
        }),
      }),
    );
  });
});
