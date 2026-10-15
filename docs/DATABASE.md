# Database

Postgres via Prisma. Schema: [`prisma/schema.prisma`](../prisma/schema.prisma).

## Connection pool configuration (#215)

Prisma maintains a Postgres connection pool per `PrismaClient` instance,
sized by **query engine defaults** unless the `DATABASE_URL` overrides it:

| Param             | Default                      | Meaning                                        |
| ----------------- | ---------------------------- | ---------------------------------------------- |
| `connection_limit`| `num_cpus * 2 + 1`           | Max pool size (physical connections)           |
| `pool_timeout`    | `10` seconds                 | How long a query waits for a free connection   |
| `connect_timeout` | `5` seconds                  | TCP connect handshake timeout                  |

Because the default scales with the **host's** CPU count, it is wrong on
container platforms where `num_cpus` is the node's, not the container's —
set `connection_limit` explicitly everywhere except tiny local setups:

```
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=10&connect_timeout=5"
```

### Guidance by environment

| Environment                        | Suggested `connection_limit` | Why |
| ---------------------------------- | ---------------------------- | --- |
| Local dev / `docker-compose.yml`   | `5` (or omit)                | One developer, default engine sizing is fine |
| API pods on Kubernetes             | `5–10` per pod               | `pods * limit` must stay below Postgres `max_connections` minus superuser/system reserve (~10%) |
| Migration / one-off CLI runs       | `2`                          | Migrations don't need a large pool |
| Serverless / Vercel functions      | `1` **and** a pooled proxy (PgBouncer in transaction mode or Supabase/Neon pooled URL on port 6543) | Many ephemeral runtimes × per-runtime pools exhaust the database instantly |

Rules of thumb:

- **Budget first:** `sum(connection_limit across all deployable processes)
  ≤ max_connections - reserve`. Check `SHOW max_connections;` and every
  deployment's replica count before raising limits.
