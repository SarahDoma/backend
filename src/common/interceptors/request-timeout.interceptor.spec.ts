import { GatewayTimeoutException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { RequestTimeoutInterceptor } from './request-timeout.interceptor';

describe('RequestTimeoutInterceptor', () => {
  const context = {} as ExecutionContext;

  it('passes through responses completed within the deadline', async () => {
    const interceptor = new RequestTimeoutInterceptor(50);
    const next = { handle: () => of('ok') } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toBe('ok');
  });

  it('maps RxJS timeouts to HTTP 504', async () => {
    const interceptor = new RequestTimeoutInterceptor(5);
    const next = {
      handle: () => timer(25).pipe(map(() => 'late')),
    } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('preserves non-timeout errors', async () => {
    const interceptor = new RequestTimeoutInterceptor(50);
    const expected = new Error('boom');
    const next = { handle: () => throwError(() => expected) } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toBe(expected);
  });
});
