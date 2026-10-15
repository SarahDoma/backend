import type { RateLimitHit, RateLimitStore } from './rate-limit-store';

/**
 * In-process store: enough for a single instance and for tests. Counters are
 * not shared between instances and are lost on restart.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, RateLimitHit>();

  hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetsAt <= now) {
      const fresh = { count: 1, resetsAt: now + windowMs };
      this.windows.set(key, fresh);
      return Promise.resolve({ ...fresh });
    }

    existing.count += 1;
    return Promise.resolve({ ...existing });
  }
}
