import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const QUICK_REPLIES = [
  "I'm here",
  'Be right there',
  'Meet at pickup point',
  'Please confirm location',
] as const;

// Statuses that allow chat
const CHAT_ALLOWED_STATUSES = new Set([
  'accepted',
  'driver_en_route',
  'driver_arrived',
  'in_progress',
]);

// Hours chat history is retained after trip completion
const CHAT_EXPIRY_HOURS = 24;

// Simple keyword moderation list — extend as needed
const ABUSE_KEYWORDS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'nigger',
  'faggot',
  'retard',
  'whore',
  'slut',
];

export interface ChatMessageDto {
  id: string;
  tripId: string;
  senderId: string;
  senderRole: string;
  content: string;
  messageType: string;
  readAt: Date | null;
  flagged: boolean;
  flagReason: string | null;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendMessage(
    tripId: string,
    senderId: string,
    senderRole: 'rider' | 'driver',
    content: string,
    messageType: 'text' | 'quick_reply' = 'text',
  ): Promise<ChatMessageDto> {
    // Validate trip allows chat
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, riderId: true, driverId: true, status: true, completedAt: true },
    });

    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);

    // Enforce participant-only access
    if (trip.riderId !== senderId && trip.driverId !== senderId) {
      throw new ForbiddenException('Only trip participants can send messages');
    }

    // Enforce status gate
    if (!CHAT_ALLOWED_STATUSES.has(trip.status as string)) {
      throw new ForbiddenException(`Chat is not available for trip status: ${trip.status}`);
    }

    // Enforce 24h expiry after completion
    if (trip.completedAt) {
      const expiresAt = new Date(trip.completedAt.getTime() + CHAT_EXPIRY_HOURS * 3600 * 1000);
      if (new Date() > expiresAt) {
        throw new ForbiddenException('Chat session has expired');
      }
    }

    // Validate quick reply content
    if (messageType === 'quick_reply' && !(QUICK_REPLIES as readonly string[]).includes(content)) {
      throw new ForbiddenException('Invalid quick reply content');
    }

    // Moderation
    const { flagged, flagReason } = this.moderateContent(content);
    if (flagged) {
      this.logger.warn(`Flagged message from ${senderRole} ${senderId} in trip ${tripId}: ${flagReason}`);
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        tripId,
        senderId,
        senderRole,
        content,
        messageType,
        flagged,
        flagReason,
      },
    });

    return message as ChatMessageDto;
  }

  async markRead(messageId: string, readerId: string): Promise<ChatMessageDto> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { trip: { select: { riderId: true, driverId: true } } },
    });

    if (!message) throw new NotFoundException(`Message ${messageId} not found`);

    // Only the recipient (not the sender) can mark as read
    const { riderId, driverId } = message.trip;
    if (message.senderId === readerId) {
      throw new ForbiddenException('Sender cannot mark own message as read');
    }
    if (readerId !== riderId && readerId !== driverId) {
      throw new ForbiddenException('Only trip participants can mark messages as read');
    }

    if (message.readAt) return message as unknown as ChatMessageDto;

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { readAt: new Date() },
    });

    return updated as ChatMessageDto;
  }

  async getHistory(tripId: string, requesterId: string, isAdmin = false): Promise<ChatMessageDto[]> {
    if (!isAdmin) {
      const trip = await this.prisma.trip.findUnique({
        where: { id: tripId },
        select: { riderId: true, driverId: true },
      });
      if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);
      if (trip.riderId !== requesterId && trip.driverId !== requesterId) {
        throw new ForbiddenException('Only trip participants or admins can view chat history');
      }
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: { tripId },
      orderBy: { createdAt: 'asc' },
    });

    return messages as ChatMessageDto[];
  }

  isChatExpired(completedAt: Date | null): boolean {
    if (!completedAt) return false;
    const expiresAt = new Date(completedAt.getTime() + CHAT_EXPIRY_HOURS * 3600 * 1000);
    return new Date() > expiresAt;
  }

  private moderateContent(content: string): { flagged: boolean; flagReason: string | null } {
    const lower = content.toLowerCase();
    const found = ABUSE_KEYWORDS.find((kw) => lower.includes(kw));
    if (found) {
      return { flagged: true, flagReason: `Contains prohibited term: "${found}"` };
    }
    return { flagged: false, flagReason: null };
  }
}
