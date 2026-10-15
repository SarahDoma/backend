import type { ConfigService } from '@nestjs/config';
import { MemoryRateLimitStore } from './memory-rate-limit.store';
import { createRateLimitStore } from './rate-limit.module';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('createRateLimitStore', () => {
  it('defaults to the in-memory store', async () => {
    expect(await createRateLimitStore(configWith({}))).toBeInstanceOf(
      MemoryRateLimitStore,
    );
  });

  it('uses the in-memory store when explicitly configured', async () => {
    const store = await createRateLimitStore(
      configWith({ RATE_LIMIT_STORE: 'memory' }),
    );
    expect(store).toBeInstanceOf(MemoryRateLimitStore);
  });

  it('refuses to start the redis store without a REDIS_URL', async () => {
    await expect(
      createRateLimitStore(configWith({ RATE_LIMIT_STORE: 'redis' })),
    ).rejects.toThrow('REDIS_URL is required');
  });
});
