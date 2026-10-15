import { assertValidTtl, serializeCacheValue } from './cache-store';
import type { CacheStore } from './cache-store';

interface Entry {
  json: string;
  expiresAt: number;
}

/**
 * In-process cache: enough for a single instance and for tests. Entries are
 * not shared between instances and are lost on restart. Values are held as
 * JSON, like the Redis store, so callers can't tell the drivers apart.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  /** Oldest entries are evicted beyond this, so unread keys can't leak memory. */
  constructor(private readonly maxEntries = 10_000) {}

  get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) {
      return Promise.resolve(undefined);
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(JSON.parse(entry.json) as T);
  }

  set(key: string, value: unknown, ttlMs: number): Promise<void> {
    let json: string;
    try {
      assertValidTtl(ttlMs);
      json = serializeCacheValue(value);
    } catch (err) {
      // Reject rather than throw, so callers see the same async contract as Redis.
      return Promise.reject(
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // Re-insert so a refreshed key counts as the newest for eviction.
    this.entries.delete(key);
    this.entries.set(key, { json, expiresAt: Date.now() + ttlMs });
    this.evictOverflow();
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  private evictOverflow(): void {
    if (this.entries.size <= this.maxEntries) {
      return;
    }
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
    // Map iterates in insertion order, so the first keys are the oldest.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) {
        break;
      }
      this.entries.delete(key);
    }
  }
}
