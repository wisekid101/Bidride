import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { ChatService, QUICK_REPLIES } from './chat.service';

interface JwtPayload {
  sub: string;
  role: 'rider' | 'driver' | 'admin';
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: process.env.ALLOWED_WS_ORIGINS?.split(',').map(o => o.trim()) ?? '*',
    credentials: !!process.env.ALLOWED_WS_ORIGINS,
  },
  transports: ['websocket'],
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly chatService: ChatService,
  ) {}

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
      socket.emit('chat:connected', { userId: payload.sub });
    } catch {
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket): void {
    this.logger.debug(`Chat socket disconnected: ${socket.id}`);
  }

  // ─── Subscribe to trip chat room ──────────────────────────────────────────

  @SubscribeMessage('chat:join')
  handleJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { tripId: string },
  ) {
    if (!socket.data.userId) throw new WsException('Unauthenticated');
    socket.join(`chat:${data.tripId}`);
    return { joined: true, tripId: data.tripId };
  }

  // ─── Send message ─────────────────────────────────────────────────────────

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { tripId: string; content: string; messageType?: 'text' | 'quick_reply' },
  ) {
    const userId = socket.data.userId as string;
    const role = socket.data.role as 'rider' | 'driver';
    if (!userId || (role !== 'rider' && role !== 'driver')) {
      throw new WsException('Unauthenticated or invalid role');
    }

    try {
      const message = await this.chatService.sendMessage(
        data.tripId,
        userId,
        role,
        data.content,
        data.messageType ?? 'text',
      );

      // Broadcast to everyone in the trip chat room (including sender for ack)
      this.server.to(`chat:${data.tripId}`).emit('chat:message', message);

      return { ok: true };
    } catch (err) {
      throw new WsException((err as Error).message);
    }
  }

  // ─── Read receipt ─────────────────────────────────────────────────────────

  @SubscribeMessage('chat:read')
  async handleRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const userId = socket.data.userId as string;
    if (!userId) throw new WsException('Unauthenticated');

    try {
      const updated = await this.chatService.markRead(data.messageId, userId);

      // Notify the trip room of the read receipt
      this.server.to(`chat:${updated.tripId}`).emit('chat:read', {
        messageId: updated.id,
        readAt: updated.readAt,
        readBy: userId,
      });

      return { ok: true };
    } catch (err) {
      throw new WsException((err as Error).message);
    }
  }

  // ─── Typing indicator ─────────────────────────────────────────────────────

  @SubscribeMessage('chat:typing')
  handleTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { tripId: string; isTyping: boolean },
  ) {
    const userId = socket.data.userId as string;
    const role = socket.data.role as string;
    if (!userId) throw new WsException('Unauthenticated');

    // Broadcast typing status to the other party in the room
    socket.to(`chat:${data.tripId}`).emit('chat:typing', {
      userId,
      role,
      isTyping: data.isTyping,
    });

    return { ok: true };
  }

  // ─── Quick replies list ────────────────────────────────────────────────────

  @SubscribeMessage('chat:quick-replies')
  handleQuickReplies() {
    return { quickReplies: QUICK_REPLIES };
  }

  // ─── Programmatic helpers ─────────────────────────────────────────────────

  emitToTrip(tripId: string, event: string, data: unknown): void {
    this.server.to(`chat:${tripId}`).emit(event, data);
  }
}
