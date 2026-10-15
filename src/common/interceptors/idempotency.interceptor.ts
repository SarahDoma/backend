import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';

interface CachedResponse {
  body: unknown;
  expiresAt: number;
}

/** Fallback cache TTL when IDEMPOTENCY_KEY_TTL_MINUTES isn't set. */
const DEFAULT_TTL_MINUTES = 15;

/**
 * Caches a handler's response keyed by the `Idempotency-Key` request header
 * (scoped per caller, so different users can't collide on the same key), so
 * a retried build-transaction POST replays the original response instead of
 * creating a second `PendingTx` / on-chain intent.
 *
 * State is in-process (a `Map`), matching `ScanRateLimitGuard` — sufficient
 * for a single instance; a multi-instance deployment would need this backed
 * by something shared (e.g. Redis).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly cache = new Map<string, CachedResponse>();

  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserPayload }>();
    const idempotencyKey = request.header('Idempotency-Key');

    if (!idempotencyKey) {
      return next.handle();
    }

    const cacheKey = `${request.user?.userId ?? 'anonymous'}:${idempotencyKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return of(cached.body);
    }

    return next.handle().pipe(
      tap((body) => {
        const ttlMinutes = this.config.get<number>(
          'IDEMPOTENCY_KEY_TTL_MINUTES',
          DEFAULT_TTL_MINUTES,
        );
        this.cache.set(cacheKey, {
          body,
          expiresAt: Date.now() + ttlMinutes * 60_000,
        });
      }),
    );
  }
}
