export interface RateLimitHit {
  /** Attempts recorded against the key in the current window, this one included. */
  count: number;
  /** Unix ms the current window resets at. */
  resetsAt: number;
}

/**
 * Fixed-window attempt counter behind the rate-limit guards. Swappable so a
 * multi-instance deployment can share counters (Redis) while a single
 * instance and the tests keep using process memory.
 */
export interface RateLimitStore {
  /**
   * Records one attempt against `key` and returns the window it landed in.
   * The first hit after a window expires starts a new `windowMs` window.
   */
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');
