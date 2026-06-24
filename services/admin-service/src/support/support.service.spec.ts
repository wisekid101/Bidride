import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportService, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from './support.service';
import { AuditService } from '../audit/audit.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TICKET_ID = 'ticket-uuid-0001';
const USER_ID = 'user-uuid-0001';
const ADMIN_ID = 'admin-uuid-0001';
const ASSIGNEE_ID = 'admin-uuid-0002';

const makeTicket = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  userId: USER_ID,
  userRole: 'rider',
  riderId: null,
  driverId: null,
  tripId: null,
  assignedToId: null,
  category: 'payment_issue',
  status: 'open',
  priority: 'medium',
  subject: 'Overcharged for my ride',
  body: 'I was charged $50 for a $20 ride.',
  escalatedAt: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeNote = (overrides: Record<string, unknown> = {}) => ({
  id: 'note-uuid-0001',
  ticketId: TICKET_ID,
  adminId: ADMIN_ID,
  content: 'Looking into this.',
  isInternal: true,
  createdAt: new Date(),
  ...overrides,
});

const makePrisma = (ticket = makeTicket()) => ({
  $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
  supportTicket: {
    create: jest.fn().mockResolvedValue(ticket),
    findUnique: jest.fn().mockResolvedValue(ticket),
    findMany: jest.fn().mockResolvedValue([ticket]),
    update: jest.fn().mockResolvedValue(ticket),
    count: jest.fn().mockResolvedValue(1),
  },
  ticketNote: {
    create: jest.fn().mockResolvedValue(makeNote()),
  },
});

const makeAudit = () => ({
  createLog: jest.fn().mockResolvedValue(undefined),
});

