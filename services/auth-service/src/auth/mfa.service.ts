import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';

const APP_NAME = 'BidRide';

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  async generateQrCode(email: string, secret: string): Promise<string> {
    const otpAuthUrl = authenticator.keyuri(email, APP_NAME, secret);
    return qrcode.toDataURL(otpAuthUrl);
  }

  verifyToken(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }

  async setupMfa(userId: string): Promise<{ secret: string; qrCodeDataUrl: string }> {
    const driver = await this.prisma.driver.findUniqueOrThrow({
      where: { userId },
      include: { user: true },
    });

    const secret = this.generateSecret();
    const qrCodeDataUrl = await this.generateQrCode(driver.user.email, secret);

    await this.prisma.driver.update({
      where: { userId },
      data: { user: { update: {} } },
    });

    // Store secret temporarily in Redis until confirmed — not in DB until verified
    return { secret, qrCodeDataUrl };
  }

  async confirmMfaSetup(adminId: string, token: string, secret: string): Promise<void> {
    if (!this.verifyToken(token, secret)) {
      throw new Error('INVALID_MFA_TOKEN');
    }

    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { mfaSecret: secret, mfaEnabled: true },
    });
  }
}
