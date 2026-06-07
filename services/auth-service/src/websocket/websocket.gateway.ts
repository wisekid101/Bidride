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

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
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

    // Broadcast to rider if in active trip
    if (data.tripId) {
      this.server.to(`trip:${data.tripId}`).emit('driver:location', {
        lat: data.lat,
        lng: data.lng,
        heading: data.heading,
      });
    }
  }

  // ─── Redis Pub/Sub Consumer ───────────────────────────────────────────────

  private async setupRedisSubscriptions(): Promise<void> {
    await this.subscriber.subscribe(
      'dispatch:requests',
      'safety:sos',
      'safety:panic',
      'safety:anomaly',
      'notifications',
      'rider:trip:*',
      'driver:trip:*',
      'admin:broadcast',
    );

    this.subscriber.on('message', (channel: string, message: string) => {
      this.routeMessage(channel, message);
    });
  }

  private routeMessage(channel: string, message: string): void {
    try {
      const data = JSON.parse(message) as Record<string, unknown>;
      const event = data['event'] as string;

      if (channel === 'safety:sos' || channel === 'safety:panic') {
        // Broadcast to all admin sockets
        this.server.to('admin:broadcast').emit(event, data);
      } else if (channel.startsWith('rider:trip:')) {
        const tripId = channel.replace('rider:trip:', '');
        this.server.to(`trip:${tripId}`).emit(event, data);
      } else if (channel.startsWith('driver:trip:')) {
        const tripId = channel.replace('driver:trip:', '');
        this.server.to(`trip:${tripId}`).emit(event, data);
      } else if (channel === 'dispatch:requests') {
        // In production, would filter to drivers in geographic zone
        // For now broadcasts to all online drivers
        this.server.emit('request:incoming', data);
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
