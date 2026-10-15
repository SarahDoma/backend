# Input validation

Every DTO uses `class-validator` decorators, enforced globally by the
`ValidationPipe` registered in `main.ts` with `whitelist: true` and
`forbidNonWhitelisted: true` — any field not declared on a DTO is
stripped, and any extra field in the request body causes a 400 rather
than being silently ignored.

`IsStellarPublicKey` (in `src/common/decorators`) validates the
ed25519 checksum via `@stellar/stellar-sdk`'s `StrKey`, not a regex —
a string that merely looks like a Stellar address but fails the
checksum is rejected before it ever reaches a service.

`IsBigIntString` (in `src/common/decorators`) accepts non-negative integer
strings (digits only, no leading zeros except `0`, at most 39 digits) so
values that flow into `BigInt(...)` fail with a 400 at the DTO boundary
instead of a 500 from a parse error.

`IsSeat` (in `src/common/decorators`) validates seat format to prevent
arbitrary strings from bloating the database or causing Soroban contract
issues. Seats must be 1–64 characters, alphanumeric with spaces, hyphens,
slashes, or periods. Whitespace-only strings are rejected.

## Max-length limits

Free-text fields have length limits to prevent database bloat:

| Field | DTOs | Limit | Reason |
|-------|------|-------|--------|
| `name` | `CreateEventDto`, `CreateOrganizationDto`, `CreateTicketTypeDto` | 256 | Event/organization/ticket-type names |
| `venue` | `CreateEventDto` | 256 | Event venue names |
| `seat` | `IssueTicketDto`, `PurchasePrimaryDto` | 64 | Ticket seat identifiers |
| `slug` | `CreateOrganizationDto` | 128 | Organization URL slugs |

String fields are trimmed (leading/trailing whitespace removed) via
`@Transform` decorators on DTOs, and validators reject whitespace-only values.

