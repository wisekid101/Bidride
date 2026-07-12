import {
  BadGatewayException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, ParseUUIDPipe,
  Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { FounderGuard } from '../auth/founder.guard';
import { AuditService } from '../audit/audit.service';

// ─── Founder Intelligence proxy ───────────────────────────────────────────────
// READ-ONLY intelligence for the Founder. The three mutation endpoints record
// the Founder's DECISION in the recommendation ledger — they never execute a
// product change (no fare, payment, dispatch, account, or config effect).
// Auth: admin session cookie + Founder role; upstream: internal service key.

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';
const UPSTREAM_TIMEOUT_MS = 15_000; // brief generation scans real tables

const BRIEF_TYPES = ['marketplace_health', 'money_map', 'ai_performance'] as const;
const STATUSES = ['proposed', 'viewed', 'adopted', 'dismissed', 'expired', 'outcome_pending', 'outcome_scored'] as const;

class ListRecommendationsDto {
  @IsOptional() @IsString() @MaxLength(50) domain?: string;
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @MaxLength(30) constitutionTag?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class DecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) reason: string;
}

@UseGuards(AdminSessionGuard, FounderGuard, ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/intelligence')
export class IntelligenceController {
  constructor(private readonly audit: AuditService) {}

  @Get('briefs')
  briefs() {
    return this.upstream('GET', '/ai/founder/briefs');
  }

  @Get('briefs/:type')
  brief(@Param('type') type: string, @Query('refresh') refresh?: string) {
    if (!(BRIEF_TYPES as readonly string[]).includes(type)) {
      // Bounded param — never forward arbitrary strings upstream.
      throw new BadGatewayException(`Unknown brief type: ${type}`);
    }
    return this.upstream('GET', `/ai/founder/briefs/${type}${refresh === 'true' ? '?refresh=true' : ''}`);
  }

  @Post('opportunity/generate')
  @HttpCode(HttpStatus.OK)
  async generateOpportunity(@Req() req: any) {
    // Triggers ANALYSIS only — the result is an advisory ledger entry.
    const result = await this.upstream('POST', '/ai/founder/opportunity/generate');
    await this.auditDecision(req, 'intelligence.opportunity.generate', (result as { id?: string })?.id ?? 'none');
    return result;
  }

  @Get('recommendations')
  list(@Query() q: ListRecommendationsDto) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    const qs = params.toString();
    return this.upstream('GET', `/ai/recommendations${qs ? `?${qs}` : ''}`);
  }

  @Get('recommendations/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.upstream('GET', `/ai/recommendations/${id}`);
  }

  @Post('recommendations/:id/view')
  @HttpCode(HttpStatus.OK)
  async view(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const result = await this.upstream('POST', `/ai/recommendations/${id}/view`, this.actor(req));
    await this.auditDecision(req, 'intelligence.recommendation.view', id);
    return result;
  }

  @Post('recommendations/:id/adopt')
  @HttpCode(HttpStatus.OK)
  async adopt(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto, @Req() req: any) {
    // Records the decision ONLY. Any execution is a separate approved workflow.
    const result = await this.upstream('POST', `/ai/recommendations/${id}/adopt`, { ...this.actor(req), reason: body.reason });
    await this.auditDecision(req, 'intelligence.recommendation.adopt', id, body.reason);
    return result;
  }

  @Post('recommendations/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto, @Req() req: any) {
    const result = await this.upstream('POST', `/ai/recommendations/${id}/dismiss`, { ...this.actor(req), reason: body.reason });
    await this.auditDecision(req, 'intelligence.recommendation.dismiss', id, body.reason);
    return result;
  }

  private actor(req: any): { actor: string; actorRole: string } {
    return { actor: req.adminUser?.email ?? req.adminUser?.sub ?? 'unknown-admin', actorRole: req.adminUser?.role ?? 'unknown' };
  }

  private async auditDecision(req: any, action: string, id: string, reason?: string): Promise<void> {
    try {
      await this.audit.createLog({
        adminId: req.adminUser?.sub,
        action,
        targetType: 'ai_recommendation',
        targetId: id,
        metadata: reason ? { reason } : {},
        ipAddress: req.ip,
      });
    } catch {
      // Audit failure must not block the response — the ledger's own event row
      // is the authoritative decision record.
    }
  }

  private async upstream(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${AI_SERVICE_URL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Intelligence service unreachable');
    }
    const data = await res.json().catch(() => ({ message: 'Invalid upstream response' }));
    if (!res.ok) {
      // Pass upstream errors through safely: status + message only, no
      // internals. Client errors (409 illegal transition, 422 validation)
      // keep their real status so the portal can react; 5xx collapses to 502.
      const body = {
        statusCode: res.status,
        message: (data as { message?: unknown }).message ?? 'Upstream error',
        errors: (data as { errors?: unknown }).errors,
      };
      if (res.status >= 400 && res.status < 500) throw new HttpException(body, res.status);
      throw new BadGatewayException(body);
    }
    return data;
  }
}
