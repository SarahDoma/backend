/** One outbound webhook call: POST `{ event, payload }` as JSON to `url`. */
export interface WebhookDelivery {
  url: string;
  /** Event name, e.g. `ticket.issued`. Also sent as the `X-Webhook-Event` header. */
  event: string;
  /** JSON-serializable body sent under `payload`. */
  payload: unknown;
  /** Optional secret used to generate HMAC SHA-256 signature sent as `X-Webhook-Signature`. */
  secret?: string;
}

/**
 * Hands webhook deliveries to a background worker that retries failures, so a
 * slow or failing endpoint never blocks (or fails) the request that raised
 * the event. Off unless `WEBHOOK_QUEUE_ENABLED=true` — see docs/WEBHOOKS.md.
 */
export interface WebhookQueue {
  /**
   * Queues `delivery` for background delivery. Resolves `true` once it is
   * durably queued and `false` when the queue is disabled, in which case
   * nothing was sent and the caller decides whether to deliver another way.
   * Rejects if the URL is not http(s) or Redis is unreachable.
   */
  enqueue(delivery: WebhookDelivery): Promise<boolean>;
}

export const WEBHOOK_QUEUE = Symbol('WEBHOOK_QUEUE');

export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';

/** Only plain http(s) endpoints are delivered to. */
export function assertWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('Webhook url is not a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('Webhook url must use http or https');
  }
}
