import 'reflect-metadata';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { PaginatedResponseInterceptor } from './paginated-response.interceptor';

function contextWithQuery(query: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler<[unknown[], number]> {
  return { handle: () => of(value as [unknown[], number]) };
}

describe('PaginatedResponseInterceptor', () => {
  const interceptor = new PaginatedResponseInterceptor<unknown>();

  it('wraps [items, total] with the requested page and limit', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(
        contextWithQuery({ page: '2', limit: '5' }),
        handlerReturning([['f', 'g'], 7]),
      ),
    );
    expect(result).toEqual({ items: ['f', 'g'], total: 7, page: 2, limit: 5 });
  });

  it('applies the default page and limit when the query omits them', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextWithQuery({}), handlerReturning([[], 0])),
    );
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });

  it.each([[['a']], [{ items: [], total: 0 }], [[[], '3']]])(
    'rejects a handler result that is not [items, total]: %j',
    async (value) => {
      await expect(
        lastValueFrom(
          interceptor.intercept(contextWithQuery({}), handlerReturning(value)),
        ),
      ).rejects.toThrow('expects the handler to return [items, total]');
    },
  );
});
