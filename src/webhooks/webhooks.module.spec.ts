import type { ConfigService } from '@nestjs/config';
import { BullMqWebhookQueue } from './bullmq-webhook-queue';
import type { BullMqLike } from './bullmq-webhook-queue';
import { DisabledWebhookQueue } from './disabled-webhook-queue';
import { createWebhookQueue, redisConnectionFromUrl } from './webhooks.module';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function fakeBullMq() {
  const Queue = jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    on: jest.fn(),
    close: jest.fn(),
  }));
  const Worker = jest
    .fn()
    .mockImplementation(() => ({ on: jest.fn(), close: jest.fn() }));
  return { Queue, Worker, bullmq: { Queue, Worker } as unknown as BullMqLike };
}

describe('createWebhookQueue', () => {
  it('is disabled by default and never loads bullmq', async () => {
    const load = jest.fn();

    const queue = await createWebhookQueue(configWith({}), load);

    expect(queue).toBeInstanceOf(DisabledWebhookQueue);
    expect(load).not.toHaveBeenCalled();
  });

  it('stays disabled for WEBHOOK_QUEUE_ENABLED=false, even with a REDIS_URL', async () => {
    const load = jest.fn();

    const queue = await createWebhookQueue(
      configWith({
        WEBHOOK_QUEUE_ENABLED: 'false',
        REDIS_URL: 'redis://localhost:6379',
      }),
      load,
    );

    expect(queue).toBeInstanceOf(DisabledWebhookQueue);
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses to start enabled without a REDIS_URL', async () => {
    await expect(
      createWebhookQueue(
        configWith({ WEBHOOK_QUEUE_ENABLED: 'true' }),
        jest.fn(),
      ),
    ).rejects.toThrow('REDIS_URL is required');
  });

  it('builds the Redis-backed queue when enabled', async () => {
    const { bullmq, Queue } = fakeBullMq();

    const queue = await createWebhookQueue(
      configWith({
        WEBHOOK_QUEUE_ENABLED: ' TRUE ',
        REDIS_URL: 'redis://:secret@redis.internal:6380/2',
      }),
      () => Promise.resolve(bullmq),
    );

    expect(queue).toBeInstanceOf(BullMqWebhookQueue);
    expect(Queue).toHaveBeenCalledWith(
      'webhook-delivery',
      expect.objectContaining({
        connection: {
          host: 'redis.internal',
          port: 6380,
          password: 'secret',
          db: 2,
        },
        defaultJobOptions: expect.objectContaining({
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
        }) as object,
      }),
    );
  });

  it('honours configured attempts and backoff', async () => {
    const { bullmq, Queue } = fakeBullMq();

    await createWebhookQueue(
      configWith({
        WEBHOOK_QUEUE_ENABLED: 'true',
        REDIS_URL: 'redis://localhost:6379',
        WEBHOOK_QUEUE_ATTEMPTS: 8,
        WEBHOOK_QUEUE_BACKOFF_MS: 250,
      }),
      () => Promise.resolve(bullmq),
    );

    expect(Queue).toHaveBeenCalledWith(
      'webhook-delivery',
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 8,
          backoff: { type: 'exponential', delay: 250 },
        }) as object,
      }),
    );
  });

  it('surfaces a missing bullmq package', async () => {
    await expect(
      createWebhookQueue(
        configWith({
          WEBHOOK_QUEUE_ENABLED: 'true',
          REDIS_URL: 'redis://localhost:6379',
        }),
        () => Promise.reject(new Error("requires the 'bullmq' package")),
      ),
    ).rejects.toThrow("requires the 'bullmq' package");
  });
});

describe('redisConnectionFromUrl', () => {
  it('defaults the port and leaves out unset credentials', () => {
    expect(redisConnectionFromUrl('redis://localhost')).toEqual({
      host: 'localhost',
      port: 6379,
    });
  });

  it('reads credentials, port and database, decoding escapes', () => {
    expect(
      redisConnectionFromUrl('redis://user:p%40ss@redis.example.com:6380/3'),
    ).toEqual({
      host: 'redis.example.com',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 3,
    });
  });

  it('enables TLS for rediss://', () => {
    expect(redisConnectionFromUrl('rediss://cache.example.com:6379')).toEqual({
      host: 'cache.example.com',
      port: 6379,
      tls: {},
    });
  });

  it('strips the brackets from an IPv6 host', () => {
    expect(redisConnectionFromUrl('redis://[::1]:6379')).toMatchObject({
      host: '::1',
    });
  });

  it.each(['not a url', 'http://localhost:6379', 'localhost:6379'])(
    'rejects %p',
    (url) => {
      expect(() => redisConnectionFromUrl(url)).toThrow('REDIS_URL');
    },
  );
});
