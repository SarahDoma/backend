import type { WebhookQueue } from './webhook-queue';

/** The default: accepts nothing, sends nothing, needs no Redis. */
export class DisabledWebhookQueue implements WebhookQueue {
  enqueue(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
