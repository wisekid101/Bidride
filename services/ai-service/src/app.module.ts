import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InferenceModule } from './inference/inference.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    InferenceModule,
  ],
})
export class AppModule {}
