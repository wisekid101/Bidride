import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

// ─── Rate-limit constants ──────────────────────────────────────────────────────
const SMS_MAX_PER_MINUTE = 5;
const CALL_MAX_PER_MINUTE = 3;
const RATE_WINDOW_SECONDS = 60;

// ─── Session TTL after trip completion ────────────────────────────────────────
const SESSION_EXPIRY_HOURS_AFTER_COMPLETION = 24;

export interface ProxySessionData {
  tripId: string;
  twilioSessionSid: string;
  riderParticipantSid: string;
  driverParticipantSid: string;
  riderProxyNumber: string;
  driverProxyNumber: string;
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly twilio: Twilio;
  private readonly proxyServiceSid: string;
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.twilio = new Twilio(
      config.getOrThrow('TWILIO_ACCOUNT_SID'),
      config.getOrThrow('TWILIO_AUTH_TOKEN'),
    );
    this.proxyServiceSid = config.getOrThrow('TWILIO_PROXY_SERVICE_SID');
    this.redis = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
  }

  // ─── Session Lifecycle ────────────────────────────────────────────────────

  async createSession(
    tripId: string,
    riderPhone: string,
    driverPhone: string,
  ): Promise<ProxySessionData> {
    // Prevent duplicate sessions for same trip
    const existing = await this.redis.get(`proxy:session:trip:${tripId}`);
    if (existing) throw new ConflictException(`Proxy session already exists for trip ${tripId}`);

    const expiresAt = new Date(
      Date.now() + SESSION_EXPIRY_HOURS_AFTER_COMPLETION * 3600 * 1000,
    );

    // Create Twilio Proxy session
    const twilioSession = await this.twilio.proxy.v1
      .services(this.proxyServiceSid)
      .sessions.create({
        uniqueName: `bidride-trip-${tripId}`,
        ttl: SESSION_EXPIRY_HOURS_AFTER_COMPLETION * 3600,
      });

    // Add rider participant
    const riderParticipant = await this.twilio.proxy.v1
      .services(this.proxyServiceSid)
      .sessions(twilioSession.sid)
      .participants.create({
        identifier: riderPhone,
        friendlyName: 'rider',
      });

    // Add driver participant
    const driverParticipant = await this.twilio.proxy.v1
      .services(this.proxyServiceSid)
      .sessions(twilioSession.sid)
      .participants.create({
        identifier: driverPhone,
        friendlyName: 'driver',
      });

    const sessionData: ProxySessionData = {
      tripId,
      twilioSessionSid: twilioSession.sid,
      riderParticipantSid: riderParticipant.sid,
      driverParticipantSid: driverParticipant.sid,
      riderProxyNumber: (riderParticipant as any).proxyIdentifier ?? '',
      driverProxyNumber: (driverParticipant as any).proxyIdentifier ?? '',
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    // Persist to DB
    await this.prisma.proxySession.create({
      data: {
        tripId,
        twilioSessionSid: twilioSession.sid,
        riderParticipantSid: riderParticipant.sid,
        driverParticipantSid: driverParticipant.sid,
        expiresAt,
      },
    });

    // Cache in Redis for fast lookup (TTL = session lifetime)
    const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    await this.redis.setex(
      `proxy:session:trip:${tripId}`,
      ttlSeconds,
      JSON.stringify(sessionData),
    );

    await this.auditLog(tripId, 'session.created', {
      twilioSessionSid: twilioSession.sid,
      riderParticipantSid: riderParticipant.sid,
      driverParticipantSid: driverParticipant.sid,
    });

    this.logger.log(`Proxy session created for trip ${tripId}`);
    return sessionData;
  }

  async closeSession(tripId: string): Promise<void> {
    const raw = await this.redis.get(`proxy:session:trip:${tripId}`);
    if (!raw) return;

    const session: ProxySessionData = JSON.parse(raw);
    await this.twilio.proxy.v1
      .services(this.proxyServiceSid)
      .sessions(session.twilioSessionSid)
      .remove();

    await this.redis.del(`proxy:session:trip:${tripId}`);

    await this.prisma.proxySession.updateMany({
      where: { tripId, status: 'active' },
      data: { status: 'closed', closedAt: new Date() },
    });

    await this.auditLog(tripId, 'session.closed', { twilioSessionSid: session.twilioSessionSid });
    this.logger.log(`Proxy session closed for trip ${tripId}`);
  }

  async scheduleExpiry(tripId: string, completedAt: Date): Promise<void> {
    const expiresAt = new Date(
      completedAt.getTime() + SESSION_EXPIRY_HOURS_AFTER_COMPLETION * 3600 * 1000,
    );
    const raw = await this.redis.get(`proxy:session:trip:${tripId}`);
    if (!raw) return;

    const session: ProxySessionData = JSON.parse(raw);
    const updatedSession = { ...session, expiresAt: expiresAt.toISOString() };
    const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    await this.redis.setex(`proxy:session:trip:${tripId}`, ttlSeconds, JSON.stringify(updatedSession));

    await this.twilio.proxy.v1
      .services(this.proxyServiceSid)
      .sessions(session.twilioSessionSid)
      .update({ ttl: ttlSeconds });

    await this.prisma.proxySession.updateMany({
      where: { tripId },
      data: { expiresAt },
    });
  }

  // ─── Masked SMS ───────────────────────────────────────────────────────────

  async sendMaskedSms(
    tripId: string,
    fromRole: 'rider' | 'driver',
    body: string,
  ): Promise<void> {
    const session = await this.requireSession(tripId);
    const participantSid =
      fromRole === 'rider' ? session.riderParticipantSid : session.driverParticipantSid;

    await this.enforceRateLimit(`proxy:sms_rate:${participantSid}`, SMS_MAX_PER_MINUTE, 'SMS');

    try {
      await this.twilio.proxy.v1
        .services(this.proxyServiceSid)
        .sessions(session.twilioSessionSid)
        .participants(participantSid)
        .messageInteractions.create({ body });

      await this.auditLog(tripId, 'sms.sent', { fromRole, participantSid });
    } catch (err) {
      await this.auditLog(tripId, 'sms.failed', { fromRole, participantSid, error: String(err) });
      throw err;
    }
  }

  // ─── Masked Voice Call ────────────────────────────────────────────────────

  async initiateCall(tripId: string, fromRole: 'rider' | 'driver'): Promise<{ proxyNumber: string }> {
    const session = await this.requireSession(tripId);
    const participantSid =
      fromRole === 'rider' ? session.riderParticipantSid : session.driverParticipantSid;
    const proxyNumber =
      fromRole === 'rider' ? session.riderProxyNumber : session.driverProxyNumber;

    await this.enforceRateLimit(`proxy:call_rate:${participantSid}`, CALL_MAX_PER_MINUTE, 'call');

    await this.auditLog(tripId, 'call.started', { fromRole, participantSid });

    // Twilio Proxy handles actual call bridging when the participant calls the proxy number
    return { proxyNumber };
  }

  // ─── Webhook Handlers ─────────────────────────────────────────────────────

  async handleSmsWebhook(payload: Record<string, string>): Promise<void> {
    const { SessionSid, ParticipantSid, Body, MessageStatus } = payload;
    const tripId = await this.tripIdFromSession(SessionSid);

    this.logger.log(`SMS webhook: session=${SessionSid} status=${MessageStatus}`);

    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      await this.auditLog(tripId, 'sms.failed', { SessionSid, ParticipantSid, MessageStatus });
    } else if (MessageStatus === 'delivered') {
      await this.auditLog(tripId, 'sms.sent', { SessionSid, ParticipantSid, body: Body });
    }
  }

  async handleCallWebhook(payload: Record<string, string>): Promise<void> {
    const { SessionSid, ParticipantSid, CallStatus } = payload;
    const tripId = await this.tripIdFromSession(SessionSid);

    this.logger.log(`Call webhook: session=${SessionSid} status=${CallStatus}`);

    if (CallStatus === 'completed') {
      await this.auditLog(tripId, 'call.completed', { SessionSid, ParticipantSid, CallStatus });
    } else if (CallStatus === 'in-progress') {
      await this.auditLog(tripId, 'call.started', { SessionSid, ParticipantSid });
    } else if (CallStatus === 'failed' || CallStatus === 'no-answer') {
      await this.auditLog(tripId, 'call.failed', { SessionSid, ParticipantSid, CallStatus });
    }
  }

  async handleSessionExpiredWebhook(payload: Record<string, string>): Promise<void> {
    const { SessionSid } = payload;
    this.logger.warn(`Proxy session expired via webhook: ${SessionSid}`);

    const record = await this.prisma.proxySession.findFirst({
      where: { twilioSessionSid: SessionSid },
    });
    if (!record) return;

    await this.redis.del(`proxy:session:trip:${record.tripId}`);
    await this.prisma.proxySession.updateMany({
      where: { twilioSessionSid: SessionSid },
      data: { status: 'expired', closedAt: new Date() },
    });

    await this.auditLog(record.tripId, 'session.expired', { SessionSid });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async getSession(tripId: string): Promise<ProxySessionData | null> {
    const raw = await this.redis.get(`proxy:session:trip:${tripId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ProxySessionData;
  }

  private async requireSession(tripId: string): Promise<ProxySessionData> {
    const session = await this.getSession(tripId);
    if (!session) throw new NotFoundException(`No active proxy session for trip ${tripId}`);
    return session;
  }

  private async enforceRateLimit(key: string, max: number, type: string): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, RATE_WINDOW_SECONDS);
    if (count > max) {
      throw new HttpException(`Too many ${type} requests. Slow down.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async tripIdFromSession(twilioSessionSid: string): Promise<string> {
    const record = await this.prisma.proxySession.findFirst({
      where: { twilioSessionSid },
      select: { tripId: true },
    });
    return record?.tripId ?? 'unknown';
  }

  private async auditLog(
    tripId: string,
    event: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.redis.publish(
      'proxy:audit',
      JSON.stringify({ tripId, event, metadata, ts: new Date().toISOString() }),
    );
  }
}
