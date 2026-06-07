import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TrustModule } from './trust/trust.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TrustModule,
  ],
})
export class AppModule {}
