import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';

export interface CreateLogInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private prisma = new PrismaClient();

  async createLog(input: CreateLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        adminId: input.adminId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: (input.metadata ?? {}) as any,
        ipAddress: input.ipAddress,
      },
    });
  }

  async getAuditLogs(filters: {
    adminId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const { adminId, action, targetType, targetId, from, to, page = 1, limit = 100 } = filters;

    const where: Record<string, unknown> = {};
    if (adminId) where.adminId = adminId;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as any).gte = new Date(from);
      if (to) (where.createdAt as any).lte = new Date(to);
    }

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { email: true, adminRole: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total, page, pages: Math.ceil(total / limit) };
  }
}
