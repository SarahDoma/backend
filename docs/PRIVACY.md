# Privacy notice

What this backend stores about a user, why, and how long it's kept. This
describes the current implementation (`prisma/schema.prisma`), not a legal
policy — see the note on that at the bottom.

## What's collected

| Data | Where | Why |
|---|---|---|
| Email | `User.email` | Login identifier. |
| Password hash | `User.passwordHash` | Bcrypt hash (12 rounds), never the plaintext password — see `docs/AUTHENTICATION.md`. Never returned by any endpoint. |
| Name | `User.name` | Shown to gate staff during verification (`TicketsService.verify`) and on resale listings. |
| Stellar public key | `User.stellarPublicKey` | Where tickets are issued to and payments settle. Public by nature — see "On-chain data" below. Optional; several actions (buying, receiving a ticket) require it to be set first. |
| Organization membership | `OrganizationMember` | Which organizations a user can act for (issue tickets, check people in, revoke). |
| Ticket ownership & history | `Ticket`, `ResaleListing` | Which tickets a user holds or has resold, and the transaction hash that produced each state change. |
| Verification-scan velocity counters | In-process memory by default (`ScanRateLimitGuard`), or Redis if `RATE_LIMIT_STORE=redis` | Abuse prevention — never written to the database. Memory counters are cleared on every restart; Redis counters expire on their own after `SCAN_RATE_LIMIT_WINDOW_MS`. See `docs/RATE_LIMITING.md`. |

Nothing else is collected server-side: no analytics, no device fingerprinting,
no IP logging beyond the short-lived rate-limit counters above.

## On-chain data is public and permanent

Every ticket issuance, transfer, check-in, revocation, and resale is a
transaction on the Stellar ledger. That means the paying/receiving public
key, the amount, and the timestamp for each of those actions are **public,
permanent, and outside this backend's control** — they can't be deleted or
anonymized after the fact, by us or by the user. A Stellar public key is
pseudonymous, not anonymous: anyone can look up its full transaction history
on a block explorer.

The database columns that mirror chain state (`Ticket.status`,
`chainTicketId`, `issuedTxHash`, etc.) exist so the app doesn't need a
Soroban RPC round trip for every read; the chain — not this database —
remains the actual source of truth (`docs/ARCHITECTURE.md`).

## What is never collected

- **Private keys.** The API never asks for, receives, or stores a Stellar
  secret key, in any code path, including in development — see
  `docs/NON_CUSTODIAL.md`.
- **Payment card or bank details.** All settlement is on-chain in the
  platform's token; there is no card processor integration.

## Deletion and correction

There is currently no self-service account deletion or data export
endpoint. A user who wants their off-chain data (email, name, password
hash) removed should contact an administrator directly; on-chain history
tied to their public key cannot be deleted for the reasons above.

## Third parties

- **Stellar network / Soroban RPC** (`SOROBAN_RPC_URL`) — every on-chain
  read and write passes through this. See `docs/CONFIGURATION.md`.
- No analytics, advertising, or error-tracking third party currently
  receives user data from this backend.

## Scope of this document

This is an engineering-facing description of what the system actually
stores, meant to stay accurate as the schema changes. It is not a
substitute for a reviewed, published, legally binding privacy policy —
publishing one is a separate step involving legal review of jurisdiction,
retention obligations, and user rights (e.g. GDPR/CCPA), and should treat
this document as its technical starting point rather than as the policy
itself.
