import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { jwtRsaSignerProvider } from './jwt-signer.provider';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    MfaService,
    JwtStrategy,
    JwtRefreshStrategy,
    PrismaService,
    // SEC-RS256-B2: resolves to null unless JWT_SIGNING_ALG=RS256, in which case
    // it validates the KMS key against the keyset before the app finishes booting.
    jwtRsaSignerProvider,
  ],
  exports: [TokenService, JwtStrategy, JwtRefreshStrategy],
})
export class AuthModule {}
