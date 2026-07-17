import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { SafetyJwtGuard } from './safety-jwt.guard';
import { SafetyService } from './safety.service';

class InitiateSosDto {
  @IsString() tripId!: string;
  @IsOptional() @IsString() triggerSource?: string;
  @IsOptional() @IsNumber() gpsLat?: number;
  @IsOptional() @IsNumber() gpsLng?: number;
}

class AudioDto {
  @IsString() audioBase64!: string;
  @IsNumber() durationSeconds!: number;
}

class PanicDto {
  @IsString() tripId!: string;
  @IsOptional() @IsNumber() gpsLat?: number;
  @IsOptional() @IsNumber() gpsLng?: number;
}

interface AuthedRequest {
  user: { sub: string; role: string };
}

/**
 * Public rider/driver-facing safety surface. The dev-proxy/ALB forward
 * /safety/* to this service unchanged, so routes live under @Controller('safety').
 * Every route is JWT-guarded; the caller's identity comes from the token, never
 * the body.
 */
@Controller('safety')
@UseGuards(SafetyJwtGuard)
export class SafetyPublicController {
  constructor(private readonly safety: SafetyService) {}

  @Post('sos/initiate')
  initiate(@Req() req: AuthedRequest, @Body() dto: InitiateSosDto) {
    return this.safety.initiateSos(
      dto.tripId,
      req.user.sub,
      dto.triggerSource ?? 'button_tap',
      dto.gpsLat ?? 0,
      dto.gpsLng ?? 0,
    );
  }

  @Post('sos/:id/confirm')
  confirm(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.safety.confirmSos(id, req.user.sub);
  }

  @Post('sos/:id/cancel')
  cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.safety.cancelSos(id, req.user.sub);
  }

  @Post('recordings/:sosId/audio')
  storeAudio(@Req() req: AuthedRequest, @Param('sosId') sosId: string, @Body() dto: AudioDto) {
    return this.safety.storeRecordingAudio(sosId, req.user.sub, dto.audioBase64, dto.durationSeconds);
  }

  @Post('panic')
  panic(@Req() req: AuthedRequest, @Body() dto: PanicDto) {
    return this.safety.triggerPanic(
      dto.tripId,
      req.user.sub,
      req.user.role,
      dto.gpsLat ?? 0,
      dto.gpsLng ?? 0,
    );
  }
}
