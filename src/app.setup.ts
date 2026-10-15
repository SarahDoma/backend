import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import helmet from 'helmet';
import { applyApiPrefix } from './config/api-prefix';
import { parseTrustProxy } from './config/trust-proxy';

/**
 * HTTP-level app configuration, shared by `main.ts` and the HTTP specs so
 * tests exercise the same middleware and Express settings as production.
 */
export function configureApp(
  app: NestExpressApplication,
  config: ConfigService,
): void {
  // Resolve `req.ip` from X-Forwarded-For only for proxies we trust —
  // see docs/DEPLOYMENT.md.
  app.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));
  // Weak ETags on GET responses; Express answers a matching
  // If-None-Match with 304 Not Modified. See docs/API.md.
  app.set('etag', 'weak');

  applyApiPrefix(app, config.get<string>('API_PREFIX'));

  const cspDirectives = config.get<string>('CSP_DIRECTIVES');
  const helmetOptions: Record<string, unknown> = {};
  if (cspDirectives) {
    try {
      helmetOptions.contentSecurityPolicy = {
        directives: JSON.parse(cspDirectives) as Record<string, string[]>,
      };
    } catch {
      helmetOptions.contentSecurityPolicy = true;
    }
  }
  app.use(helmet(helmetOptions));

  app.use(json({ limit: config.get<string>('JSON_BODY_LIMIT', '100kb') }));

  app.enableCors({
    origin: config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
