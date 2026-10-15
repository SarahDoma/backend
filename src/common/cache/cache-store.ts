/**
 * Key/value cache with per-entry expiry. Swappable so a multi-instance
 * deployment can share entries (Redis) while a single instance and the tests
 * keep using process memory.
 *
 * Values must be JSON-serializable and are returned as fresh copies, so both
 * drivers behave identically: a `Date` comes back as an ISO string, and a
 * `bigint` is rejected. Callers should treat a failing store as a cache miss.
 */
export interface CacheStore {
  /** The cached value, or `undefined` on a miss or once the entry has expired. */
  get<T>(key: string): Promise<T | undefined>;
  /** Stores `value` under `key`, replacing any previous entry, for `ttlMs` milliseconds. */
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  /** Removes `key`. Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

export const CACHE_STORE = Symbol('CACHE_STORE');

/** Entries always expire, so a shared cache can't grow without bound. */
export function assertValidTtl(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError('Cache ttlMs must be a positive integer');
  }
}

export function serializeCacheValue(value: unknown): string {
  // JSON.stringify returns undefined (not a string) for undefined/functions/symbols.
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) {
    throw new TypeError('Cache value is not JSON-serializable');
  }
  return json;
}
