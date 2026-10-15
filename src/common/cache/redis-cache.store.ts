import type { OnModuleDestroy } from '@nestjs/common';
import { assertValidTtl, serializeCacheValue } from './cache-store';
import type { CacheStore } from './cache-store';

/** The slice of an `ioredis` client the store needs, so tests can fake it. */
export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  quit?(): Promise<unknown>;
}

/**
 * Redis-backed cache: entries are shared by every instance pointed at the same
 * Redis and survive restarts. Expiry is Redis's own `PX` TTL.
 */
export class RedisCacheStore implements CacheStore, OnModuleDestroy {
  constructor(
    private readonly client: RedisCacheClient,
    private readonly keyPrefix = 'cache:',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const json = await this.client.get(`${this.keyPrefix}${key}`);
    return json === null ? undefined : (JSON.parse(json) as T);
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    assertValidTtl(ttlMs);
    await this.client.set(
      `${this.keyPrefix}${key}`,
      serializeCacheValue(value),
      'PX',
      ttlMs,
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.del(`${this.keyPrefix}${key}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit?.();
  }
}
