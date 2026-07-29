import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { installDimensionViolationLogging } from '@bidride/observability';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());

  // PO-1C-i: make the dimension guard audible. Without a subscriber a rejected
  // metric label was dropped silently, so a prohibited dimension could sit in
  // the code indefinitely. The rejected VALUE is never logged.
  installDimensionViolationLogging({ context: 'trip-service' });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  console.log(`Trip Service listening on port ${port}`);
}

bootstrap();