- **Watch for pool timeouts:** `P2024` ("Timed out fetching a connection
  from the pool") means queries are holding connections too long (long
  interactive transactions) or the pool is undersized — prefer shrinking
  transaction scopes (see #217) before raising the limit.
- **One pool per process, not per request:** the `PrismaService` singleton
  already guarantees this; never construct `PrismaClient` inside request
  handlers.
- Postgres reserves superuser slots, so keep the total well under
  `max_connections` (default `100`) — roughly 80% as a ceiling.

## Key relationships

- `User` — `OrganizationMember` (many-to-many via join table) — `Organization`
- `Organization` — `Event` — `TicketType` — `Ticket`
- `Ticket.ownerId` -> `User` (the current owner, kept in sync with the
  on-chain owner on every write path and by `verify`)
- `ResaleListing` — one row per listing attempt, `ticketId` + `status`

## Migrations

```bash
npx prisma migrate dev --name <description>
npx prisma migrate deploy   # production
```

`chainEventId` and `chainTicketId` are unique `BigInt` columns mapping
1:1 to the on-chain `u64` ids — see `docs/ARCHITECTURE.md` for why the
chain remains the source of truth despite this cache.

## Seat uniqueness per event (#211)

A seat may be issued only once per event. Enforced by a **partial**
unique index (raw SQL — Prisma cannot express `WHERE`):

```sql
CREATE UNIQUE INDEX "Ticket_eventId_seat_partial_key"
  ON "Ticket"("eventId", "seat")
  WHERE "seat" <> 'unassigned';
```

- `seat = 'unassigned'` (the default) is excluded, so general-admission
  tickets never collide.
- Any assigned seat (e.g. `A1`) collides on duplicate `(eventId, seat)`
  with a `P2002` that `TicketsService` translates to `409 Conflict`.
- Migration: `prisma/migrations/20260926090000_ticket_seat_partial_unique/`.
  Tested against the schema: duplicate assigned seats fail, repeated
  `'unassigned'` rows succeed.

## Ticket owner/status index (#213)

`GET /tickets/mine` filters by owner with an optional `?status=` filter:

```
GET /tickets/mine?status=VALID
```

Covered by a composite index declared in the schema and migration:

```prisma
@@index([ownerId, status]) // on Ticket
```

```sql
CREATE INDEX "Ticket_ownerId_status_idx" ON "Ticket"("ownerId", "status");
```

Migration: `prisma/migrations/20260926100000_ticket_owner_status_index/`.
Supports `WHERE "ownerId" = $1 [AND "status" = $2] ORDER BY "createdAt" DESC`
as a single index scan.

## Resale ticket/status index (#214)

Resale lookups filter listings by ticket and status — active listing per
ticket, ticket-scoped feeds, and expiry sweeps all issue:

```sql
WHERE "ticketId" = $1 [AND "status" = $2]
```

Covered by a composite index declared in the schema and migration:

```prisma
@@index([ticketId, status]) // on ResaleListing
```

```sql
CREATE INDEX "ResaleListing_ticketId_status_idx"
  ON "ResaleListing"("ticketId", "status");
```

Migration: `prisma/migrations/20260926130000_resale_ticket_status_index/`.

## One ACTIVE resale listing per ticket (#216)

Nothing else stops two `ACTIVE` `ResaleListing` rows for the same ticket.
Enforced by a **partial** unique index (raw SQL — Prisma cannot express
`WHERE`):

```sql
CREATE UNIQUE INDEX "ResaleListing_ticketId_active_key"
  ON "ResaleListing"("ticketId")
  WHERE "status" = 'ACTIVE';
```

- Concurrent `confirmListForResale` calls for the same ticket cannot both
  succeed: the loser gets a `P2002` that `TicketsService` translates to
  `409 Conflict`.
- Non-`ACTIVE` rows (`SOLD`, `CANCELLED`) are excluded, so a ticket can be
  re-listed after its listing is sold or cancelled while the historical
  listing rows stay intact.
- Migration: `prisma/migrations/20260926140000_resale_listing_active_partial_unique/`.
- Tested against the schema: two concurrent ACTIVE creates — exactly one
  succeeds, the other maps to `409 Conflict`.

## Purchase concurrency & row-level locking (#217)

`quantityIssued` increments (`confirmIssue`, `confirmPurchase`) run inside
the same interactive transaction as the ticket insert, guarded by a
row-level lock:

```sql
SELECT "quantityIssued", "quantityTotal" FROM "TicketType" WHERE "id" = $1 FOR UPDATE
```

Concurrent transactions serialize on the `TicketType` row; each one
re-checks `quantityIssued < quantityTotal` **after** acquiring the lock, so
overselling `quantityTotal` is impossible even when the pre-transaction
capacity check raced. Losing transactions abort with
`TICKET_TYPE_SOLD_OUT` (`409` via the domain exception filter).


## Soft-delete for Event and Organization (#207)

`Event.deletedAt` and `Organization.deletedAt` (`NULL` = live) replace
hard deletes in all app write paths (`DELETE /events/:eventId`,
`DELETE /organizations/:id`, plus `POST .../restore` to undo).

- All read paths filter `deletedAt: null` (`findMine`, `findOne`,
  `getWithOrg`, `findPublished`, `findForOrganization`, reminders).
  Single-row lookups treat a soft-deleted row as `404 Not Found`.
- **Cascade behaviour:** the FK `ON DELETE CASCADE` rules
  (`Organization -> Event -> TicketType -> Ticket`) are unchanged and
  still apply to *hard* deletes (manual ops, `migrate reset`). A
  soft-delete does **not** cascade at the DB level and does **not**
  delete child rows: tickets, gates, promo codes and reminders of a
  soft-deleted event/org remain in place for audit/reconciliation but
  are hidden wherever their parent is filtered out (`findPublished`
  additionally requires `organization.deletedAt IS NULL`).
- Migration: `prisma/migrations/20260926110000_soft_delete_event_organization/`.

## Audit log (#209)

`AuditLog` (`prisma/migrations/20260926120000_audit_log/`) stores
**actor, action, entity and timestamp** for sensitive actions:

| Column | Meaning |
| --- | --- |
| `actorId` | `User.id` of the caller (`NULL` for system/cron) |
| `action` | e.g. `organization.create`, `event.publish`, `ticket.revoke` |
| `entityType` | e.g. `Organization`, `Event`, `Ticket` |
| `entityId` | id of the affected row |
| `metadata` | optional JSON context (slug, txHash, ticketIds, …) |
| `createdAt` | timestamp (default `now()`) |

Written (best-effort, never fails the primary write) by
`AuditService` (`src/audit/`) for org actions
(`organization.create/delete/restore`), event actions
(`event.create/publish/unpublish/delete/restore`) and revoke actions
(`ticket.revoke`, `ticket.revoke_batch`).

## BigInt Serialization Strategy

Native JavaScript `BigInt` values (used by Prisma for 64-bit/128-bit integer columns like `chainEventId`, `chainTicketId`, and `price`) are not natively JSON-serializable and cause `TypeError: Do not know how to serialize a BigInt` when processed by standard `JSON.stringify()`.

To ensure consistent string output and prevent runtime crashes:

1. **NestJS Response Interceptor (`BigIntSerializerInterceptor`):**
   - Registered globally in `AppModule`.
   - Recursively traverses response objects and converts all `bigint` primitives into decimal string representations (`"1234567890"`).
   - Preserves primitives, arrays, `null`, `undefined`, and `Date` instances.

2. **`BigInt.prototype.toJSON` Polyfill:**
   - Monkey-patches `BigInt.prototype.toJSON` to return `this.toString()`.
   - Ensures out-of-pipeline `JSON.stringify(obj)` calls (e.g. loggers, Redis serialization) output stringified BigInts consistently.

## Backup and restore

All commands below assume a local PostgreSQL instance reachable at
`postgresql://stellartickets:stellartickets@localhost:5432/stellartickets`
(the default from `docker-compose.yml`). Substitute your `DATABASE_URL`
as needed, and prefix with `docker exec -i <container> ` when the
database runs inside a container (e.g. `docker compose ps` to get the
name).

### Logical backup (`pg_dump`)

Create a plain-text SQL dump:

```bash
pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d_%H%M%S).sql
```

Restore from a plain-text dump (drops and recreates tables via the
`--clean` and `--if-exists` flags):

```bash
psql "$DATABASE_URL" --clean --if-exists -f backup_*.sql
```

### Compressed/custom-format backup (`pg_dump` + `pg_restore`)

Create a compressed dump (recommended for larger databases):

```bash
pg_dump --format=custom "$DATABASE_URL" > backup_$(date +%Y%m%d_%H%M%S).dump
```

Restore from a custom-format dump:

```bash
pg_restore --clean --if-exists --no-owner --verbose "$DATABASE_URL" backup_*.dump
```

### Database dump via Prisma (schema introspection)

For a quick schema-only dump without touching data, Prisma can introspect
the live database and write a Prisma-compatible schema:

```bash
npx prisma db pull       # introspect the live database into schema.prisma
```

> ⚠ **Prisma migrate is the canonical source of truth for schema changes** —
> `prisma db pull` is for introspection only and does not replace version-controlled
> migrations.

### Quick restore from Prisma migrations (dev)

To completely reset the development database to the latest migration
state and reseed:

```bash
npm run db:reset
```

This is equivalent to `prisma migrate reset --force`, which drops the
database, applies all migrations from `prisma/migrations/`, and runs the
seed script defined in `prisma/seed.ts`.
