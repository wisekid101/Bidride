import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { TokenService, TokenPair } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  async sendOtp(phone: string, role: UserRole): Promise<void> {
    await this.otp.sendOtp(phone);
  }

  async verifyOtp(
    phone: string,
    code: string,
    role: UserRole,
  ): Promise<{ tokens: TokenPair; user: { id: string; role: UserRole; isNew: boolean } }> {
    await this.otp.verifyOtp(phone, code);

    let user = await this.prisma.user.findFirst({
      where: { phone, role, deletedAt: null },
    });

    const isNew = !user;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          email: `${phone.replace(/\D/g, '')}@placeholder.bidride.com`,
          passwordHash: '',
          phoneVerified: true,
          role,
          ...(role === UserRole.rider
            ? { rider: { create: {} } }
            : { driver: { create: { legalFirstName: '', legalLastName: '', dateOfBirth: new Date('2000-01-01') } } }),
        },
      });
    }

    const tokenPair = await this.tokens.issueTokenPair(user.id, role);

    return {
      tokens: tokenPair,
      user: { id: user.id, role: user.role, isNew },
    };
  }

  async refresh(userId: string, refreshToken: string): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return this.tokens.rotateTokenPair(userId, refreshToken);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.tokens.revokeRefreshToken(userId, refreshToken);
  }
}
