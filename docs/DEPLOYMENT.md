# Production Deployment Guide

This guide provides an end-to-end walkthrough for deploying the Stellar Tickets backend to production, covering environment setup, secrets management, database migrations, application build, container/process execution, and post-deploy verification.

---

## 1. Pre-deployment Verification

Before initiating deployment, verify that all static checks and tests pass:

```bash
# 1. Typecheck without emitting JS
npx tsc --noEmit

# 2. Run linter
npm run lint

# 3. Run test suite
npm test
```

---

## 2. Environment Setup & Secrets Management

Production configuration is driven by environment variables. **Never store production secrets in version-controlled `.env` files.** Use a dedicated secrets manager (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager, or Kubernetes Secrets).

### Essential Production Variables

| Variable | Required | Description | Example / Recommendation |
|---|---|---|---|
| `NODE_ENV` | Yes | Set to `production` | `production` |
| `PORT` | Yes | HTTP listening port | `3000` |
| `APP_URL` | Yes | Allowed CORS origin URL | `https://app.example.com` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://user:pass@db-host:5432/stellartickets?sslmode=require` |
| `JWT_SECRET` | Yes | Secret key for signing auth tokens | Minimum 32-character high-entropy secret; can instead be loaded via `SECRETS_PROVIDER=file` or a custom provider (see "Secret providers" in `docs/CONFIGURATION.md`) |
| `STELLAR_NETWORK` | Yes | Target Stellar network | `mainnet` (or `testnet` for staging) |
| `SOROBAN_RPC_URL` | Yes | Production Soroban RPC node URL | `https://mainnet.soroban.rpc.endpoint` |
| `TICKETING_CONTRACT_ID` | Yes | Deployed Stellar ticketing contract address | `C...` (Stellar C-address) |
| `PLATFORM_SIGNER_SECRET` | Yes | Disposable Stellar secret key for read simulations | `S...` (Stellar secret key) |
| `OFFLINE_SIGNING_KEY_ID` | Yes | Active key ID for offline QR signatures | `2026-01` |
| `OFFLINE_SIGNING_PRIVATE_KEY` | Yes | PEM-encoded Ed25519 private key for offline tokens | `-----BEGIN PRIVATE KEY-----\n...` |
| `OFFLINE_SIGNING_PUBLIC_KEYS` | Yes | JSON map of accepted offline public key IDs | `{"2026-01":"-----BEGIN PUBLIC KEY-----\n..."}` |

### Infrastructure & Scaling Variables

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_STORE` | `memory` | Set to `redis` for multi-instance deployments. Requires `REDIS_URL`. |
| `CACHE_DRIVER` | `memory` | Set to `redis` for shared cache across instances. Requires `REDIS_URL`. |
| `WEBHOOK_QUEUE_ENABLED` | `false` | Set to `true` to enable outbound webhooks. Requires `REDIS_URL` and `bullmq`. |
| `REDIS_URL` | — | Required when Redis rate limiting, caching, or webhook queues are enabled. |
| `SCHEDULER_ENABLED` | `true` | Runs background jobs (resale expiry, ticket reconciliation). Enable on only one process if multi-instance. |

---

## 3. Database Setup & Migrations

The application uses PostgreSQL with Prisma ORM. Production migrations must be applied using `prisma migrate deploy`.

### Running Migrations

1. **Verify Connection:** Ensure `DATABASE_URL` points to the target database with migration privileges.
2. **Apply Pending Migrations:**

   ```bash
   npx prisma migrate deploy
   ```

3. **Check Migration Status:**

   ```bash
   npx prisma migrate status
   ```

4. **Optional Seeding (Initial Setup):**

   ```bash
   npm run db:seed
   ```

> ⚠ **Important:** Always take a database snapshot/backup using `pg_dump` before applying new migrations to a live production database.

---

## 4. Build & Execution Walkthrough

### Option A: Standalone Node.js Deployment (PM2 / systemd)

1. **Install Dependencies:**

   ```bash
   npm ci --omit=dev
   ```

2. **Generate Prisma Client:**

   ```bash
   npx prisma generate
   ```

3. **Build TypeScript Sources:**

   ```bash
   npm run build
   ```

4. **Start Application Process:**

   ```bash
   NODE_ENV=production npm run start:prod
   ```

   Or using PM2 for process management:

   ```bash
   pm2 start dist/main.js --name "stellar-tickets-api" -i max
   ```

---

### Option B: Containerized Deployment (Docker)

1. **Build Production Image:**

   ```bash
   docker build -t stellar-tickets-backend:latest .
   ```

2. **Run Container:**

   ```bash
   docker run -d \
     --name stellar-tickets-api \
     --env-file /path/to/production.env \
     -p 3000:3000 \
     --restart always \
     stellar-tickets-backend:latest
   ```

3. **Or using Docker Compose:**

   ```bash
   docker compose --profile full up -d --build
   ```

---

## 5. Post-Deployment Verification

Verify that the deployment was successful and the application is handling requests:

### 1. Health Check Endpoint

Query the versioned health endpoint:

```bash
curl -i http://localhost:3000/v1/health
```

Expected output:
```json
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"status":"ok","service":"stellar-tickets-backend"}
```

### 2. Verification Checklist

- [x] `/v1/health` responds with HTTP 200 OK.
- [x] Database connections operate normally without migration warnings.
- [x] Soroban RPC endpoint is reachable by the service.
- [x] Outbound webhooks (if enabled) connect to Redis cleanly.
- [x] Logs output structured Nest logs without uncaught exception errors.

---

## 6. Running Behind a Proxy (`TRUST_PROXY`)

Behind a load balancer or reverse proxy, every request reaches the app
from the proxy's address. Unless Express is told to trust that proxy,
`req.ip` is the proxy's IP, so the per-IP scan rate limit
([`docs/RATE_LIMITING.md`](RATE_LIMITING.md)) puts every client in one
bucket and logs show one address.

`TRUST_PROXY` sets Express's
[`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html)
setting, which decides how much of `X-Forwarded-For` to believe when
resolving `req.ip`:

| Value | Meaning |
|---|---|
| unset, empty or `false` (default) | Ignore `X-Forwarded-For`. Correct when clients connect directly. |
| `1`, `2`, ... | Trust that many proxy hops in front of the app. `1` is right for a single load balancer (e.g. Render, Fly.io, an nginx in front of the container). |
| `10.0.0.0/8,loopback` | Trust only these proxy addresses: IPs, CIDR ranges (or `ip/netmask`) and the presets `loopback`, `linklocal`, `uniquelocal`, comma-separated. The strictest option when proxy IPs are known. |
| `true` | Trust every hop. Only safe if the app cannot be reached except through the proxy. Otherwise any client can pick its own IP by sending `X-Forwarded-For`. |

An invalid value (e.g. `on`, `10.0.0.0/33`) fails env validation at boot.

Set the hop count or address list to exactly what sits in front of the
app. Trusting more hops than exist lets clients spoof the IP the rate
limiter keys on.
