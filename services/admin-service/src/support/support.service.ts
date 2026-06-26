import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { AuditService } from '../audit/audit.service';

// ─── Enums (mirror schema — avoids importing generated types at runtime) ──────
export type TicketCategory =
  | 'payment_issue'
  | 'safety_issue'
  | 'missing_item'
  | 'refund_request'
  | 'driver_complaint'
  | 'rider_complaint'
  | 'background_check_issue'
  | 'account_issue';

export type TicketStatus =
  | 'open'
  | 'in_review'
  | 'waiting_on_user'
  | 'resolved'
  | 'escalated'
  | 'closed';

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export const TICKET_CATEGORIES: TicketCategory[] = [
  'payment_issue',
  'safety_issue',
  'missing_item',
  'refund_request',
  'driver_complaint',
  'rider_complaint',
  'background_check_issue',
  'account_issue',
];

export const TICKET_STATUSES: TicketStatus[] = [
  'open',
  'in_review',
  'waiting_on_user',
  'resolved',
  'escalated',
  'closed',
];

export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

// Safety tickets are auto-escalated to urgent + safety team notified
const SAFETY_CATEGORY = 'safety_issue';

export interface CreateTicketDto {
  userId: string;
  userRole: 'rider' | 'driver';
  category: TicketCategory;
  subject: string;
  body: string;
  priority?: TicketPriority;
  tripId?: string;
  riderId?: string;
  driverId?: string;
}

export interface UpdateStatusDto {
  status: TicketStatus;
  adminId: string;
  ipAddress?: string;
}

export interface AssignTicketDto {
  assignedToId: string;
  adminId: string;
  ipAddress?: string;
}

export interface AddNoteDto {
  adminId: string;
  content: string;
  isInternal?: boolean;
}

