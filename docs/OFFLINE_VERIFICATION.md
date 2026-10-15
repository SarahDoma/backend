# Offline gate verification

`GET /tickets/verify/:qrSecret` requires a network round trip to this API and
a check against the chain. A gate scanner running with no connectivity (a
basement venue, a stadium with saturated wifi, a rural festival) can't make
that call. This is the offline fallback: a small, signed payload embedded
alongside the existing QR secret that a scanner can verify against a locally
cached public key, with no server involved.

## How it works

1. When a ticket is issued (or reconciled), the backend signs a small
   payload — `{ ticketId, chainTicketId, eventId, status, exp }` — with an
   Ed25519 private key and returns it as `{ payload, kid, signature }` from
   `GET /tickets/:ticketId/offline-token` (organizer/staff only, same guard
   as the rest of the gate endpoints).
2. That token is embedded in the ticket's QR code alongside the existing
   `qrSecret`. The two aren't the same thing: `qrSecret` is what `verify`
   checks online against the DB and the chain; the offline token is what a
   scanner checks against nothing but its own cached public key.
3. Gate scanner apps fetch `GET /tickets/offline-public-keys` while they
   *do* have network — at setup, or once per shift — and cache the result.
   It returns every key id a scanner should currently accept, mapped to its
   PEM-encoded public key.
4. At the door, with no network at all, the scanner:
   - decodes the QR into `{ payload, kid, signature }`,
   - looks up `kid` in its cached key map,
   - verifies the Ed25519 signature over `JSON.stringify(payload)`,
   - rejects the token if `payload.exp` has passed.

`OfflineTokenService.verify` (and its static form, `OfflineTokenService.verify(token, publicKeysPem)`)
implements exactly that check and is the reference implementation a scanner
client should port.

An offline accept is provisional, not a substitute for reconciliation: it
proves the token was minted by this backend and hasn't expired, not that the
ticket wasn't revoked or already used by another gate five minutes ago.
Scanners should still reconcile against `verify` (or a batch reconciliation
endpoint) the moment they're back online.

## Payload

```json
{
  "ticketId": "ab12...",
  "chainTicketId": "1042",
  "eventId": "ev-9",
  "status": "VALID",
  "exp": 1780000000
}
```

`exp` is a short TTL (not the event date) — it bounds how long a scanner can
go on trusting a token it can no longer check against reconciled state. A
scanner should fetch a fresh token (or reconnect and re-verify) well before
it expires, not just at the door.

## Key rotation

Two environment variables carry the keys:

- `OFFLINE_SIGNING_KEY_ID` / `OFFLINE_SIGNING_PRIVATE_KEY` — the key
  currently used to *sign* new tokens. One key id, one private key.
- `OFFLINE_SIGNING_PUBLIC_KEYS` — a JSON map of **every** key id a scanner
  should still *accept*, `{ "<kid>": "<PEM public key>" }`. This includes
  retired keys, not just the current one — a token signed yesterday should
  keep verifying today even after you rotate, until it naturally expires via
  `exp`.

To rotate:

1. Generate a new Ed25519 keypair:
   ```bash
   openssl genpkey -algorithm ed25519 -out new-private.pem
   openssl pkey -in new-private.pem -pubout -out new-public.pem
   ```
2. Pick a new key id (a date-based id like `2026-02` keeps `OFFLINE_SIGNING_KEY_ID`
   self-documenting).
3. Add the new public key to `OFFLINE_SIGNING_PUBLIC_KEYS` **before** the
   rotation deploy, so already-cached scanners that haven't re-fetched yet
   don't suddenly reject a token signed with a key id they don't recognize
   in the other direction (a new token signed with a key their cache
   doesn't have yet).
4. Deploy with `OFFLINE_SIGNING_KEY_ID` / `OFFLINE_SIGNING_PRIVATE_KEY` set
   to the new pair. New tokens now sign with the new key; old ones already
   handed out keep verifying via the old entry in `OFFLINE_SIGNING_PUBLIC_KEYS`.
5. Once every token signed with the old key has expired (bounded by the
   token TTL — see the `exp` field above), remove the old key id from
   `OFFLINE_SIGNING_PUBLIC_KEYS`.
6. Redeploy scanner apps' cached keys by having them hit
   `GET /tickets/offline-public-keys` again — this happens automatically the
   next time they have network, since they're expected to refresh
   periodically rather than cache forever.

Rotate immediately, out of band from this schedule, if a private key is
ever suspected to have leaked — a leaked signing key lets an attacker mint
tickets that verify offline with no way for a disconnected scanner to know
they were never issued by this backend.
