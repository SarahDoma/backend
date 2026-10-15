import type { ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { ConfigService } from '@nestjs/config';

function buildContext(headers: Record<string, string | undefined>) {
  const request = {
    user: { userId: 'user-1' },
    header: (name: string) => headers[name],
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildHandler(response: unknown): { handle: jest.Mock } {
  return { handle: jest.fn().mockReturnValue(of(response)) };
}

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let config: { get: jest.Mock };

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue(15) };
    interceptor = new IdempotencyInterceptor(
      config as unknown as ConfigService,
    );
  });

  it('passes through untouched when no Idempotency-Key header is sent', async () => {
    const context = buildContext({});
    const handler = buildHandler({ xdr: 'a' });

    const result = await firstValue(interceptor.intercept(context, handler));

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ xdr: 'a' });
  });

  it('replays the cached response for a repeated Idempotency-Key from the same user', async () => {
    const context = buildContext({ 'Idempotency-Key': 'key-1' });
    const firstHandler = buildHandler({ xdr: 'first' });
    await firstValue(interceptor.intercept(context, firstHandler));

    const secondHandler = buildHandler({ xdr: 'second' });
    const result = await firstValue(
      interceptor.intercept(context, secondHandler),
    );

    expect(secondHandler.handle).not.toHaveBeenCalled();
    expect(result).toEqual({ xdr: 'first' });
  });

  it('does not share a cached response across different users for the same key', async () => {
    const contextA = buildContext({ 'Idempotency-Key': 'key-1' });
    await firstValue(
      interceptor.intercept(contextA, buildHandler({ xdr: 'a' })),
    );

    const contextB = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'user-2' },
          header: () => 'key-1',
        }),
      }),
    } as unknown as ExecutionContext;
    const handlerB = buildHandler({ xdr: 'b' });
    const result = await firstValue(interceptor.intercept(contextB, handlerB));

    expect(handlerB.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ xdr: 'b' });
  });

  it('re-invokes the handler once the cached entry has expired', async () => {
    jest.useFakeTimers().setSystemTime(0);
    config.get.mockReturnValue(1);
    const context = buildContext({ 'Idempotency-Key': 'key-1' });
    await firstValue(
      interceptor.intercept(context, buildHandler({ xdr: 'first' })),
    );

    jest.setSystemTime(2 * 60_000);
    const secondHandler = buildHandler({ xdr: 'second' });
    const result = await firstValue(
      interceptor.intercept(context, secondHandler),
    );

    expect(secondHandler.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ xdr: 'second' });
    jest.useRealTimers();
  });
});

function firstValue<T>(observable: import('rxjs').Observable<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    observable.subscribe({ next: resolve, error: reject });
  });
}
