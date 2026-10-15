# Rate limiting

## Ticket verification scans

`GET /tickets/verify/:qrSecret` is guarded by `ScanRateLimitGuard`
(`src/common/guards/scan-rate-limit.guard.ts`), a fixed-window velocity
limit keyed independently by:

- **requester IP** — catches one scanner (or attacker) hammering many
  different secrets, e.g. brute-forcing valid ticket ids.
- **the `qrSecret` being scanned** — catches one secret being replayed
  rapidly, e.g. a photographed or shared QR code being reused across
  multiple gates at once.

Either axis tripping the limit rejects the request with `429 Too Many
Requests`; a request only has to fail one check to be treated as abuse.

The IP comes from `req.ip`. Behind a load balancer or reverse proxy,
set `TRUST_PROXY` (see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md#6-running-behind-a-proxy-trust_proxy)).
Without it, every client shares the proxy's IP and one busy gate can
rate-limit all the others.

Configurable via environment variables, all optional with defaults:

- `SCAN_RATE_LIMIT_MAX` (default `10`) — max attempts per window, per key.
- `SCAN_RATE_LIMIT_WINDOW_MS` (default `60000`) — window length in ms.

## Storage: memory or Redis

The counters live behind a `RateLimitStore`
(`src/common/rate-limit/`), chosen at boot with `RATE_LIMIT_STORE`:

| Value | Where counters live | Use when |
|---|---|---|
| `memory` (default) | In the process (a `Map`). Not shared between instances; cleared on restart. | A single instance, local development, tests. |
| `redis` | Redis, shared by every instance pointed at it. Survives restarts. | Any multi-instance / horizontally-scaled deployment. |

With the in-memory store each instance keeps its own counters, so N instances
effectively allow N times the configured limit. Use Redis before scaling out.

### Enabling the Redis store

1. Install the client (it is only loaded when Redis is selected, so it is not
   needed for the default memory store):

   ```bash
   npm install ioredis
   ```

2. Set the store and connection URL:

   ```bash
   RATE_LIMIT_STORE=redis
   REDIS_URL=redis://localhost:6379
   ```

   `REDIS_URL` is required when `RATE_LIMIT_STORE=redis` — the app refuses to
   start without it (see `docs/CONFIGURATION.md`). Use `rediss://` for TLS and
   put credentials in the URL, e.g. `redis://:password@host:6379`.

For a local Redis: `docker run --rm -p 6379:6379 redis:7`.

How it behaves:

- Each counter is a Redis key named `ratelimit:scan:ip:<ip>` or
  `ratelimit:scan:secret:<sha256 of the qrSecret>` that expires after
  `SCAN_RATE_LIMIT_WINDOW_MS`. The raw QR secret is never used as a key.
- The increment and expiry are set in a single Lua script, so a crash can't
  leave a counter that never expires. The window is fixed from the first hit,
  exactly as with the in-memory store.
- **Fail-open:** if Redis is unreachable the guard logs a warning and allows
  the request rather than returning 500s, so a Redis outage can't lock every
  gate scanner out. Abuse protection is degraded until Redis is back — alert
  on the `Rate-limit store unavailable` log line.
- The connection is closed when the Nest application is closed (`app.close()`).

Note: the `Idempotency-Key` response cache
(`src/common/interceptors/idempotency.interceptor.ts`) is a separate
in-process store and is not covered by `RATE_LIMIT_STORE`.

## Auth endpoints

Not implemented yet. `/auth/login` and `/auth/register` are the
highest-priority endpoints to rate-limit (credential stuffing,
account enumeration) — `@nestjs/throttler` is the natural fit given
this is already a NestJS app. Tracked in `ROADMAP.md`.
