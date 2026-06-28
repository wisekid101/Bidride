import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { JwtPayload } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

const DRIVER_SESSION_TTL_SEC = 86400; // 24h max session key lifetime
const DRIVER_ZONE_TTL_SEC = 30;       // Zone key heartbeat — removed on disconnect

function getZoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_WS_ORIGINS?.split(',').map(o => o.trim()) ?? '*',
    credentials: !!process.env.ALLOWED_WS_ORIGINS,
  },
  transports: ['websocket'],
})
export class WebSocketEventGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly userSockets = new Map<string, string[]>(); // userId → socketIds[]
  private subscriber: Redis;

  constructor(
    private readonly jwt: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {
    // Separate Redis client for subscription (can't use same client for both pub/sub and commands)
    this.subscriber = redis.duplicate();
    this.setupRedisSubscriptions();
  }

  async handleConnection(socket: Socket): Promise<void> {
    const token = socket.handshake.auth?.token as string;
    if (!token) {
      socket.disconnect();
      return;
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;

      // Track socket → user mapping
      const existing = this.userSockets.get(payload.sub) ?? [];
      this.userSockets.set(payload.sub, [...existing, socket.id]);

      // Join role-specific room
      socket.join(`${payload.role}:${payload.sub}`);

      // For admins: join admin broadcast room
      if ((payload.role as string) === 'admin') {
        socket.join('admin:broadcast');
      }

      // Open driver session log
      if (payload.role === 'driver') {
        void (async () => {
          try {
            const log = await this.prisma.driverSessionLog.create({
              data: { driverUserId: payload.sub },
              select: { id: true },
            });
            await this.redis.setex(`driver:${payload.sub}:session_log_id`, DRIVER_SESSION_TTL_SEC, log.id);
          } catch {}
        })();
      }

      socket.emit('connected', { userId: payload.sub });
    } catch {
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket): void {
    const userId = socket.data.userId as string;
    if (!userId) return;

    const sockets = (this.userSockets.get(userId) ?? []).filter((id) => id !== socket.id);
    if (sockets.length === 0) {
      this.userSockets.delete(userId);
    } else {
      this.userSockets.set(userId, sockets);
    }

    // Close driver session log and remove from surge:drivers zone
    if (socket.data.role === 'driver') {
      void (async () => {
        try {
          const [logId, zone] = await Promise.all([
            this.redis.get(`driver:${userId}:session_log_id`),
            this.redis.get(`driver:${userId}:zone`),
          ]);
          if (logId) {
            const endedAt = new Date();
            const log = await this.prisma.driverSessionLog.findUnique({
              where: { id: logId },
              select: { startedAt: true },
            });
            await this.prisma.driverSessionLog.update({
              where: { id: logId },
              data: {
                endedAt,
                durationSec: log
                  ? Math.round((endedAt.getTime() - log.startedAt.getTime()) / 1000)
                  : null,
              },
            });
            await this.redis.del(`driver:${userId}:session_log_id`);
          }
          if (zone) {
            await this.redis.srem(`surge:drivers:${zone}`, userId);
            await this.redis.del(`driver:${userId}:zone`);
          }
        } catch {}
      })();
    }
  }

  @SubscribeMessage('subscribe:trip')
  handleTripSubscription(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { tripId: string },
  ) {
    socket.join(`trip:${data.tripId}`);
    return { subscribed: true, tripId: data.tripId };
  }

  @SubscribeMessage('driver:location')
  handleDriverLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { lat: number; lng: number; heading?: number; tripId?: string },
  ) {
    const userId = socket.data.userId as string;
    if (socket.data.role !== 'driver') return;

    // Cache driver location in Redis (TTL 10s)
    this.redis.setex(
      `driver:${userId}:location`,
      10,
      JSON.stringify({ lat: data.lat, lng: data.lng, heading: data.heading, ts: Date.now() }),
    );

    // Maintain surge:drivers:{zone} Set for AI demand/supply tracking
    void (async () => {
      try {
        const zone = getZoneKey(data.lat, data.lng);
        const prevZone = await this.redis.get(`driver:${userId}:zone`);
        if (prevZone !== zone) {
          if (prevZone) await this.redis.srem(`surge:drivers:${prevZone}`, userId);
          await this.redis.sadd(`surge:drivers:${zone}`, userId);
        }
        await this.redis.setex(`driver:${userId}:zone`, DRIVER_ZONE_TTL_SEC, zone);
      } catch {}
    })();

    // Broadcast to rider if in active trip
    if (data.tripId) {
      this.server.to(`trip:${data.tripId}`).emit('driver:location', {
        lat: data.lat,
        lng: data.lng,
        heading: data.heading,
      });

      // Trigger route deviation monitoring in safety-service (async, non-blocking)
      this.redis.publish(
        'safety:location:update',
        JSON.stringify({ tripId: data.tripId, lat: data.lat, lng: data.lng }),
      ).catch(() => {});
    }
  }

  // ─── Redis Pub/Sub Consumer ───────────────────────────────────────────────

  private async setupRedisSubscriptions(): Promise<void> {
    // Exact-match channels
    await this.subscriber.subscribe(
      'dispatch:requests',
      'safety:sos',
      'safety:panic',
      'safety:anomaly',
      'notifications',
      'admin:broadcast',
    );

    // Pattern-match channels — rider/driver trip events and user-targeted events
    await this.subscriber.psubscribe(
      'rider:trip:*',
      'driver:trip:*',
      'user:*:events',
    );

    this.subscriber.on('message', (channel: string, message: string) => {
      this.routeMessage(channel, message);
    });

    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      this.routeMessage(channel, message);
    });
  }

  private routeMessage(channel: string, message: string): void {
    try {
      const data = JSON.parse(message) as Record<string, unknown>;
      const event = data['event'] as string;

      if (channel === 'safety:sos' || channel === 'safety:panic' || channel === 'safety:anomaly') {
        this.server.to('admin:broadcast').emit(event, data);
      } else if (channel === 'dispatch:requests') {
        this.server.emit('request:incoming', data);
      } else if (channel.startsWith('rider:trip:')) {
        const tripId = channel.replace('rider:trip:', '');
        this.server.to(`trip:${tripId}`).emit(event, data);
      } else if (channel.startsWith('driver:trip:')) {
        const tripId = channel.replace('driver:trip:', '');
        this.server.to(`trip:${tripId}`).emit(event, data);
      } else if (channel.startsWith('user:') && channel.endsWith(':events')) {
        // Targeted event for a specific user (e.g. bid counter accepted/declined)
        const userId = channel.slice('user:'.length, -':events'.length);
        this.server.to(`rider:${userId}`).emit(event, data);
        this.server.to(`driver:${userId}`).emit(event, data);
      } else if (channel === 'admin:broadcast') {
        this.server.to('admin:broadcast').emit(event, data);
      }
    } catch (err) {
      console.error('WebSocket routing error:', err);
    }
  }

  // ─── Programmatic emit helpers ────────────────────────────────────────────

  emitToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`rider:${userId}`).emit(event, data);
    this.server.to(`driver:${userId}`).emit(event, data);
  }

  emitToAdmins(event: string, data: unknown): void {
    this.server.to('admin:broadcast').emit(event, data);
  }
}
