import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TripsModule } from './trips/trips.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TripsModule,
  ],
})
export class AppModule {}
