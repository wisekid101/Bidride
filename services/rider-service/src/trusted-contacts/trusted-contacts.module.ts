import { Module } from '@nestjs/common';
import { TrustedContactsController } from './trusted-contacts.controller';
import { TrustedContactsService } from './trusted-contacts.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TrustedContactsController],
  providers: [TrustedContactsService],
})
export class TrustedContactsModule {}
