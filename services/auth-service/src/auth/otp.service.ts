import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Twilio } from 'twilio';
import { REDIS_CLIENT } from '../redis/redis.module';

const OTP_TTL_SECONDS = 300; // 5 minutes
const MAX_ATTEMPTS = 5;
const SEND_LIMIT = 3;
const SEND_WINDOW_SECONDS = 600; // 10 minutes

@Injectable()
export class OtpService {
  private readonly twilio: Twilio;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.twilio = new Twilio(
      config.getOrThrow('TWILIO_ACCOUNT_SID'),
      config.getOrThrow('TWILIO_AUTH_TOKEN'),
    );
  }

  async sendOtp(phone: string): Promise<void> {
    const sendKey = `otp:send_limit:${phone}`;
    const sendCount = await this.redis.incr(sendKey);

    if (sendCount === 1) {
      await this.redis.expire(sendKey, SEND_WINDOW_SECONDS);
    }

    if (sendCount > SEND_LIMIT) {
      throw new BadRequestException({
        code: 'AUTH_OTP_RATE_LIMITED',
        message: 'Too many OTP requests. Try again in 10 minutes.',
      });
    }

    const code = this.generateCode();
    const key = `otp:${phone}`;

    await this.redis.setex(key, OTP_TTL_SECONDS, JSON.stringify({ code, attempts: 0 }));

    if (this.config.get('NODE_ENV') === 'development') {
      console.log(`[DEV OTP] ${phone}: ${code}`);
      return;
    }

    await this.twilio.messages.create({
      to: phone,
      from: this.config.getOrThrow('TWILIO_PHONE_NUMBER'),
      body: `Your BidiRide verification code is ${code}. Expires in 5 minutes.`,
    });
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    const key = `otp:${phone}`;
    const raw = await this.redis.get(key);

    if (!raw) {
      throw new BadRequestException({
        code: 'AUTH_INVALID_OTP',
        message: 'OTP expired or not found.',
      });
    }

    const data = JSON.parse(raw) as { code: string; attempts: number };

    if (data.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException({
        code: 'AUTH_INVALID_OTP',
        message: 'Too many failed attempts. Request a new code.',
      });
    }

    if (data.code !== code) {
      data.attempts += 1;
      const ttl = await this.redis.ttl(key);
      await this.redis.setex(key, ttl, JSON.stringify(data));
      throw new BadRequestException({
        code: 'AUTH_INVALID_OTP',
        message: 'Incorrect OTP.',
      });
    }

    await this.redis.del(key);
    return true;
  }

  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
