import { MemoryCacheStore } from './memory-cache.store';

describe('MemoryCacheStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns undefined for a key that was never set', async () => {
    expect(await new MemoryCacheStore().get('missing')).toBeUndefined();
  });

  it('returns a stored value until its ttl elapses', async () => {
    const store = new MemoryCacheStore();
    await store.set('k', { n: 1 }, 1_000);

    expect(await store.get('k')).toEqual({ n: 1 });

    jest.advanceTimersByTime(999);
    expect(await store.get('k')).toEqual({ n: 1 });

    jest.advanceTimersByTime(1);
    expect(await store.get('k')).toBeUndefined();
  });

  it('replaces an existing entry and restarts its ttl', async () => {
    const store = new MemoryCacheStore();
    await store.set('k', 'old', 1_000);
    jest.advanceTimersByTime(900);

    await store.set('k', 'new', 1_000);
    jest.advanceTimersByTime(900);

    expect(await store.get('k')).toBe('new');
  });

  it('deletes an entry, and tolerates deleting a missing one', async () => {
    const store = new MemoryCacheStore();
    await store.set('k', 'v', 1_000);

    await store.delete('k');
    await store.delete('never-set');

    expect(await store.get('k')).toBeUndefined();
  });

  it('hands back a copy, so mutating a result does not change the cache', async () => {
    const store = new MemoryCacheStore();
    const original = { tags: ['a'] };
    await store.set('k', original, 1_000);

    original.tags.push('b');
    const first = await store.get<{ tags: string[] }>('k');
    first?.tags.push('c');

    expect(await store.get('k')).toEqual({ tags: ['a'] });
  });

  it('round-trips values through JSON, like the Redis driver', async () => {
    const store = new MemoryCacheStore();
    await store.set('k', { at: new Date('2026-01-01T00:00:00.000Z') }, 1_000);

    expect(await store.get('k')).toEqual({ at: '2026-01-01T00:00:00.000Z' });
  });

  it('caches null, which is distinct from a miss', async () => {
    const store = new MemoryCacheStore();
    await store.set('k', null, 1_000);

    expect(await store.get('k')).toBeNull();
  });

  it('rejects a value that is not JSON-serializable', async () => {
    const store = new MemoryCacheStore();

    await expect(store.set('k', undefined, 1_000)).rejects.toThrow(TypeError);
    await expect(store.set('k', 10n, 1_000)).rejects.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects ttlMs=%s', async (ttlMs) => {
    await expect(new MemoryCacheStore().set('k', 'v', ttlMs)).rejects.toThrow(
      RangeError,
    );
  });

  it('evicts the oldest entries once over capacity', async () => {
    const store = new MemoryCacheStore(2);
    await store.set('a', 1, 10_000);
    await store.set('b', 2, 10_000);
    await store.set('c', 3, 10_000);

    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toBe(2);
    expect(await store.get('c')).toBe(3);
  });

  it('drops expired entries before evicting live ones', async () => {
    const store = new MemoryCacheStore(2);
    await store.set('short', 1, 100);
    await store.set('long', 2, 10_000);
    jest.advanceTimersByTime(200);

    await store.set('new', 3, 10_000);

    expect(await store.get('long')).toBe(2);
    expect(await store.get('new')).toBe(3);
  });
});
