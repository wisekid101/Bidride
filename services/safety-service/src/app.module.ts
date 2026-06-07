import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SafetyModule } from './safety/safety.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SafetyModule,
  ],
})
export class AppModule {}
