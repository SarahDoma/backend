# Outbound webhook queue

Delivering a webhook inline ties the outcome of a request to a third party's
endpoint being fast and up. The webhook queue (`src/webhooks/`) moves delivery
out of band: a caller hands a delivery to the queue and carries on, and a
background worker sends it, retrying failures.

It is **optional and disabled by default**. With it off nothing is queued or
sent, Redis is not needed, and the `bullmq` package need not be installed.

## Enabling

1. Install the queue library (only loaded when the queue is enabled):

   ```bash
   npm install bullmq
   ```

2. Turn it on and point it at Redis:

   ```bash
   WEBHOOK_QUEUE_ENABLED=true
   REDIS_URL=redis://localhost:6379
   ```

   `REDIS_URL` is required when the queue is enabled — the app refuses to start
   without it. Use `rediss://` for TLS and put credentials in the URL. For a
   local Redis: `docker run --rm -p 6379:6379 redis:7`.

   BullMQ needs Redis configured with `maxmemory-policy noeviction`; with an
   eviction policy Redis may silently drop queued jobs under memory pressure.

| Variable | Default | Meaning |
|---|---|---|
| `WEBHOOK_QUEUE_ENABLED` | `false` | `true` turns the queue on. |
| `REDIS_URL` | — | Required when enabled. |
| `WEBHOOK_QUEUE_ATTEMPTS` | `5` | Total attempts per webhook, the first included. |
| `WEBHOOK_QUEUE_BACKOFF_MS` | `5000` | Delay before the first retry; doubles each retry (5s, 10s, 20s, 40s). |

## Sending a webhook

Import `WebhooksModule` and inject the queue:

```ts
@Module({ imports: [WebhooksModule], providers: [MyService] })
export class MyModule {}

@Injectable()
export class MyService {
  constructor(@Inject(WEBHOOK_QUEUE) private readonly webhooks: WebhookQueue) {}

  async notify(ticketId: string) {
    const queued = await this.webhooks.enqueue({
      url: 'https://example.com/hooks',
      event: 'ticket.issued',
      payload: { ticketId },
    });
    // `queued` is false when the queue is disabled: nothing was sent.
  }
}
```

`enqueue` resolves `true` once the delivery is stored in Redis and `false` when
the queue is disabled, so a caller can tell "queued" from "not sent". It rejects
if the URL is not `http`/`https` or Redis is unreachable — catch that where a
Redis outage must not fail the request.

## Webhook Registration API

Organizers can manage their registered webhook endpoints under `/v1/organizations/:organizationId/webhooks`:

- `POST /v1/organizations/:organizationId/webhooks`
  - Body: `{ "url": "https://example.com/hooks", "events": "ticket.issued", "secret": "optional-secret" }`
  - Registers a new webhook endpoint. If `secret` is omitted, an opaque random 32-byte hex secret is generated automatically.
- `GET /v1/organizations/:organizationId/webhooks`
  - Lists all registered webhook endpoints for the organization.
- `DELETE /v1/organizations/:organizationId/webhooks/:webhookId`
  - Deletes a registered webhook endpoint.

## HMAC Signature Header (`X-Webhook-Signature`)

When an endpoint has a secret configured, every delivery includes an `X-Webhook-Signature` header containing an HMAC SHA-256 signature of the raw JSON body:

```
X-Webhook-Signature: sha256=a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e
```

### Verifying Signatures

Recipient endpoints should verify the HMAC SHA-256 signature using their endpoint secret:

1. Extract the hex digest from the `X-Webhook-Signature` header (`sha256=<digest>`).
2. Compute the HMAC SHA-256 digest over the raw HTTP request body string using the endpoint secret.
3. Perform a constant-time comparison (`crypto.timingSafeEqual`) between the computed signature and header signature.

## Delivery & Attempt Logging

The worker POSTs `{ "event": "...", "payload": ... }` as JSON, with `X-Webhook-Event` and `X-Webhook-Signature` (when secret configured) headers, expecting a `2xx` within 10 seconds. Anything else — a non-2xx status, a redirect, a timeout, a network error — counts as a failure and is retried with exponential backoff until attempts run out.

- **Attempt Logging:** Every delivery attempt is logged via the `WebhookQueue` logger:
  - Success: `Webhook <event> to <host> succeeded (attempt X/N)`
  - Failure: `Webhook <event> to <host> failed (attempt X/N, will retry / giving up): <error>`
- **At-least-once.** A delivery whose response was lost is retried, so endpoints must tolerate duplicates.
- **Redirects are not followed**, and count as failures.
- Finished jobs are kept for an hour (up to 1,000) and failed ones for 7 days, so exhausted deliveries can be inspected in Redis. Only the target host is logged; the path and query of a URL can carry a secret.
- The worker runs inside every app instance (5 jobs at a time each); BullMQ makes each job run on exactly one of them. It is closed, finishing in-flight deliveries first, when the Nest application is closed.
- Redis errors are logged (`Webhook queue error` / `Webhook worker error`) rather than crashing the process.
