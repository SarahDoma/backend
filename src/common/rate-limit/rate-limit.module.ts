import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemoryRateLimitStore } from './memory-rate-limit.store';
import { RATE_LIMIT_STORE } from './rate-limit-store';
import type { RateLimitStore } from './rate-limit-store';
import { RedisRateLimitStore } from './redis-rate-limit.store';
import type { RedisLikeClient } from './redis-rate-limit.store';

type RedisConstructor = new (
  url: string,
  options?: Record<string, unknown>,
) => RedisLikeClient;

/**
 * `ioredis` is loaded only when `RATE_LIMIT_STORE=redis`, so a single-instance
 * deployment on the default in-memory store doesn't need it installed.
 */
async function connectRedis(url: string): Promise<RedisLikeClient> {
  const moduleName = 'ioredis';
  let loaded: unknown;
  try {
    loaded = await import(moduleName);
  } catch {
    throw new Error(
      "RATE_LIMIT_STORE=redis requires the 'ioredis' package — run `npm install ioredis`.",
    );
  }
  const Redis = ((loaded as { default?: RedisConstructor }).default ??
    loaded) as RedisConstructor;
  // Fail a command after one retry rather than hanging a request while Redis is down.
  return new Redis(url, { maxRetriesPerRequest: 1 });
}

export async function createRateLimitStore(
  config: ConfigService,
): Promise<RateLimitStore> {
  const kind = config.get<string>('RATE_LIMIT_STORE', 'memory');
  if (kind !== 'redis') {
    return new MemoryRateLimitStore();
  }

  const url = config.get<string>('REDIS_URL');
  if (!url) {
    throw new Error('REDIS_URL is required when RATE_LIMIT_STORE=redis');
  }
  const store = new RedisRateLimitStore(await connectRedis(url));
  new Logger('RateLimit').log('Using Redis-backed rate-limit store');
  return store;
}

@Module({
  providers: [
    {
      provide: RATE_LIMIT_STORE,
      inject: [ConfigService],
      useFactory: createRateLimitStore,
    },
  ],
  exports: [RATE_LIMIT_STORE],
})
export class RateLimitModule {}
