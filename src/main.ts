import 'dotenv/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { startTracing } from './tracing';

async function bootstrap() {
  // Instrumentation must start before Nest and Express are loaded.
  const tracing = startTracing();
  const [
    { NestFactory },
    { AppModule },
    { ConfigService },
    { DocumentBuilder, SwaggerModule },
    { GlobalExceptionFilter },
    { configureApp },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('./app.module.js'),
    import('@nestjs/config'),
    import('@nestjs/swagger'),
    import('./common/filters/global-exception.filter.js'),
    import('./app.setup.js'),
  ]);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (tracing) app.enableShutdownHooks();
  const config = app.get(ConfigService);

  configureApp(app, config);

  app.useGlobalFilters(new GlobalExceptionFilter());

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Drips API')
      .setDescription('API for Drips ticketing platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
