import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';


async function bootstrap() {
  // rawBody: true required for Checkr webhook HMAC signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(helmet());


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
