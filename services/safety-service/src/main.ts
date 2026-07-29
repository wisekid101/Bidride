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
  installDimensionViolationLogging({ context: 'safety-service' });


  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3006;
  await app.listen(port);
  console.log(`Safety Service listening on port ${port}`);
}

bootstrap();

