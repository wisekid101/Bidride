import {
  Controller,
  Get,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatService } from './chat.service';

interface AuthRequest extends Request {
  user: { sub: string; role: string };
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Rider or driver: fetch own trip's chat history
  @UseGuards(AuthGuard('jwt'))
  @Get('trips/:tripId/messages')
  async getMessages(@Param('tripId') tripId: string, @Request() req: AuthRequest) {
    const { sub: userId, role } = req.user;
    const isAdmin = role === 'admin';
    return this.chatService.getHistory(tripId, userId, isAdmin);
  }

  // Admin-only: fetch flagged messages for a trip (safety investigations)
  @UseGuards(AuthGuard('jwt'))
  @Get('trips/:tripId/flagged')
  async getFlaggedMessages(@Param('tripId') tripId: string, @Request() req: AuthRequest) {
    const { sub: userId, role } = req.user;
    if (role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    const all = await this.chatService.getHistory(tripId, userId, true);
    return all.filter((m) => m.flagged);
  }
}
