import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { IsArray, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SkipThrottle } from '@nestjs/throttler';
import { NotificationService } from './notification.service';
import { InternalKeyGuard } from './internal-key.guard';

class TrustedContactDto {
  @IsString()
  phone: string;

  @IsString()
  name: string;
}

class SosContactsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrustedContactDto)
  contacts: TrustedContactDto[];

  @IsString()
  riderName: string;

  @IsString()
  tripId: string;
}

class PushDto {
  @IsString()
  token: string;

  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsOptional()
  data?: Record<string, string>;
}

class PushMultipleDto {
  @IsArray()
  @IsString({ each: true })
  tokens: string[];

  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsOptional()
  data?: Record<string, string>;
}

// S0-B3A: exempt from global throttling. Authenticated by InternalKeyGuard and
// carries safety-critical SOS-contact delivery + fire-and-forget push dispatch —
// generic rate-limiting must never drop these internal service-to-service calls.
@SkipThrottle()
@Controller('internal/notifications')
@UseGuards(InternalKeyGuard)
export class InternalNotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Post('sos-contacts')
  @HttpCode(HttpStatus.OK)
  async notifySosContacts(@Body() dto: SosContactsDto) {
    await Promise.allSettled(
      dto.contacts.map((c) =>
        this.notifications.notifySosTrustedContact(c.phone, dto.riderName, dto.tripId),
      ),
    );
    return { notified: dto.contacts.length };
  }

  @Post('push')
  @HttpCode(HttpStatus.OK)
  async sendPush(@Body() dto: PushDto) {
    await this.notifications.sendPush(dto.token, dto.title, dto.body, dto.data);
    return { sent: true };
  }

  @Post('push-multiple')
  @HttpCode(HttpStatus.OK)
  async sendPushMultiple(@Body() dto: PushMultipleDto) {
    if (dto.tokens.length === 0) return { sent: 0 };
    await this.notifications.sendPushToMultiple(dto.tokens, dto.title, dto.body, dto.data);
    return { sent: dto.tokens.length };
  }
}
