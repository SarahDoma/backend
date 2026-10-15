import type { OnModuleDestroy } from '@nestjs/common';
import type { RateLimitHit, RateLimitStore } from './rate-limit-store';

/** The slice of an `ioredis` client the store needs, so tests can fake it. */
export interface RedisLikeClient {
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  quit?(): Promise<unknown>;
}

/**
 * Increments the key and, on the first hit of a window (or if a key somehow
 * lost its expiry), sets the window length. Runs as one script so a crash
 * between INCR and PEXPIRE can never leave a counter that never expires.
 * Returns `{count, remaining window ms}`.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * Redis-backed store: counters are shared by every instance pointed at the
 * same Redis, so a limit holds across a horizontally-scaled deployment and
 * survives restarts.
 */
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  constructor(
    private readonly client: RedisLikeClient,
    private readonly keyPrefix = 'ratelimit:',
  ) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const reply = await this.client.eval(
      HIT_SCRIPT,
      1,
      `${this.keyPrefix}${key}`,
      windowMs,
    );
    if (!Array.isArray(reply) || reply.length !== 2) {
      throw new Error('Unexpected reply from Redis rate-limit script');
    }
    const [count, ttl] = reply as [number, number];
    return { count, resetsAt: Date.now() + ttl };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit?.();
  }
}
