import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { TokenService } from './token.service';
import {
  SendOtpDto,
  VerifyOtpDto,
  RefreshTokenDto,
  VerifyMfaDto,
} from './dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly tokenService: TokenService,
  ) {}

  @Post('send-otp')
  @Throttle({ default: { limit: 3, ttl: 600000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async sendOtp(@Body() dto: SendOtpDto): Promise<void> {
    await this.authService.sendOtp(dto.phone, dto.role);
  }

  @Post('verify-otp')
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const result = await this.authService.verifyOtp(dto.phone, dto.code, dto.role);
    return {
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt-refresh'))
  async refresh(@Request() req: any, @Body() dto: RefreshTokenDto) {
    const tokens = await this.authService.refresh(req.user.sub, dto.refreshToken);
    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  async logout(@Request() req: any, @Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(req.user.sub, dto.refreshToken);
  }

  @Post('mfa/setup')
  @UseGuards(AuthGuard('jwt'))
  async setupMfa(@Request() req: any) {
    const result = await this.mfaService.setupMfa(req.user.sub);
    return {
      secret: result.secret,
      qr_code: result.qrCodeDataUrl,
      message: 'Scan the QR code with your authenticator app, then call /auth/mfa/verify.',
    };
  }

  @Post('mfa/verify')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyMfa(
    @Request() req: any,
    @Body() dto: VerifyMfaDto & { secret: string },
  ): Promise<void> {
    await this.mfaService.confirmMfaSetup(req.user.sub, dto.token, dto.secret);
  }
}
