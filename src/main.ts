import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/**
 * Bootstraps the HTTP server.
 *
 * NestJS is the framework (DI, modules, decorators), but Fastify is the actual
 * HTTP engine via `@nestjs/platform-fastify` — we keep the raw speed of
 * Fastify while getting Nest's elegant module/DI ergonomics on top.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Reject unknown fields, coerce types from JSON, and run class-validator.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT) || 3100;
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
