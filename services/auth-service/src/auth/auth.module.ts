import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    MfaService,
    JwtStrategy,
    PrismaService,
  ],
  exports: [TokenService, JwtStrategy],
})
export class AuthModule {}
