import { RedisRateLimitStore } from './redis-rate-limit.store';
import type { RedisLikeClient } from './redis-rate-limit.store';

function fakeClient(reply: unknown): jest.Mocked<Required<RedisLikeClient>> {
  return {
    eval: jest.fn().mockResolvedValue(reply),
    quit: jest.fn().mockResolvedValue('OK'),
  };
}

describe('RedisRateLimitStore', () => {
  it('runs the hit script against a prefixed key with the window length', async () => {
    const client = fakeClient([1, 60_000]);
    const store = new RedisRateLimitStore(client, 'test:');

    await store.hit('scan:ip:1.1.1.1', 60_000);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'test:scan:ip:1.1.1.1',
      60_000,
    );
  });

  it('maps the script reply to a count and a reset time', async () => {
    const before = Date.now();
    const store = new RedisRateLimitStore(fakeClient([3, 42_000]));

    const hit = await store.hit('k', 60_000);

    expect(hit.count).toBe(3);
    expect(hit.resetsAt).toBeGreaterThanOrEqual(before + 42_000);
    expect(hit.resetsAt).toBeLessThanOrEqual(Date.now() + 42_000);
  });

  it('rejects a malformed script reply instead of guessing a count', async () => {
    const store = new RedisRateLimitStore(fakeClient('OK'));

    await expect(store.hit('k', 60_000)).rejects.toThrow(
      'Unexpected reply from Redis rate-limit script',
    );
  });

  it('propagates client errors so the caller can decide how to fail', async () => {
    const client = fakeClient(null);
    client.eval.mockRejectedValue(new Error('ECONNREFUSED'));
    const store = new RedisRateLimitStore(client);

    await expect(store.hit('k', 60_000)).rejects.toThrow('ECONNREFUSED');
  });

  it('closes the connection on module destroy', async () => {
    const client = fakeClient([1, 1]);
    await new RedisRateLimitStore(client).onModuleDestroy();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
