import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';


async function bootstrap() {
  // rawBody: true stores the unparsed Buffer on req.rawBody — required for Stripe HMAC verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(helmet());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3007;
  await app.listen(port);
  console.log(`Payment Service listening on port ${port}`);
}

bootstrap();

