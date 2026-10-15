import { PendingTxCleanupService } from './pending-tx-cleanup.service';
import type { PendingTxService } from './pending-tx.service';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';

describe('PendingTxCleanupService', () => {
  let service: PendingTxCleanupService;
  let pendingTx: { deleteExpired: jest.Mock };
  let config: { get: jest.Mock };
  let scheduler: { addInterval: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    pendingTx = { deleteExpired: jest.fn().mockResolvedValue(2) };
    config = { get: jest.fn().mockReturnValue(undefined) };
    scheduler = { addInterval: jest.fn() };

    service = new PendingTxCleanupService(
      pendingTx as unknown as PendingTxService,
      config as unknown as ConfigService,
      scheduler as unknown as SchedulerRegistry,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs an initial sweep and registers a recurring interval on module init', () => {
    service.onModuleInit();

    expect(pendingTx.deleteExpired).toHaveBeenCalledTimes(1);
    expect(scheduler.addInterval).toHaveBeenCalledTimes(1);
    expect((scheduler.addInterval.mock.calls[0] as unknown[])[0]).toBe(
      'pending-tx-cleanup',
    );
  });

  it('uses the configured cleanup interval', () => {
    config.get.mockReturnValue(5);
    service.onModuleInit();

    jest.advanceTimersByTime(5 * 60_000);
    expect(pendingTx.deleteExpired).toHaveBeenCalledTimes(2);
  });

  it('handles errors from deleteExpired without throwing', async () => {
    pendingTx.deleteExpired.mockRejectedValueOnce(new Error('DB failure'));

    await expect(service.cleanupExpired()).resolves.toBe(0);
  });
});
