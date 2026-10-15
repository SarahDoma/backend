# Caching

## HTTP caching

Public event listings returned by `GET /events` include:

```
Cache-Control: public, max-age=60, s-maxage=300
```

Browsers may reuse the response for 60 seconds. Shared caches and CDNs may reuse it for up to 300 seconds.
Authenticated organization event endpoints are not cached by this policy.

## Application cache

`CacheModule` (`src/common/cache/`) provides a small key/value cache with
per-entry expiry, behind a `CacheStore` interface, so features can cache
expensive reads without caring where the entries live. The driver is chosen at
boot with `CACHE_DRIVER`:

| Value | Where entries live | Use when |
|---|---|---|
| `memory` (default) | In the process. Not shared between instances; cleared on restart. | A single instance, local development, tests. |
| `redis` | Redis, shared by every instance pointed at it. Survives restarts. | Any multi-instance / horizontally-scaled deployment. |

With the in-memory driver every replica has its own copy, so one instance can
serve an entry another has already invalidated. Use Redis before scaling out.

### Using it

Import `CacheModule` and inject the store:

```ts
@Module({ imports: [CacheModule], providers: [MyService] })
export class MyModule {}

@Injectable()
export class MyService {
  constructor(@Inject(CACHE_STORE) private readonly cache: CacheStore) {}

  async listings() {
    const hit = await this.cache.get<Listing[]>('listings:active');
    if (hit) return hit;

    const fresh = await this.loadListings();
    await this.cache.set('listings:active', fresh, 30_000); // ttl in ms
    return fresh;
  }
}
```

- `get<T>(key)` returns `undefined` on a miss or once the entry has expired.
- `set(key, value, ttlMs)` needs a positive integer TTL — entries always expire,
  so a shared cache can't grow without bound.
- `delete(key)` removes an entry; deleting a missing key is fine.
- Values must be JSON-serializable and come back as fresh copies. Both drivers
  behave the same way here, so what works on `memory` in development works on
  `redis` in production: a `Date` returns as an ISO string, and a `bigint` is
  rejected (convert it to a string first).
- Treat a failing store as a cache miss. The Redis driver propagates connection
  errors rather than hiding them, so wrap calls and fall back to the source of
  truth where a Redis outage must not fail the request.

### Enabling the Redis driver

1. Install the client (only loaded when Redis is selected, so it is not needed
   for the default memory driver):

   ```bash
   npm install ioredis
   ```

2. Set the driver and connection URL:

   ```bash
   CACHE_DRIVER=redis
   REDIS_URL=redis://localhost:6379
   ```

   `REDIS_URL` is required when `CACHE_DRIVER=redis` — the app refuses to start
   without it. Use `rediss://` for TLS and put credentials in the URL, e.g.
   `redis://:password@host:6379`.

Keys are stored as `cache:<key>` with a Redis `PX` expiry, and the connection is
closed when the Nest application is closed. It shares `REDIS_URL` with the
rate-limit store (`docs/RATE_LIMITING.md`) and the webhook queue
(`docs/WEBHOOKS.md`), but each opens its own connection and uses its own key
prefix. The memory driver keeps at most 10,000 entries, evicting the oldest.
