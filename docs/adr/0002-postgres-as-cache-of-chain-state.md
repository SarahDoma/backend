# 0002 — Postgres is a cache of chain state

**Status:** Accepted

## Context

The authoritative record of who owns which ticket, and whether a ticket is
valid, burned or transferred, is the `ticketing` contract on Stellar. That is
a public ledger we do not control.

The API still needs to answer questions a contract read cannot answer
efficiently: *list every event for this organization, newest first*, *what
did this ticket sell for*, *which tickets does this user hold*. Answering
those from the ledger means either an indexer or a scan. So Postgres holds a
denormalised mirror of the state we care about, kept current on the write
paths we control.

The tempting mistake is to let the mirror quietly become authoritative,
because it is right there and it is fast. Once any code path treats the
Postgres row as the answer, we have a second source of truth that the ledger
cannot correct, and the only way to find out is to have already lost a ticket.

The reverse mistake is to treat the ledger as authoritative for *every*
read. A `GET` that has to survive a Soroban RPC outage cannot do that.

## Decision

**The ledger is authoritative. Postgres is a read-through cache of it, and
every read path must be able to say how fresh its answer is.**

Concretely:

- Writes go through the non-custodial `build*Tx` / `confirm*` flow
  ([ADR-0001](0001-non-custodial-wallet-signature.md)), and the Postgres row
  is updated only after a transaction lands. A row is never updated in
  anticipation of a chain write.
- The mirror is *self-healing*. `verify` re-reads on-chain state and
  overwrites the local row when it disagrees, so a missed update or a failed
  webhook is corrected on the next read rather than persisting
  (`src/tickets/tickets.service.ts`).
- **Degradation is explicit, never silent.** When the RPC is unavailable,
  `verify` serves the cached row and sets `stale: true` in the response
  rather than throwing or quietly returning stale data as fresh. This was
  issue #321. An API that fails closed on RPC outage takes ticket scanning
  down at the door; one that lies about freshness is worse. Callers can see
  which one they got.
- The mirror is disposable. Deleting the database and rebuilding it from the
  ledger must be possible. Anything that cannot be rebuilt is a bug in this
  ADR's terms.

## Consequences

- Every read that matters carries a freshness cost, and the honest ones expose
  it. `stale: true` is part of the response contract, not an implementation
  detail.
- `Ticket.ownerId` can disagree with the chain owner temporarily. Anything
  security-relevant must check the chain, not the row — the offline
  verification path exists partly for this reason.
- We carry a circuit breaker in front of the RPC so an outage does not turn
  into a latency cliff, and its state is visible at
  `GET /v1/stellar/circuit-breaker/metrics`. Note this endpoint is currently
  unauthenticated; it exposes failure counts only, but that is a decision
  waiting to be made deliberately.
- There is no cross-region write story. A single Postgres is the cache, and
  horizontal scaling means sharing a cache (`CACHE_DRIVER=redis`), not
  sharding the mirror.

## Revisit if

- An on-chain indexer becomes available and dependable enough to serve reads
  directly, which would remove the mirror for most query paths.
- The platform needs read-your-writes guarantees stronger than "the row is
  updated in the same request that submits the transaction".
- The platform starts storing user data that is *not* mirrored from the chain
  (messages, preferences, drafts). That data is owned by the database, and
  splitting "database as cache" from "database as record" under one schema
  invites the exact confusion this ADR exists to prevent.
