import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { ConfigService } from '@nestjs/config';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

const COOKIE_NAME = 'admin_session';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip;
    const { token, admin } = await this.adminAuth.login(dto.email, dto.password, ip);

    const ttl = parseInt(this.config.get('ADMIN_SESSION_TTL_SECONDS', '28800'));
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ttl * 1000,
      path: '/',
    });

    return { admin };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.extractCookie(req, COOKIE_NAME);
    if (token) {
      try {
        const payload = this.adminAuth.verifyToken(token);
        await this.adminAuth.logout(payload.sub, payload.email, req.ip);
      } catch {
        // expired or invalid — still clear the cookie
      }
    }

    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return { ok: true };
  }

  @Post('me')
  @HttpCode(HttpStatus.OK)
  me(@Req() req: Request) {
    const token = this.extractCookie(req, COOKIE_NAME);
    if (!token) throw new UnauthorizedException();
    try {
      const payload = this.adminAuth.verifyToken(token);
      return { sub: payload.sub, email: payload.email, role: payload.role };
    } catch {
      throw new UnauthorizedException();
    }
  }

  private extractCookie(req: Request, name: string): string | undefined {
    const header = req.headers['cookie'] ?? '';
    for (const segment of header.split(';')) {
      const [rawKey, ...rest] = segment.trim().split('=');
      if (rawKey === name) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  }
}
