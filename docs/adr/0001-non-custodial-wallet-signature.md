# 0001 — The API never holds a user's key

**Status:** Accepted

## Context

Every write to the `ticketing` Soroban contract calls `require_auth()` from
the account taking the action, and the contract has no admin override for
ticket ownership. So a backend that wanted to act for a user would have to
hold that user's private key.

That is the standard custodial shape, and it is the wrong shape here. Ticket
ownership is the asset. If the API holds user keys, then compromising the API
compromises every ticket on the platform, and users have no recourse but to
trust a single operator with their funds.

It also breaks under the obvious alternatives:

- **Platform escrow key.** The backend signs as itself, so it must custody
  tickets between issue and claim. Transfers become a backend state machine
  with a database row as the authority, and a bug in that state machine
  destroys a ticket.
- **Session key with transfer restrictions.** Soroban supports `require_auth`
  with sub-invocation policies, which allows a bounded session key. It works,
  but it moves the question from "who holds the key" to "what can this key
  do", and the policy has to be audited as carefully as the contract.

The alternative already existed in the SDK: the caller is a Stellar account
the user controls, and a transaction can be built against their public key for
someone else to sign.

## Decision

The API builds **unsigned XDR** and the user's wallet signs it. Split the
ticket lifecycle into a `build*Tx` call that returns the envelope and a
`confirm*` call that accepts the wallet-signed XDR and submits it.

The API submits only transactions that a user has already signed. It never
holds a key that can move a ticket.

`PLATFORM_SIGNER_SECRET` is the one key the backend does hold, and it is
restricted to read-only simulation (`verify_ticket`, `get_event`) as a
disposable source account for fees. Those calls do not reach
`require_auth`. It must never sign a write, and it must never be a user's
key — see `docs/NON-CUSTODIAL.md` and the invariant enforced in
`src/stellar/stellar.service.ts`.

The cost is real: every write is two round trips, the frontend must handle
`build` → user signs → `confirm`, and a signed envelope can go stale if the
underlying state moves. We accept it.

## Consequences

- Users can verify we cannot move their tickets by inspecting the contract.
  This is the property the whole design exists to provide.
- The frontend owns a two-step flow for every write. This is the single
  largest source of frontend complexity, and it is deliberate.
- `PendingTx` exists to make the `build` step resumable, and idempotency
  keys stop a retried `confirm` from double-submitting
  (`IDEMPOTENCY_KEY_TTL_MINUTES`).
- The backend can still be a denial-of-service vector, and `build*Tx` is a
  public surface that costs RPC calls. Rate limiting applies to it.
- We cannot add a "recover my ticket" support action, because recovery
  requires a key we refuse to hold. Support resolves these by having the user
  sign.

## Revisit if

- A Stellar primitive appears that authorises a bounded transfer *without*
  granting custody, and the policy object is small enough to audit.
- The platform moves to a model where the operator is explicitly trusted with
  custody and users consent to it in writing. That is a different product, and
  it should be a new ADR rather than an edit to this one.
