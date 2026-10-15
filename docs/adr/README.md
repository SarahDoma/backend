# Architecture Decision Records

Records of decisions that are expensive to reverse. Each one captures the
context, the decision, and — more usefully — what would make us change our
mind. The goal is that a reader can tell the difference between a decision we
would defend and one we merely inherited.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-non-custodial-wallet-signature.md) | Non-custodial: the API never holds a user's key | Accepted |
| [0002](0002-postgres-as-cache-of-chain-state.md) | Postgres is a cache of chain state, not the source of truth | Accepted |
| [0003](0003-bigint-as-decimal-string.md) | 64-bit chain values cross the wire as decimal strings | Accepted |

## Format

Each file is `NNNN-kebab-case-title.md` with: **Status**, **Context**,
**Decision**, **Consequences**, and **Revisit if**. Status is one of
`Proposed`, `Accepted`, `Deprecated`, `Superseded by ADR-NNNN`.

## When to write one

An ADR is worth writing when a decision constrains future work and the reason
is not obvious from the code. Adding a column does not need one. Choosing to
keep BigInts out of the JSON layer does.

If you supersede a decision, do not edit the old file's body — add a new ADR
and set the old one's status to `Superseded by ADR-NNNN`, so the reasoning
that led to the mistake stays on the record.