async function buildService(prismaOverride?: ReturnType<typeof makePrisma>) {
  const prisma = prismaOverride ?? makePrisma();
  const audit = makeAudit();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SupportService,
      { provide: AuditService, useValue: audit },
    ],
  }).compile();

  const service = module.get<SupportService>(SupportService);
  // Inject mock prisma directly
  (service as any).prisma = prisma;

  return { service, prisma, audit };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SupportService', () => {
  describe('createTicket', () => {
    it('creates a standard ticket with default medium priority', async () => {
      const { service, prisma } = await buildService();

      await service.createTicket({
        userId: USER_ID,
        userRole: 'rider',
        category: 'payment_issue',
        subject: 'Overcharged',
        body: 'Please help',
      });

      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_ID,
            userRole: 'rider',
            category: 'payment_issue',
            status: 'open',
            priority: 'medium',
          }),
        }),
      );
    });

    it('auto-escalates safety tickets to urgent priority', async () => {
      const { service, prisma } = await buildService();

      await service.createTicket({
        userId: USER_ID,
        userRole: 'rider',
        category: 'safety_issue',
        subject: 'Unsafe driver',
        body: 'Driver was speeding.',
      });

      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: 'safety_issue',
            status: 'escalated',
            priority: 'urgent',
            escalatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('respects explicitly provided priority', async () => {
      const { service, prisma } = await buildService();

      await service.createTicket({
        userId: USER_ID,
        userRole: 'driver',
        category: 'account_issue',
        subject: 'Cannot log in',
        body: 'My account is locked.',
        priority: 'high',
      });

      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'high' }),
        }),
      );
    });

    it('throws BadRequestException for invalid category', async () => {
      const { service } = await buildService();

      await expect(
        service.createTicket({
          userId: USER_ID,
          userRole: 'rider',
          category: 'invalid_category' as any,
          subject: 'test',
          body: 'test',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('links optional tripId, riderId, driverId', async () => {
      const { service, prisma } = await buildService();

      await service.createTicket({
        userId: USER_ID,
        userRole: 'rider',
        category: 'refund_request',
        subject: 'Refund needed',
        body: 'Please refund trip.',
        tripId: 'trip-001',
        riderId: 'rider-001',
      });

      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tripId: 'trip-001', riderId: 'rider-001' }),
        }),
      );
    });

    it('creates tickets for all 8 valid categories', async () => {
      const { service, prisma } = await buildService();

      for (const category of TICKET_CATEGORIES) {
        await service.createTicket({ userId: USER_ID, userRole: 'rider', category, subject: 'Test', body: 'Test' });
      }

      expect(prisma.supportTicket.create).toHaveBeenCalledTimes(TICKET_CATEGORIES.length);
    });
  });

  describe('getUserTickets', () => {
    it('returns tickets belonging to the user', async () => {
      const { service } = await buildService();

      const tickets = await service.getUserTickets(USER_ID);

      expect(tickets).toHaveLength(1);
      expect(tickets[0].userId).toBe(USER_ID);
    });
  });

  describe('getUserTicket', () => {
    it('returns the ticket when userId matches', async () => {
      const { service } = await buildService();

      const ticket = await service.getUserTicket(TICKET_ID, USER_ID);

      expect(ticket.id).toBe(TICKET_ID);
    });

    it('throws NotFoundException when ticket does not exist', async () => {
      const prisma = makePrisma();
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      const { service } = await buildService(prisma);

      await expect(service.getUserTicket(TICKET_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when userId does not match', async () => {
      const { service } = await buildService();

      await expect(service.getUserTicket(TICKET_ID, 'other-user-id')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listTickets', () => {
    it('returns paginated ticket list with total', async () => {
      const { service } = await buildService();

      const result = await service.listTickets({ page: 1, limit: 10 });

      expect(result.tickets).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('calculates page count correctly', async () => {
      const prisma = makePrisma();
      prisma.supportTicket.count.mockResolvedValue(105);
      const { service } = await buildService(prisma);

      const result = await service.listTickets({ limit: 50 });

      expect(result.pages).toBe(3);
    });

    it('filters by status', async () => {
      const { service, prisma } = await buildService();

      await service.listTickets({ status: 'open' });

      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'open' }) }),
      );
    });

    it('filters by category', async () => {
      const { service, prisma } = await buildService();

      await service.listTickets({ category: 'safety_issue' });

      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'safety_issue' }) }),
      );
    });

    it('filters by priority', async () => {
      const { service, prisma } = await buildService();

      await service.listTickets({ priority: 'urgent' });

      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ priority: 'urgent' }) }),
      );
    });
  });

  describe('assignTicket', () => {
    it('assigns ticket and sets status to in_review', async () => {
      const { service, prisma } = await buildService();

      await service.assignTicket(TICKET_ID, { assignedToId: ASSIGNEE_ID, adminId: ADMIN_ID });

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TICKET_ID },
          data: expect.objectContaining({ assignedToId: ASSIGNEE_ID, status: 'in_review' }),
        }),
      );
    });

    it('writes an audit log for assignment', async () => {
      const { service, audit } = await buildService();

      await service.assignTicket(TICKET_ID, { assignedToId: ASSIGNEE_ID, adminId: ADMIN_ID });

      expect(audit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ticket.assigned', targetId: TICKET_ID }),
      );
    });

    it('throws NotFoundException when ticket does not exist', async () => {
      const prisma = makePrisma();
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      const { service } = await buildService(prisma);

      await expect(
        service.assignTicket(TICKET_ID, { assignedToId: ASSIGNEE_ID, adminId: ADMIN_ID }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates status and sets resolvedAt when resolving', async () => {
      const { service, prisma } = await buildService();

      await service.updateStatus(TICKET_ID, { status: 'resolved', adminId: ADMIN_ID });

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
        }),
      );
    });

    it('sets closedAt when closing', async () => {
      const { service, prisma } = await buildService();

      await service.updateStatus(TICKET_ID, { status: 'closed', adminId: ADMIN_ID });

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'closed', closedAt: expect.any(Date) }),
        }),
      );
    });

    it('sets escalatedAt when escalating via status update', async () => {
      const { service, prisma } = await buildService();

      await service.updateStatus(TICKET_ID, { status: 'escalated', adminId: ADMIN_ID });

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'escalated', escalatedAt: expect.any(Date) }),
        }),
      );
    });

    it('writes an audit log for status update', async () => {
      const { service, audit } = await buildService();

      await service.updateStatus(TICKET_ID, { status: 'in_review', adminId: ADMIN_ID });

      expect(audit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ticket.status_updated',
          metadata: expect.objectContaining({ from: 'open', to: 'in_review' }),
        }),
      );
    });
  });

  describe('addNote', () => {
    it('adds an internal note to the ticket', async () => {
      const { service, prisma } = await buildService();

      await service.addNote(TICKET_ID, {
        adminId: ADMIN_ID,
        content: 'Checked with payments team.',
        isInternal: true,
      });

      expect(prisma.ticketNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketId: TICKET_ID,
            adminId: ADMIN_ID,
            content: 'Checked with payments team.',
            isInternal: true,
          }),
        }),
      );
    });

    it('defaults isInternal to true when not specified', async () => {
      const { service, prisma } = await buildService();

      await service.addNote(TICKET_ID, { adminId: ADMIN_ID, content: 'Note.' });

      expect(prisma.ticketNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isInternal: true }),
        }),
      );
    });

    it('throws NotFoundException when ticket does not exist', async () => {
      const prisma = makePrisma();
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      const { service } = await buildService(prisma);

      await expect(
        service.addNote(TICKET_ID, { adminId: ADMIN_ID, content: 'Note.' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveTicket', () => {
    it('resolves ticket and sets resolvedAt', async () => {
      const { service, prisma } = await buildService();

      await service.resolveTicket(TICKET_ID, ADMIN_ID);

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('escalateTicket', () => {
    it('escalates ticket to urgent and sets escalatedAt', async () => {
      const { service, prisma } = await buildService();

      await service.escalateTicket(TICKET_ID, ADMIN_ID, 'Rider reports physical threat');

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'escalated',
            priority: 'urgent',
            escalatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('auto-adds internal note with escalation reason', async () => {
      const { service, prisma } = await buildService();

      await service.escalateTicket(TICKET_ID, ADMIN_ID, 'Physical threat reported');

      expect(prisma.ticketNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining('Physical threat reported'),
            isInternal: true,
          }),
        }),
      );
    });

    it('writes an audit log for escalation', async () => {
      const { service, audit } = await buildService();

      await service.escalateTicket(TICKET_ID, ADMIN_ID, 'Safety concern');

      expect(audit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ticket.escalated',
          metadata: expect.objectContaining({ reason: 'Safety concern' }),
        }),
      );
    });

    it('throws NotFoundException when ticket does not exist', async () => {
      const prisma = makePrisma();
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      const { service } = await buildService(prisma);

      await expect(
        service.escalateTicket(TICKET_ID, ADMIN_ID, 'reason'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('constants', () => {
    it('exports exactly 8 ticket categories', () => {
      expect(TICKET_CATEGORIES).toHaveLength(8);
    });

    it('exports exactly 6 ticket statuses', () => {
      expect(TICKET_STATUSES).toHaveLength(6);
    });

    it('exports exactly 4 priority levels', () => {
      expect(TICKET_PRIORITIES).toHaveLength(4);
    });

    it('includes all required categories', () => {
      const required = [
        'payment_issue', 'safety_issue', 'missing_item', 'refund_request',
        'driver_complaint', 'rider_complaint', 'background_check_issue', 'account_issue',
      ];
      for (const cat of required) {
        expect(TICKET_CATEGORIES).toContain(cat);
      }
    });

    it('includes all required statuses', () => {
      const required = ['open', 'in_review', 'waiting_on_user', 'resolved', 'escalated', 'closed'];
      for (const status of required) {
        expect(TICKET_STATUSES).toContain(status);
      }
    });

    it('includes all required priority levels', () => {
      expect(TICKET_PRIORITIES).toContain('low');
      expect(TICKET_PRIORITIES).toContain('medium');
      expect(TICKET_PRIORITIES).toContain('high');
      expect(TICKET_PRIORITIES).toContain('urgent');
    });
  });
});
