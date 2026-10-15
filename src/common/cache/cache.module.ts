import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_STORE } from './cache-store';
import type { CacheStore } from './cache-store';
import { MemoryCacheStore } from './memory-cache.store';
import { RedisCacheStore } from './redis-cache.store';
import type { RedisCacheClient } from './redis-cache.store';

type RedisConstructor = new (
  url: string,
  options?: Record<string, unknown>,
) => RedisCacheClient;

/**
 * `ioredis` is loaded only when `CACHE_DRIVER=redis`, so a single-instance
 * deployment on the default in-memory driver doesn't need it installed.
 */
async function connectRedis(url: string): Promise<RedisCacheClient> {
  const moduleName = 'ioredis';
  let loaded: unknown;
  try {
    loaded = await import(moduleName);
  } catch {
    throw new Error(
      "CACHE_DRIVER=redis requires the 'ioredis' package — run `npm install ioredis`.",
    );
  }
  const Redis = ((loaded as { default?: RedisConstructor }).default ??
    loaded) as RedisConstructor;
  // Fail a command after one retry rather than hanging a request while Redis is down.
  return new Redis(url, { maxRetriesPerRequest: 1 });
}

export async function createCacheStore(
  config: ConfigService,
): Promise<CacheStore> {
  const driver = config.get<string>('CACHE_DRIVER', 'memory');
  if (driver !== 'redis') {
    return new MemoryCacheStore();
  }

  const url = config.get<string>('REDIS_URL');
  if (!url) {
    throw new Error('REDIS_URL is required when CACHE_DRIVER=redis');
  }
  const store = new RedisCacheStore(await connectRedis(url));
  new Logger('Cache').log('Using Redis-backed cache');
  return store;
}

@Module({
  providers: [
    {
      provide: CACHE_STORE,
      inject: [ConfigService],
      useFactory: createCacheStore,
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheModule {}
