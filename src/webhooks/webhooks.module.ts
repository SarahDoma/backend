import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullMqWebhookQueue } from './bullmq-webhook-queue';
import type { BullMqLike } from './bullmq-webhook-queue';
import { DisabledWebhookQueue } from './disabled-webhook-queue';
import { WEBHOOK_QUEUE } from './webhook-queue';
import type { WebhookQueue } from './webhook-queue';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 5_000;

/**
 * `bullmq` is loaded only when `WEBHOOK_QUEUE_ENABLED=true`, so a deployment
 * that leaves the queue off doesn't need it (or Redis) installed.
 */
export async function loadBullMq(): Promise<BullMqLike> {
  const moduleName = 'bullmq';
  let loaded: Partial<BullMqLike> & { default?: BullMqLike };
  try {
    loaded = (await import(moduleName)) as typeof loaded;
  } catch {
    throw new Error(
      "WEBHOOK_QUEUE_ENABLED=true requires the 'bullmq' package — run `npm install bullmq`.",
    );
  }
  return (loaded.Queue ? loaded : loaded.default) as BullMqLike;
}

/** Turns `redis://user:pass@host:6379/2` (or `rediss://`) into ioredis options. */
export function redisConnectionFromUrl(url: string): Record<string, unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('REDIS_URL is not a valid URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must start with redis:// or rediss://');
  }

  const db = Number(parsed.pathname.slice(1));
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(parsed.pathname.length > 1 && Number.isInteger(db) ? { db } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function createWebhookQueue(
  config: ConfigService,
  load: () => Promise<BullMqLike> = loadBullMq,
): Promise<WebhookQueue> {
  const enabled =
    config.get<string>('WEBHOOK_QUEUE_ENABLED')?.trim().toLowerCase() ===
    'true';
  if (!enabled) {
    return new DisabledWebhookQueue();
  }

  const url = config.get<string>('REDIS_URL');
  if (!url) {
    throw new Error('REDIS_URL is required when WEBHOOK_QUEUE_ENABLED=true');
  }
  const queue = BullMqWebhookQueue.create(await load(), {
    connection: redisConnectionFromUrl(url),
    attempts: positiveInt(
      config.get<number>('WEBHOOK_QUEUE_ATTEMPTS'),
      DEFAULT_ATTEMPTS,
    ),
    backoffMs: positiveInt(
      config.get<number>('WEBHOOK_QUEUE_BACKOFF_MS'),
      DEFAULT_BACKOFF_MS,
    ),
  });
  new Logger('WebhookQueue').log('Using Redis-backed webhook queue');
  return queue;
}

@Module({
  imports: [PrismaModule, OrganizationsModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    {
      provide: WEBHOOK_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createWebhookQueue(config),
    },
  ],
  exports: [WEBHOOK_QUEUE, WebhooksService],
})
export class WebhooksModule {}
