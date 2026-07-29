import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { installDimensionViolationLogging } from '@bidride/observability';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());

  // PO-1C-ii: make the dimension guard audible. The rejected VALUE is never
  // logged — it may be the PII or unbounded id the guard just caught.
  installDimensionViolationLogging({ context: 'rider-service' });


  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? '*',
    credentials: !!process.env.ALLOWED_ORIGINS,
  });
  const port = process.env.PORT ?? 3004;
  await app.listen(port);
  console.log(`Rider service listening on port ${port}`);
}

bootstrap();
