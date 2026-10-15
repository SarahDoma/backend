# 0003 — 64-bit chain values cross the wire as decimal strings

**Status:** Accepted

## Context

Soroban represents token amounts and ids as `u64` / `u128`, and Prisma maps
those columns to JavaScript `BigInt`. `chainEventId`, `chainTicketId` and
every `price` column are `BigInt` in `prisma/schema.prisma`.

`BigInt` is deliberate — a `u64` does not fit in a JavaScript `number`, whose
safe integer limit is 2^53-1. Ticket ids and stroop prices blow past that
early, so `Number()` is not an option and `parseInt` without a radix is
worse. The problem is the boundary, not the storage: `BigInt` cannot cross
JSON.

`JSON.stringify(1n)` throws `TypeError: Do not know how to serialize a
BigInt`. Anything that serialises a response, writes to a log, or pushes into
Redis hits that. The failure surfaces wherever it happens to occur — usually
in a log line, well away from the request that caused it.

The alternatives were all worse:

- **Store as `String` in Postgres.** Works, but loses the numeric type in the
  database, makes range queries lexicographic unless every query casts, and
  silently permits a non-numeric value that only fails at chain-submit time.
- **Store as `Float`/`Decimal`.** Loses precision on exactly the values that
  must be exact.
- **Serialise as `Number`.** Silently corrupts values above 2^53. A price
  that is off by a few stroops is a support incident nobody can reproduce.

## Decision

Keep `BigInt` in Postgres and in the service layer, and **serialise it to a
decimal string at the JSON boundary**. Always as a string, never as a number,
so a client cannot lose precision by assuming otherwise.

Two mechanisms, because there are two call sites:

- `BigIntSerializerInterceptor` (`src/common/interceptors/`), registered
  globally, walks the response — nested objects, arrays, arbitrary depth —
  and converts every `bigint` to its decimal string. It preserves `null`,
  `undefined`, primitives and `Date` instances.
- A `BigInt.prototype.toJSON` polyfill in the same file, for
  `JSON.stringify` calls that bypass the Nest pipeline entirely: loggers,
  Redis, queue payloads.

Incoming values are validated as strings with `@IsBigIntString()` so a
non-numeric value is rejected at the edge rather than at chain-submit time.

The trade-off is real and we are choosing it deliberately: **BigInts do not
survive the round trip.** A client that receives `"price": "1000000"` and
reads it as a number has opted out of the safety. That is why the type is
string on the wire and the DTO validator is a string validator — the two
together make the lossy step visible instead of silent.

## Consequences

- Frontend code must parse these fields with `BigInt(str)` or a big-integer
  library, not arithmetic. This is the main integration cost, and it is why
  the wire type is a string rather than a number.
- Prices are in stroops. A `price` of `"1000000"` is 0.1 XLM, and nothing in
  the API divides it for you.
- Adding a new `BigInt` column needs no new plumbing, which is the point. The
  interceptor and the polyfill are global.
- The prototype patch is global mutable state. It is guarded against
  double-patching, but it is still a monkey-patch, and it is the part of this
  decision most likely to surprise someone.
- Anything using `JSON.stringify` on its own structures gets consistent
  behaviour for free — the polyfill is not scoped to responses.

## Revisit if

- A JSON serialisation format gains first-class bigint support and the
  frontend and gateway can both adopt it. Then the string convention can be
  retired deliberately rather than accreted around.
- `chainEventId` and `chainTicketId` stop being chain-derived. If they became
  application-owned, they would no longer need 64 bits and the whole
  complication would be worth removing — see the closing note in
  [ADR-0002](0002-postgres-as-cache-of-chain-state.md).
