# Testing

## Unit tests

Every service is unit tested with Prisma, `OrganizationsService`, and
`StellarService` mocked out — no real database or Soroban RPC call
happens in `npm test`. Service specs mock `StellarService` at the module
level (`jest.mock('../stellar/stellar.service', ...)`) so they never
touch XDR; the service itself is covered by the harness below.

### StellarService contract-mock harness

`src/stellar/stellar.service.spec.ts` runs the real `StellarService`
against an in-memory Soroban RPC double, so transaction building, XDR
encoding and result decoding are exercised for real while nothing goes
over the network. The pieces:

- `test/mocks/soroban-rpc.mock.ts` — the `rpc.Server` double
  (`createMockRpcServer`), canned `sendTransaction` / `getTransaction` /
  `simulateTransaction` responses, and `ticketScVal` / `eventScVal`
  fixtures that encode the contract's `Ticket` and `Event` structs the
  way `verify_ticket` and `get_event` return them.
- `test/helpers/stellar-harness.ts` — `createStellarHarness()` boots the
  service from an in-memory config (any of `testnet`, `futurenet`,
  `mainnet`) and swaps in the double; `decodeInvokeHostFunction()` takes
  an envelope back apart into source, fee, network passphrase, contract
  id, function name, native arguments and XDR argument types;
  `signAsWallet()` signs an envelope the way a wallet would.

To cover a new `build*Tx` method, add a row to the `cases` table in the
spec with the expected function name, arguments and argument types.
To cover a new contract read, add a fixture next to `ticketScVal` and
feed it through `simulationSuccess`.

```bash
npx jest src/stellar/stellar.service.spec.ts
```

### DTO specs

Every request DTO with non-trivial rules has a colocated `*.dto.spec.ts`
that runs `class-validator` with the same `whitelist` /
`forbidNonWhitelisted` options as the global `ValidationPipe`, covering
the accepted shape, each rejected field, unknown properties, and that
several bad fields are reported together.

```bash
npm test          # run unit tests
npm run test:cov  # with coverage report
```

The coverage gate is configured in `package.json` (`coverageThreshold`).
CI fails if any global threshold (branches, functions, lines, statements)
drops below its minimum.

## End-to-end tests

The e2e suite in `test/` (files matching `*.e2e-spec.ts`) tests full HTTP
request/response flows against a real PostgreSQL database. They use
`supertest` to call the running Nest application and verify persistence,
auth, and business-rule enforcement end-to-end.

Run locally (requires a running Postgres — `docker compose up` is the
easiest way):

```bash
npm run test:e2e
```

The e2e suite needs the same environment variables as the application.
Copy `.env.example` to `.env` and fill in at minimum `DATABASE_URL`,
`JWT_SECRET`, `SOROBAN_RPC_URL`, `TICKETING_CONTRACT_ID`,
`PLATFORM_SIGNER_SECRET`, and the three `OFFLINE_SIGNING_*` values.

### E2E in CI

CI runs the e2e suite in the `e2e-test` job defined in
`.github/workflows/ci.yml`. The job spins up a
`postgres:16` service container, runs `npx prisma migrate deploy` to
apply all migrations, and then runs `npm run test:e2e`. The job
executes on every pull request targeting `main`, so e2e regressions are
caught before merge.

The CI database is isolated (credentials `test/test`, database
`stellar_tickets_test`) and is discarded when the job finishes.

## Seeding for local development

A seed script populates a demo user, organisation, event and ticket
types so you have data to work with immediately:

```bash
npm run db:seed
```

Or reset the database and re-seed in one command:

```bash
npm run db:reset   # drops all tables, re-applies migrations, then seeds
```

See [`prisma/seed.ts`](../prisma/seed.ts) for the demo credentials and
what is created.
