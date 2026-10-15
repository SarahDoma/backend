import type { ConfigService } from '@nestjs/config';
import { createCacheStore } from './cache.module';
import { MemoryCacheStore } from './memory-cache.store';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('createCacheStore', () => {
  it('defaults to the in-memory driver', async () => {
    expect(await createCacheStore(configWith({}))).toBeInstanceOf(
      MemoryCacheStore,
    );
  });

  it('uses the in-memory driver when explicitly configured', async () => {
    const store = await createCacheStore(
      configWith({ CACHE_DRIVER: 'memory' }),
    );

    expect(store).toBeInstanceOf(MemoryCacheStore);
  });

  it('ignores REDIS_URL while the driver is memory', async () => {
    const store = await createCacheStore(
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );

    expect(store).toBeInstanceOf(MemoryCacheStore);
  });

  it('refuses to start the redis driver without a REDIS_URL', async () => {
    await expect(
      createCacheStore(configWith({ CACHE_DRIVER: 'redis' })),
    ).rejects.toThrow('REDIS_URL is required');
  });
});
