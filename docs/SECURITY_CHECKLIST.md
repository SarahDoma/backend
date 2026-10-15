# OWASP API Security Top 10 (2023) review

Security review of this API has been ad hoc — this maps the current
controls against each OWASP API Security Top 10 (2023) category, as a
baseline for future review rather than a one-time audit. Re-check this
against the code when a review is due, since it will drift as the API
changes.

## API1:2023 — Broken Object Level Authorization

**Status: mostly covered.** Every resource-scoped read/write goes through
an ownership or membership check before touching data:
`OrganizationsService.assertMember` gates organizer actions
(`TicketsService.buildIssueTx`, `verify`, `buildCheckInTx`, `buildRevokeTx`,
the new `getOfflineToken`, etc.), and `TicketsService.getOwnedTicket` gates
owner actions (transfer, resale). IDs are UUIDs, not sequential integers,
so they aren't enumerable.

**Gap:** these checks are hand-written per method rather than declared
(e.g. via a guard or decorator), so a new endpoint that forgets to call
`assertMember`/`getOwnedTicket` would silently have no object-level check.
No automated test currently asserts that *every* ticket/organization
endpoint enforces one.

## API2:2023 — Broken Authentication

**Status: mostly covered.** JWT bearer auth (`JwtAuthGuard`,
`JwtStrategy`), bcrypt password hashing at 12 rounds — see
`docs/AUTHENTICATION.md`.

**Gap:** no rate limiting on `/auth/login` or `/auth/register` yet
(tracked in `docs/RATE_LIMITING.md` / `ROADMAP.md`), so credential
stuffing and account enumeration via response timing/differences are
possible. Tokens also have no refresh flow or revocation list — a
compromised token is valid until it expires.

## API3:2023 — Broken Object Property Level Authorization

**Status: mostly covered.** `ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true })` in `main.ts` strips and rejects any request
body property not declared on a DTO, which closes the usual mass-assignment
route. Response shapes are also hand-built in each service method (e.g.
`TicketsService.verify`'s return object) rather than returning a raw Prisma
row, so `passwordHash` and similar fields aren't accidentally serialized.

**Gap:** this relies on every new endpoint remembering to hand-build its
response rather than `return`-ing an ORM entity directly; nothing enforces
that structurally.

## API4:2023 — Unrestricted Resource Consumption

**Status: partially covered.** `ScanRateLimitGuard` now limits ticket
verification scans per IP and per secret (`docs/RATE_LIMITING.md`). Prisma
queries in this codebase are all scoped by unique id or a specific
relation, not open-ended list endpoints with unbounded page sizes.

**Gap:** no rate limiting anywhere else — `/auth/login`, `/auth/register`,
ticket issuance/purchase-build endpoints are all uncapped. There's also no
request body size limit configured explicitly (relying on Express/Nest
defaults) and no global request rate limit.

## API5:2023 — Broken Function Level Authorization

**Status: partially covered.** Organizer-only functions check organization
membership; there's no distinction today between `STAFF`/`ADMIN`/`OWNER`
roles within an organization for actions like revocation — any member can
revoke or check in a ticket. `RolesGuard` (`src/auth/guards/roles.guard.ts`)
exists for platform-level role gating but per `docs/AUTHENTICATION.md` is
not currently applied to any route.

**Gap:** no endpoint restricts by `OrgMemberRole` (e.g. requiring `OWNER`
for revocation vs. `STAFF` for check-in), and `RolesGuard` sits unused.

## API6:2023 — Unrestricted Access to Sensitive Business Flows

**Status: partially covered.** Ticket purchase/issuance require an
authenticated session and a connected wallet, and every state-changing
on-chain action requires a signature from the *acting* account
(`docs/NON_CUSTODIAL.md`), which is a meaningful anti-automation barrier by
itself — a bot can't buy tickets without a funded, signing wallet.

**Gap:** there's no additional friction (CAPTCHA, purchase-per-user caps,
queueing) on high-demand primary sales, so a well-funded bot with many
wallets could still buy disproportionately.

## API7:2023 — Server Side Request Forgery

**Status: covered — low surface.** The only outbound server-initiated
requests are to `SOROBAN_RPC_URL`, a single operator-configured endpoint
(`docs/CONFIGURATION.md`); no endpoint accepts a user-supplied URL to fetch
or proxy.

## API8:2023 — Security Misconfiguration

**Status: mostly covered.** `helmet()` is applied in `main.ts`; CORS is
locked to a single configured origin (`docs/CORS.md`); all environment
config is validated at boot and the app refuses to start on a missing or
malformed value (`src/config/env.validation.ts`); Dependabot
(`.github/dependabot.yml`) checks npm and GitHub Actions dependencies
weekly.

**Gap:** no explicit HTTP security headers review beyond helmet's defaults,
and Dependabot opens PRs but nothing enforces that they get merged
promptly.

## API9:2023 — Improper Inventory Management

**Status: partially covered.** There's one versionless API surface with no
deprecated endpoints yet, which keeps this simple, but there's no OpenAPI/
Swagger spec or endpoint inventory doc — `docs/API.md` should be checked
for currency whenever an endpoint is added or changed.

**Gap:** no automated check that `docs/API.md` matches the actual
controllers; nothing catches an undocumented or forgotten endpoint.

## API10:2023 — Unsafe Consumption of APIs

**Status: mostly covered.** The only external API consumed is the Soroban
RPC (via `@stellar/stellar-sdk`); responses are typed and go through the
SDK rather than being parsed ad hoc. `StellarService.verifyTicket` results
are reconciled against, not blindly trusted over, the local cached status.

**Gap:** no explicit timeout/circuit breaker around RPC calls observed —
an unresponsive RPC endpoint would hang the request rather than fail fast.

## Gaps to track as issues

The gaps above that aren't already tracked elsewhere in this repo's docs
(`RATE_LIMITING.md`, `ROADMAP.md`) are candidates for individual follow-up
issues rather than being fixed as part of this checklist:

1. No automated/structural test that every resource-scoped endpoint
   enforces an object-level authorization check (API1).
2. No rate limiting on `/auth/login` / `/auth/register` (API2, API4).
3. No token revocation or refresh flow (API2).
4. No per-organization-role (`OrgMemberRole`) restriction on sensitive
   actions like revocation (API5); `RolesGuard` is unused.
5. No anti-automation controls on high-demand primary ticket sales beyond
   requiring a signing wallet (API6).
6. No OpenAPI spec or automated check that `docs/API.md` stays in sync
   with the controllers (API9).
7. No explicit timeout/circuit breaker on Soroban RPC calls (API10).

These are recorded here rather than filed automatically — filing them as
GitHub issues is a maintainer action outside the scope of this checklist.
