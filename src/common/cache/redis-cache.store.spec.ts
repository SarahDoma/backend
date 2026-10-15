import { RedisCacheStore } from './redis-cache.store';
import type { RedisCacheClient } from './redis-cache.store';

function fakeClient(): jest.Mocked<Required<RedisCacheClient>> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
  };
}

describe('RedisCacheStore', () => {
  it('writes JSON under a prefixed key with a millisecond ttl', async () => {
    const client = fakeClient();
    const store = new RedisCacheStore(client, 'test:');

    await store.set('events:1', { name: 'Gala' }, 30_000);

    expect(client.set).toHaveBeenCalledWith(
      'test:events:1',
      '{"name":"Gala"}',
      'PX',
      30_000,
    );
  });

  it('parses a stored value back out', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue('{"name":"Gala"}');
    const store = new RedisCacheStore(client, 'test:');

    expect(await store.get('events:1')).toEqual({ name: 'Gala' });
    expect(client.get).toHaveBeenCalledWith('test:events:1');
  });

  it('treats a missing key as a miss rather than null', async () => {
    const store = new RedisCacheStore(fakeClient());

    expect(await store.get('missing')).toBeUndefined();
  });

  it('caches null, which is distinct from a miss', async () => {
    const client = fakeClient();
    client.get.mockResolvedValue('null');

    expect(await new RedisCacheStore(client).get('k')).toBeNull();
  });

  it('deletes the prefixed key', async () => {
    const client = fakeClient();

    await new RedisCacheStore(client, 'test:').delete('events:1');

    expect(client.del).toHaveBeenCalledWith('test:events:1');
  });

  it('rejects an invalid ttl or unserializable value before touching Redis', async () => {
    const client = fakeClient();
    const store = new RedisCacheStore(client);

    await expect(store.set('k', 'v', 0)).rejects.toThrow(RangeError);
    await expect(store.set('k', undefined, 1_000)).rejects.toThrow(TypeError);
    expect(client.set).not.toHaveBeenCalled();
  });

  it('propagates client errors so the caller can treat them as a miss', async () => {
    const client = fakeClient();
    client.get.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(new RedisCacheStore(client).get('k')).rejects.toThrow(
      'ECONNREFUSED',
    );
  });

  it('closes the connection on module destroy', async () => {
    const client = fakeClient();

    await new RedisCacheStore(client).onModuleDestroy();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