export interface ListTicketsDto {
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  assignedToId?: string;
  userId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly audit: AuditService) {}

  // ─── Ticket Creation ──────────────────────────────────────────────────────

  async createTicket(dto: CreateTicketDto) {
    if (!TICKET_CATEGORIES.includes(dto.category)) {
      throw new BadRequestException(`Invalid category: ${dto.category}`);
    }

    // Safety tickets auto-escalate to urgent priority
    const isSafety = dto.category === SAFETY_CATEGORY;
    const priority: TicketPriority = isSafety ? 'urgent' : (dto.priority ?? 'medium');

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: dto.userId,
        userRole: dto.userRole,
        category: dto.category as any,
        status: isSafety ? ('escalated' as any) : ('open' as any),
        priority: priority as any,
        subject: dto.subject,
        body: dto.body,
        tripId: dto.tripId,
        riderId: dto.riderId,
        driverId: dto.driverId,
        escalatedAt: isSafety ? new Date() : null,
      },
    });

    if (isSafety) {
      this.logger.warn(
        `Safety ticket auto-escalated: ${ticket.id} from ${dto.userRole} ${dto.userId}`,
      );
    }

    return ticket;
  }

  // ─── User: get own tickets ────────────────────────────────────────────────

  async getUserTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { notes: { where: { isInternal: false }, orderBy: { createdAt: 'asc' } } },
    });
  }

  async getUserTicket(ticketId: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { notes: { where: { isInternal: false }, orderBy: { createdAt: 'asc' } } },
    });

    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
    if (ticket.userId !== userId) throw new ForbiddenException('Access denied');

    return ticket;
  }

  // ─── Admin: list & get ────────────────────────────────────────────────────

  async listTickets(filters: ListTicketsDto) {
    const { status, category, priority, assignedToId, userId, page = 1, limit = 50 } = filters;

    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (category) where['category'] = category;
    if (priority) where['priority'] = priority;
    if (assignedToId) where['assignedToId'] = assignedToId;
    if (userId) where['userId'] = userId;

    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        include: {
          notes: { orderBy: { createdAt: 'asc' } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { tickets, total, page, pages: Math.ceil(total / limit) };
  }

  async getTicket(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        notes: { orderBy: { createdAt: 'asc' }, include: { admin: { select: { id: true, firstName: true, lastName: true } } } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
    return ticket;
  }

  // ─── Admin: assign ────────────────────────────────────────────────────────

  async assignTicket(ticketId: string, dto: AssignTicketDto) {
    const ticket = await this.requireTicket(ticketId);

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { assignedToId: dto.assignedToId, status: 'in_review' as any },
    });

    await this.audit.createLog({
      adminId: dto.adminId,
      action: 'ticket.assigned',
      targetType: 'support_ticket',
      targetId: ticketId,
      metadata: { assignedToId: dto.assignedToId, previousStatus: ticket.status },
      ipAddress: dto.ipAddress,
    });

    return updated;
  }

  // ─── Admin: update status ─────────────────────────────────────────────────

  async updateStatus(ticketId: string, dto: UpdateStatusDto) {
    const ticket = await this.requireTicket(ticketId);

    const data: Record<string, unknown> = { status: dto.status as any };
    if (dto.status === 'resolved') data['resolvedAt'] = new Date();
    if (dto.status === 'closed') data['closedAt'] = new Date();
    if (dto.status === 'escalated') data['escalatedAt'] = new Date();

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data,
    });

    await this.audit.createLog({
      adminId: dto.adminId,
      action: 'ticket.status_updated',
      targetType: 'support_ticket',
      targetId: ticketId,
      metadata: { from: ticket.status, to: dto.status },
      ipAddress: dto.ipAddress,
    });

    return updated;
  }

  // ─── Admin: add note ──────────────────────────────────────────────────────

  async addNote(ticketId: string, dto: AddNoteDto) {
    await this.requireTicket(ticketId);

    const note = await this.prisma.ticketNote.create({
      data: {
        ticketId,
        adminId: dto.adminId,
        content: dto.content,
        isInternal: dto.isInternal ?? true,
      },
    });

    return note;
  }

  // ─── Admin: resolve ───────────────────────────────────────────────────────

  async resolveTicket(ticketId: string, adminId: string, ipAddress?: string) {
    return this.updateStatus(ticketId, { status: 'resolved', adminId, ipAddress });
  }

  // ─── Admin: escalate ──────────────────────────────────────────────────────

  async escalateTicket(ticketId: string, adminId: string, reason: string, ipAddress?: string) {
    const ticket = await this.requireTicket(ticketId);

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: 'escalated' as any,
        priority: 'urgent' as any,
        escalatedAt: new Date(),
      },
    });

    // Auto-add an internal note with escalation reason
    await this.prisma.ticketNote.create({
      data: {
        ticketId,
        adminId,
        content: `Escalated: ${reason}`,
        isInternal: true,
      },
    });

    await this.audit.createLog({
      adminId,
      action: 'ticket.escalated',
      targetType: 'support_ticket',
      targetId: ticketId,
      metadata: { reason, previousStatus: ticket.status, previousPriority: ticket.priority },
      ipAddress,
    });

    if (ticket.category === SAFETY_CATEGORY) {
      this.logger.warn(`Safety ticket escalated by admin ${adminId}: ${ticketId}`);
    }

    return updated;
  }

  // ─── Admin: stats ─────────────────────────────────────────────────────────

  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [open, inReview, resolvedToday, urgent, avgMs] = await Promise.all([
      this.prisma.supportTicket.count({ where: { status: 'open' as any } }),
      this.prisma.supportTicket.count({ where: { status: 'in_review' as any } }),
      this.prisma.supportTicket.count({
        where: { status: 'resolved' as any, updatedAt: { gte: todayStart } },
      }),
      this.prisma.supportTicket.count({
        where: { priority: 'urgent' as any, status: { notIn: ['resolved', 'closed'] as any[] } },
      }),
      this.prisma.supportTicket
        .findMany({
          where: { status: 'resolved' as any, resolvedAt: { not: null } },
          select: { createdAt: true, resolvedAt: true },
          take: 100,
          orderBy: { resolvedAt: 'desc' },
        })
        .then((tickets) => {
          if (!tickets.length) return 0;
          const total = tickets.reduce(
            (s, t) => s + (t.resolvedAt!.getTime() - t.createdAt.getTime()),
            0,
          );
          return total / tickets.length / (1000 * 60 * 60);
        }),
    ]);

    return {
      openTickets: open,
      inProgressTickets: inReview,
      resolvedToday,
      urgentTickets: urgent,
      avgResolutionHours: Math.round(avgMs * 10) / 10,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async requireTicket(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
    return ticket;
  }
}
