import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AirportModule } from './airport/airport.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AirportModule,
  ],
})
export class AppModule {}
