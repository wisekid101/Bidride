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
  installDimensionViolationLogging({ context: 'admin-service' });



  app.enableCors({
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT ?? 3011;
  await app.listen(port);
  console.log(`Admin service listening on port ${port}`);
}

bootstrap();
