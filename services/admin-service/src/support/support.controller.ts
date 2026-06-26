import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import {
  SupportService,
  CreateTicketDto,
  TicketStatus,
  TicketCategory,
  TicketPriority,
} from './support.service';
import { AdminSessionGuard } from '../auth/admin-session.guard';

interface AuthRequest extends Request {
  adminUser: { id: string; role: string };
  ip: string;
}

// ─── User-facing (rider / driver) ─────────────────────────────────────────────

@Controller('support/tickets')
export class UserTicketController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@Body() dto: CreateTicketDto) {
    return this.support.createTicket(dto);
  }

  @Get('user/:userId')
  getUserTickets(@Param('userId') userId: string) {
    return this.support.getUserTickets(userId);
  }

  @Get(':id/user/:userId')
  getUserTicket(@Param('id') id: string, @Param('userId') userId: string) {
    return this.support.getUserTicket(id, userId);
  }
}

// ─── Admin-facing stats ───────────────────────────────────────────────────────

@UseGuards(AdminSessionGuard)
@Controller('admin/support')
export class AdminSupportStatsController {
  constructor(private readonly support: SupportService) {}

  @Get('stats')
  stats() {
    return this.support.getStats();
  }
}

// ─── Admin-facing ─────────────────────────────────────────────────────────────

@UseGuards(AdminSessionGuard)
@Controller('admin/support/tickets')
export class AdminTicketController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(
    @Query('status') status?: TicketStatus,
    @Query('category') category?: TicketCategory,
    @Query('priority') priority?: TicketPriority,
    @Query('assignedToId') assignedToId?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.support.listTickets({
      status,
      category,
      priority,
      assignedToId,
      userId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.support.getTicket(id);
  }

  @Patch(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() body: { assignedToId: string },
    @Request() req: AuthRequest,
  ) {
    return this.support.assignTicket(id, {
      assignedToId: body.assignedToId,
      adminId: req.adminUser.id,
      ipAddress: req.ip,
    });
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: TicketStatus },
    @Request() req: AuthRequest,
  ) {
    return this.support.updateStatus(id, {
      status: body.status,
      adminId: req.adminUser.id,
      ipAddress: req.ip,
    });
  }

  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body() body: { content: string; isInternal?: boolean },
    @Request() req: AuthRequest,
  ) {
    return this.support.addNote(id, {
      adminId: req.adminUser.id,
      content: body.content,
      isInternal: body.isInternal ?? true,
    });
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.support.resolveTicket(id, req.adminUser.id, req.ip);
  }

  @Patch(':id/escalate')
  escalate(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: AuthRequest,
  ) {
    if (!body.reason?.trim()) {
      throw new ForbiddenException('Escalation reason is required');
    }
    return this.support.escalateTicket(id, req.adminUser.id, body.reason, req.ip);
  }
}
