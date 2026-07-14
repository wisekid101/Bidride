import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  // ConfigModule loads .env during create() — env checks must come after.
  const app = await NestFactory.create(AppModule);
  if (!process.env.INTERNAL_SERVICE_KEY) {
    // Founder rule: deployed environments fail CLOSED — the service refuses
    // to start without internal authentication configured. Only explicit
    // development/test may run keyless. (The guard also fails closed at
    // request time; this check just fails faster and louder.)
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
      console.error(`FATAL: INTERNAL_SERVICE_KEY is required when NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} — refusing to start`);
      process.exit(1);
    }
    // Dev/test may continue, but loudly, so this state is never mistaken
    // for deployed posture.
    console.warn('WARNING: INTERNAL_SERVICE_KEY is not set — internal endpoints are UNAUTHENTICATED (dev mode only)');
  }
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3012;
  await app.listen(port);
  console.log(`AI Service listening on port ${port}`);
}

bootstrap();
