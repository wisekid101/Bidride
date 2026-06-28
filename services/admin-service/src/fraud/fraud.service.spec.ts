import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FraudService, ReviewAlertDto } from './fraud.service';
import { AuditService } from '../audit/audit.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALERT_ID = 'alert-uuid-001';
const USER_ID = 'user-uuid-001';
const ADMIN_ID = 'admin-uuid-001';

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_ID,
    userId: USER_ID,
    userRole: 'rider',
    tripId: null,
    fraudProbability: { toString: () => '92.00' },
    triggerSignals: { linkedAccounts: 3, deviceFingerprints: 6, fraudFlagCount: 0, disputeCount: 1, accountAgeDays: 90, totalTrips: 5 },
    holdPlacedAt: new Date(),
    holdReleasedAt: null,
    status: 'pending',
    reviewedById: null,
    reviewedAt: null,
    decision: null,
    reviewNotes: null,
    createdAt: new Date('2026-06-24T10:00:00Z'),
    user: { firstName: 'Marcus', lastName: 'Johnson' },
    ...overrides,
  };
}

function makePrisma(alert = makeAlert()) {
  return {
    $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
    fraudAlert: {
      findUnique: jest.fn().mockResolvedValue(alert),
      findMany: jest.fn().mockResolvedValue([alert]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(alert),
    },
  };
}

function makeAudit() {
  return { createLog: jest.fn().mockResolvedValue(undefined) };
}

async function buildService(prismaOverride?: ReturnType<typeof makePrisma>) {
  const prisma = prismaOverride ?? makePrisma();
  const audit = makeAudit();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FraudService,
      { provide: AuditService, useValue: audit },
    ],
  }).compile();

  const service = module.get<FraudService>(FraudService);
  (service as any).prisma = prisma;

  return { service, prisma, audit };
}

// ─── listAlerts ───────────────────────────────────────────────────────────────

describe('FraudService — listAlerts', () => {
  it('queries pending and under_review statuses for the pending tab', async () => {
    const { service, prisma } = await buildService();

    await service.listAlerts('pending');

    expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['pending', 'under_review'] } },
      }),
    );
  });

  it('queries cleared and escalated statuses for the reviewed tab', async () => {
    const { service, prisma } = await buildService();

    await service.listAlerts('reviewed');

    expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['cleared', 'escalated'] } },
      }),
    );
  });

  it('maps DB record to the shape expected by the admin UI', async () => {
    const { service } = await buildService();

    const result = await service.listAlerts('pending');

    expect(result.alerts[0]).toMatchObject({
      id: ALERT_ID,
      userId: USER_ID,
      userType: 'rider',
      userName: 'Marcus Johnson',
      fraudProbability: 92,
      holdActive: true,
      status: 'pending',
    });
  });

  it('formats userName from firstName + lastName', async () => {
    const prisma = makePrisma(makeAlert({ user: { firstName: 'Destiny', lastName: 'Clark' } }));
    const { service } = await buildService(prisma);

    const result = await service.listAlerts('pending');

    expect(result.alerts[0].userName).toBe('Destiny Clark');
  });

  it('falls back to "Unknown User" when user has no name', async () => {
    const prisma = makePrisma(makeAlert({ user: { firstName: null, lastName: null } }));
    const { service } = await buildService(prisma);

    const result = await service.listAlerts('pending');

    expect(result.alerts[0].userName).toBe('Unknown User');
  });

  it('formats triggerReason from trigger signals', async () => {
    const prisma = makePrisma(
      makeAlert({ triggerSignals: { linkedAccounts: 5, deviceFingerprints: 2, fraudFlagCount: 0, disputeCount: 0, accountAgeDays: 90, totalTrips: 10 } }),
    );
    const { service } = await buildService(prisma);

    const result = await service.listAlerts('pending');

    expect(result.alerts[0].triggerReason).toContain('5 linked accounts');
  });

  it('returns holdActive=false when holdReleasedAt is set', async () => {
    const prisma = makePrisma(makeAlert({ holdReleasedAt: new Date(), status: 'cleared' }));
    const { service } = await buildService(prisma);

    const result = await service.listAlerts('reviewed');

    expect(result.alerts[0].holdActive).toBe(false);
  });

  it('returns pagination metadata', async () => {
    const { service } = await buildService();

    const result = await service.listAlerts('pending', 1, 50);

    expect(result).toMatchObject({ total: 1, page: 1, pages: 1 });
  });
});

// ─── markUnderReview ─────────────────────────────────────────────────────────

