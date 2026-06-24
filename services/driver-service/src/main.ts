import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true required for Checkr webhook HMAC signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.enableCors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] });

  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  console.log(`Driver service listening on port ${port}`);
}

bootstrap();
