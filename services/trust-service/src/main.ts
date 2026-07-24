import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  if (!process.env.INTERNAL_SERVICE_KEY) {
    // Founder rule: deployed environments fail CLOSED — trust-service refuses to
    // start without internal authentication configured, so /internal/trust/*
    // (recalculate) can never be served unauthenticated. Only explicit
    // development/test may run keyless. (The InternalKeyGuard also fails closed
    // at request time; this fails faster and louder.)
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
      console.error(`FATAL: INTERNAL_SERVICE_KEY is required when NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} — refusing to start`);
      process.exit(1);
    }
    console.warn('WARNING: INTERNAL_SERVICE_KEY is not set — internal trust endpoints are UNAUTHENTICATED (dev mode only)');
  }
  app.use(helmet());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3009;
  await app.listen(port);
  console.log(`Trust Service listening on port ${port}`);
}

bootstrap();

