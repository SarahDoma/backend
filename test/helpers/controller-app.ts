import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Type,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import type { CurrentUserPayload } from '../../src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

export const TEST_USER: CurrentUserPayload = {
  userId: 'user-1',
  email: 'user-1@example.com',
  role: 'ATTENDEE',
};

/** Stands in for `JwtAuthGuard`: any request without an `Authorization` header is a 401. */
class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: CurrentUserPayload;
    }>();
    if (!req.headers.authorization) throw new UnauthorizedException();
    req.user = TEST_USER;
    return true;
  }
}

export interface ControllerAppOptions {
  controller: Type<unknown>;
  /** Injection token of the service the controller depends on, with its mock. */
  service: { provide: Type<unknown>; useValue: object };
  /** Extra guard/interceptor classes on the controller that must not run for real. */
  passthrough?: { guards?: Type<unknown>[]; interceptors?: Type<unknown>[] };
}

/**
 * Boots just one controller with a mocked service, the app's global
 * `ValidationPipe` settings, and a fake JWT guard, so specs exercise route
 * wiring, auth, param/DTO handling and error propagation over real HTTP.
 */
export async function createControllerApp(
  options: ControllerAppOptions,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    controllers: [options.controller],
    providers: [options.service],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard);

  for (const guard of options.passthrough?.guards ?? []) {
    builder = builder
      .overrideGuard(guard)
      .useValue({ canActivate: () => true });
  }
  for (const interceptor of options.passthrough?.interceptors ?? []) {
    builder = builder.overrideInterceptor(interceptor).useValue({
      intercept: (_: unknown, next: { handle(): unknown }) => next.handle(),
    });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

/** The app's HTTP server, typed for supertest. */
export const server = (app: INestApplication): App =>
  app.getHttpServer() as App;

export const AUTH = { Authorization: 'Bearer test-token' };
