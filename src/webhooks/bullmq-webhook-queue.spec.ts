import { BullMqWebhookQueue } from './bullmq-webhook-queue';
import type { BullMqLike } from './bullmq-webhook-queue';

jest.mock('./webhook-delivery', () => ({
  deliverWebhook: jest.fn().mockResolvedValue(undefined),
}));
import { deliverWebhook } from './webhook-delivery';

const delivery = {
  url: 'https://example.com/hooks',
  event: 'ticket.issued',
  payload: { ticketId: 't-1' },
};

function fakeBullMq() {
  const queue = {
    add: jest.fn().mockResolvedValue({ id: '1' }),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const worker = {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const Queue = jest.fn().mockImplementation(() => queue);
  const Worker = jest.fn().mockImplementation(() => worker);
  return {
    queue,
    worker,
    Queue,
    Worker,
    bullmq: { Queue, Worker } as unknown as BullMqLike,
  };
}

const options = {
  connection: { host: 'localhost', port: 6379 },
  attempts: 4,
  backoffMs: 2_000,
};

describe('BullMqWebhookQueue', () => {
  it('creates the queue with exponential-backoff retries', () => {
    const { bullmq, Queue } = fakeBullMq();

    BullMqWebhookQueue.create(bullmq, options);

    expect(Queue).toHaveBeenCalledWith(
      'webhook-delivery',
      expect.objectContaining({
        connection: options.connection,
        defaultJobOptions: expect.objectContaining({
          attempts: 4,
          backoff: { type: 'exponential', delay: 2_000 },
        }) as object,
      }),
    );
  });

  it('gives the worker a connection that keeps retrying Redis', () => {
    const { bullmq, Worker } = fakeBullMq();

    BullMqWebhookQueue.create(bullmq, options);

    expect(Worker).toHaveBeenCalledWith(
      'webhook-delivery',
      expect.any(Function),
      expect.objectContaining({
        connection: {
          host: 'localhost',
          port: 6379,
          maxRetriesPerRequest: null,
        },
      }),
    );
  });

  it('delivers each job through deliverWebhook', async () => {
    const { bullmq, Worker } = fakeBullMq();
    BullMqWebhookQueue.create(bullmq, options);

    const processor = (Worker.mock.calls[0] as unknown[])[1] as (job: {
      data: typeof delivery;
    }) => Promise<unknown>;
    await processor({ data: delivery });

    expect(deliverWebhook).toHaveBeenCalledWith(delivery);
  });

  it('listens for queue and worker errors so a Redis blip cannot crash the process', () => {
    const { bullmq, queue, worker } = fakeBullMq();

    BullMqWebhookQueue.create(bullmq, options);

    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('adds a job for a valid delivery and reports it queued', async () => {
    const { bullmq, queue } = fakeBullMq();
    const webhookQueue = BullMqWebhookQueue.create(bullmq, options);

    expect(await webhookQueue.enqueue(delivery)).toBe(true);
    expect(queue.add).toHaveBeenCalledWith('deliver', delivery);
  });

  it('rejects a non-http(s) url without queueing it', async () => {
    const { bullmq, queue } = fakeBullMq();
    const webhookQueue = BullMqWebhookQueue.create(bullmq, options);

    await expect(
      webhookQueue.enqueue({ ...delivery, url: 'file:///etc/passwd' }),
    ).rejects.toThrow('http or https');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('propagates a queue failure so the caller can handle Redis being down', async () => {
    const { bullmq, queue } = fakeBullMq();
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));
    const webhookQueue = BullMqWebhookQueue.create(bullmq, options);

    await expect(webhookQueue.enqueue(delivery)).rejects.toThrow(
      'ECONNREFUSED',
    );
  });

  it('closes the worker before the queue on module destroy', async () => {
    const { bullmq, queue, worker } = fakeBullMq();
    const order: string[] = [];
    worker.close.mockImplementation(() => {
      order.push('worker');
      return Promise.resolve();
    });
    queue.close.mockImplementation(() => {
      order.push('queue');
      return Promise.resolve();
    });

    await BullMqWebhookQueue.create(bullmq, options).onModuleDestroy();

    expect(order).toEqual(['worker', 'queue']);
  });
});
