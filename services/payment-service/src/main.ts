import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';


async function bootstrap() {
  // rawBody: true stores the unparsed Buffer on req.rawBody — required for Stripe HMAC verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  if (!process.env.INTERNAL_SERVICE_KEY) {
    // Founder rule: deployed environments fail CLOSED — payment-service refuses
    // to start without internal authentication configured, so /payments/internal/*
    // (credit-wallet, charge-trip, capture, void, authorize) can never be served
    // unauthenticated. Only explicit development/test may run keyless. (The
    // InternalKeyGuard also fails closed at request time; this fails faster.)
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
      console.error(`FATAL: INTERNAL_SERVICE_KEY is required when NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} — refusing to start`);
      process.exit(1);
    }
    console.warn('WARNING: INTERNAL_SERVICE_KEY is not set — internal payment endpoints are UNAUTHENTICATED (dev mode only)');
  }
  app.use(helmet());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3007;
  await app.listen(port);
  console.log(`Payment Service listening on port ${port}`);
}

bootstrap();

