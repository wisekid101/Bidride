import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { installDimensionViolationLogging } from '@bidride/observability';


async function bootstrap() {
  // rawBody: true required for Checkr webhook HMAC signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(helmet());

  // PO-1C-ii: make the dimension guard audible. The rejected VALUE is never
  // logged — it may be the PII or unbounded id the guard just caught.
  installDimensionViolationLogging({ context: 'driver-service' });



  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? '*',
    credentials: !!process.env.ALLOWED_ORIGINS,
  });

  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  console.log(`Driver service listening on port ${port}`);
}

bootstrap();