describe('FraudService — markUnderReview', () => {
  it('updates status to under_review when alert is pending', async () => {
    const { service, prisma } = await buildService();

    await service.markUnderReview(ALERT_ID, ADMIN_ID);

    expect(prisma.fraudAlert.update).toHaveBeenCalledWith({
      where: { id: ALERT_ID },
      data: { status: 'under_review' },
    });
  });

  it('writes an audit log', async () => {
    const { service, audit } = await buildService();

    await service.markUnderReview(ALERT_ID, ADMIN_ID);

    expect(audit.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fraud.mark_under_review',
        targetId: ALERT_ID,
        adminId: ADMIN_ID,
      }),
    );
  });

  it('is a no-op (no update) when alert is already under_review', async () => {
    const prisma = makePrisma(makeAlert({ status: 'under_review' }));
    const { service } = await buildService(prisma);

    await service.markUnderReview(ALERT_ID, ADMIN_ID);

    expect(prisma.fraudAlert.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when alert does not exist', async () => {
    const prisma = makePrisma();
    prisma.fraudAlert.findUnique.mockResolvedValue(null);
    const { service } = await buildService(prisma);

    await expect(service.markUnderReview(ALERT_ID, ADMIN_ID)).rejects.toThrow(NotFoundException);
  });
});

// ─── reviewAlert ─────────────────────────────────────────────────────────────

describe('FraudService — reviewAlert', () => {
  const clearDto: ReviewAlertDto = { decision: 'clear', notes: 'Confirmed legitimate.' };
  const escalateDto: ReviewAlertDto = { decision: 'escalate', notes: 'Escalating to legal.' };

  it('clears the alert: sets status=cleared, holdReleasedAt=now, reviewedById, reviewedAt', async () => {
    const { service, prisma } = await buildService();

    await service.reviewAlert(ALERT_ID, clearDto, ADMIN_ID, 'fraud_admin');

    expect(prisma.fraudAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'cleared',
          decision: 'clear',
          reviewNotes: 'Confirmed legitimate.',
          reviewedById: ADMIN_ID,
          holdReleasedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('escalates the alert: sets status=escalated, holdReleasedAt=null', async () => {
    const { service, prisma } = await buildService();

    await service.reviewAlert(ALERT_ID, escalateDto, ADMIN_ID, 'fraud_admin');

    expect(prisma.fraudAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'escalated',
          decision: 'escalate',
          holdReleasedAt: null,
        }),
      }),
    );
  });

  it('writes an audit log with the decision', async () => {
    const { service, audit } = await buildService();

    await service.reviewAlert(ALERT_ID, clearDto, ADMIN_ID, 'fraud_admin');

    expect(audit.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fraud.clear',
        adminId: ADMIN_ID,
        targetId: ALERT_ID,
        metadata: expect.objectContaining({ decision: 'clear', holdReleased: true }),
      }),
    );
  });

  it('throws ForbiddenException for non-fraud-review roles', async () => {
    const { service } = await buildService();

    await expect(
      service.reviewAlert(ALERT_ID, clearDto, ADMIN_ID, 'support_admin'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException when notes are empty', async () => {
    const { service } = await buildService();

    await expect(
      service.reviewAlert(ALERT_ID, { decision: 'clear', notes: '   ' }, ADMIN_ID, 'fraud_admin'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when alert is already in terminal state', async () => {
    const prisma = makePrisma(makeAlert({ status: 'cleared' }));
    const { service } = await buildService(prisma);

    await expect(
      service.reviewAlert(ALERT_ID, clearDto, ADMIN_ID, 'fraud_admin'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when alert does not exist', async () => {
    const prisma = makePrisma();
    prisma.fraudAlert.findUnique.mockResolvedValue(null);
    const { service } = await buildService(prisma);

    await expect(
      service.reviewAlert(ALERT_ID, clearDto, ADMIN_ID, 'fraud_admin'),
    ).rejects.toThrow(NotFoundException);
  });

  it('founder role is authorized to review', async () => {
    const { service, prisma } = await buildService();

    await service.reviewAlert(ALERT_ID, clearDto, ADMIN_ID, 'founder');

    expect(prisma.fraudAlert.update).toHaveBeenCalled();
  });

  it('super_admin role is authorized to review', async () => {
    const { service, prisma } = await buildService();

    await service.reviewAlert(ALERT_ID, escalateDto, ADMIN_ID, 'super_admin');

    expect(prisma.fraudAlert.update).toHaveBeenCalled();
  });
});
