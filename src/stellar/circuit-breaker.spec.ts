import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after the configured number of consecutive failures', async () => {
    const breaker = new CircuitBreaker(2, 1_000);
    const fail = () => Promise.reject(new Error('rpc down'));

    await expect(breaker.execute(fail)).rejects.toThrow('rpc down');
    await expect(breaker.execute(fail)).rejects.toThrow('rpc down');
    expect(breaker.metrics()).toEqual(
      expect.objectContaining({
        state: 'OPEN',
        consecutiveFailures: 2,
        totalFailures: 2,
      }),
    );
    await expect(
      breaker.execute(() => Promise.resolve('nope')),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('allows one half-open probe and closes after recovery', async () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 100, () => now);

    await expect(
      breaker.execute(() => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
    expect(breaker.metrics().state).toBe('OPEN');

    now = 100;
    expect(breaker.metrics().state).toBe('HALF_OPEN');
    await expect(
      breaker.execute(() => Promise.resolve('recovered')),
    ).resolves.toBe('recovered');
    expect(breaker.metrics()).toEqual(
      expect.objectContaining({
        state: 'CLOSED',
        consecutiveFailures: 0,
        totalSuccesses: 1,
      }),
    );
  });

  it('reopens when the half-open probe fails', async () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 100, () => now);

    await expect(
      breaker.execute(() => Promise.reject(new Error('first'))),
    ).rejects.toThrow('first');
    now = 100;
    await expect(
      breaker.execute(() => Promise.reject(new Error('probe failed'))),
    ).rejects.toThrow('probe failed');

    expect(breaker.metrics()).toEqual(
      expect.objectContaining({
        state: 'OPEN',
        totalFailures: 2,
      }),
    );
  });
});
