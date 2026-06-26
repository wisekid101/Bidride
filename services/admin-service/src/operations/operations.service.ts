import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  adminId: string;
  metadata: unknown;
  createdAt: Date;
}

export interface ServiceHealth {
  name: string;
  port: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latencyMs?: number;
  checkedAt: string;
}

export interface SystemMetrics {
  totalTripsToday: number;
  activeTripsNow: number;
  driversOnlineNow: number;
  pendingDriverApprovals: number;
  openFraudAlerts: number;
  openSosEvents: number;
  failedPayoutsLast24h: number;
  avgFareLast24h: number;
}

const SERVICES = [
  { name: 'auth-service', port: 3001 },
  { name: 'trip-service', port: 3002 },
  { name: 'driver-service', port: 3003 },
  { name: 'rider-service', port: 3004 },
  { name: 'pricing-service', port: 3005 },
  { name: 'safety-service', port: 3006 },
  { name: 'payment-service', port: 3007 },
  { name: 'notification-service', port: 3008 },
  { name: 'trust-service', port: 3009 },
  { name: 'airport-service', port: 3010 },
  { name: 'admin-service', port: 3011 },
];

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async checkServiceHealth(): Promise<ServiceHealth[]> {
    const results = await Promise.all(
      SERVICES.map(async (svc) => {
        const start = Date.now();
        try {
          const res = await fetch(`http://localhost:${svc.port}/health/live`, {
            signal: AbortSignal.timeout(3000),
          });
          return {
            name: svc.name,
            port: svc.port,
            status: (res.ok ? 'healthy' : 'degraded') as 'healthy' | 'degraded',
            latencyMs: Date.now() - start,
            checkedAt: new Date().toISOString(),
          };
        } catch {
          return {
            name: svc.name,
            port: svc.port,
            status: 'unhealthy' as const,
            latencyMs: Date.now() - start,
            checkedAt: new Date().toISOString(),
          };
        }
      }),
    );
    return results;
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const minus24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalTripsToday,
      activeTripsNow,
      driversOnlineNow,
      pendingDriverApprovals,
      openFraudAlerts,
      openSosEvents,
      failedPayoutsLast24h,
      fareAgg,
    ] = await Promise.all([
      this.prisma.trip.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.trip.count({ where: { status: { in: ['en_route', 'in_progress'] as any[] } } }),
      this.prisma.driver.count({ where: { isAvailable: true } }),
      this.prisma.driver.count({ where: { status: 'pending' as any } }),
      this.prisma.fraudAlert.count({ where: { status: 'pending' } }),
      this.prisma.sosEvent.count({ where: { resolvedAt: null } }),
      this.prisma.payoutAttempt.count({ where: { status: 'failed', createdAt: { gte: minus24h } } }),
      this.prisma.trip.aggregate({
        where: { createdAt: { gte: minus24h }, status: 'completed' as any, finalFare: { not: null } },
        _avg: { finalFare: true },
      }),
    ]);

    return {
      totalTripsToday,
      activeTripsNow,
      driversOnlineNow,
      pendingDriverApprovals,
      openFraudAlerts,
      openSosEvents,
      failedPayoutsLast24h,
      avgFareLast24h: Number(fareAgg._avg.finalFare ?? 0),
    };
  }

  async getRecentAuditLogs(limit = 50) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        adminId: true,
        metadata: true,
        createdAt: true,
      },
    });
  }

  async getCircuitBreakerStatus() {
    // In-memory circuit breaker state — returns stub metrics
    // Real state would come from Redis in a multi-instance deployment
    return {
      breakers: [
        { name: 'stripe', state: 'closed', failures: 0 },
        { name: 'sagemaker', state: 'closed', failures: 0 },
        { name: 'twilio', state: 'closed', failures: 0 },
        { name: 'flightaware', state: 'closed', failures: 0 },
      ],
      lastUpdated: new Date().toISOString(),
    };
  }
}
