import type { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { BigIntSerializerInterceptor } from './bigint-serializer.interceptor';

describe('BigIntSerializerInterceptor', () => {
  const interceptor = new BigIntSerializerInterceptor();

  /** Runs `payload` through the interceptor and returns the serialized body. */
  async function serialize<T = Record<string, unknown>>(
    payload: unknown,
  ): Promise<T> {
    const result = await firstValueFrom(
      interceptor.intercept({} as ExecutionContext, {
        handle: () => of(payload),
      }),
    );
    return result as T;
  }

  it('should serialize bigint to string', async () => {
    const result = await serialize({ value: BigInt('12345678901234567890') });
    expect(result.value).toBe('12345678901234567890');
    expect(typeof result.value).toBe('string');
  });

  it('should serialize nested bigints', async () => {
    const result = await serialize<{
      price: string;
      ticket: { chainTicketId: string };
    }>({
      price: BigInt('1000000'),
      ticket: { chainTicketId: BigInt('999999') },
    });
    expect(result.price).toBe('1000000');
    expect(result.ticket.chainTicketId).toBe('999999');
  });

  it('should serialize bigints in arrays', async () => {
    const result = await serialize<Array<{ id: string }>>([
      { id: BigInt('1') },
      { id: BigInt('2') },
      { id: BigInt('3') },
    ]);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
    expect(result[2].id).toBe('3');
  });

  it('should handle null and undefined', async () => {
    const result = await serialize({
      nullValue: null,
      undefinedValue: undefined,
      normalValue: 'test',
    });
    expect(result.nullValue).toBeNull();
    expect(result.undefinedValue).toBeUndefined();
    expect(result.normalValue).toBe('test');
  });

  it('should preserve other data types', async () => {
    const result = await serialize({
      string: 'hello',
      number: 42,
      boolean: true,
      date: new Date('2026-09-24'),
    });
    expect(result.string).toBe('hello');
    expect(result.number).toBe(42);
    expect(result.boolean).toBe(true);
    expect(result.date instanceof Date).toBe(true);
  });

  it('should support JSON.stringify on objects containing BigInt', () => {
    const data = { price: BigInt(5000) };
    expect(JSON.stringify(data)).toBe('{"price":"5000"}');
  });
});
