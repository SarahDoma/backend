import * as crypto from 'crypto';
import type { WebhookDelivery } from './webhook-queue';

export const WEBHOOK_TIMEOUT_MS = 10_000;

interface DeliverOptions {
  /** Injectable so tests don't hit the network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Computes an HMAC SHA-256 signature for the webhook JSON payload string.
 * Formatted as `sha256=<hex_digest>`.
 */
export function computeWebhookSignature(body: string, secret: string): string {
  const hash = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hash}`;
}

/**
 * Performs one delivery attempt. Anything but a 2xx — including a timeout, a
 * network error or a redirect — throws, which is what makes the queue retry.
 */
export async function deliverWebhook(
  delivery: WebhookDelivery,
  { fetchImpl = fetch, timeoutMs = WEBHOOK_TIMEOUT_MS }: DeliverOptions = {},
): Promise<void> {
  const body = JSON.stringify({
    event: delivery.event,
    payload: delivery.payload,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-webhook-event': delivery.event,
  };

  if (delivery.secret) {
    headers['x-webhook-signature'] = computeWebhookSignature(
      body,
      delivery.secret,
    );
  }

  const response = await fetchImpl(delivery.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
    // Never follow a redirect to somewhere the caller didn't ask for.
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`Webhook endpoint responded with HTTP ${response.status}`);
  }
}
