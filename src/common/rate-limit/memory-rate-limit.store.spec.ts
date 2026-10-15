import { MemoryRateLimitStore } from './memory-rate-limit.store';

describe('MemoryRateLimitStore', () => {
  it('counts hits per key within a window', async () => {
    const store = new MemoryRateLimitStore();

    expect((await store.hit('a', 60_000)).count).toBe(1);
    expect((await store.hit('a', 60_000)).count).toBe(2);
    expect((await store.hit('b', 60_000)).count).toBe(1);
  });

  it('keeps the window fixed instead of extending it on every hit', async () => {
    const store = new MemoryRateLimitStore();

    const first = await store.hit('a', 60_000);
    const second = await store.hit('a', 60_000);

    expect(second.resetsAt).toBe(first.resetsAt);
  });

  it('starts a new window once the previous one has elapsed', async () => {
    const store = new MemoryRateLimitStore();
    await store.hit('a', 10);
    await store.hit('a', 10);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await store.hit('a', 10)).count).toBe(1);
  });
});
