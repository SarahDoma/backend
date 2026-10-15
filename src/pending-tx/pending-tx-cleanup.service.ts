import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PendingTxService } from './pending-tx.service';

/** Fallback cleanup cadence when PENDING_TX_CLEANUP_INTERVAL_MINUTES isn't set. */
const DEFAULT_CLEANUP_INTERVAL_MINUTES = 15;
const CLEANUP_JOB_NAME = 'pending-tx-cleanup';

/** Periodically deletes expired `PendingTx` rows so they don't accumulate. */
@Injectable()
export class PendingTxCleanupService implements OnModuleInit {
  private readonly logger = new Logger(PendingTxCleanupService.name);

  constructor(
    private readonly pendingTx: PendingTxService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const configured = this.config.get<number>(
      'PENDING_TX_CLEANUP_INTERVAL_MINUTES',
    );
    const intervalMinutes =
      configured && configured > 0
        ? configured
        : DEFAULT_CLEANUP_INTERVAL_MINUTES;

    const interval = setInterval(() => {
      void this.cleanupExpired();
    }, intervalMinutes * 60_000);
    this.scheduler.addInterval(CLEANUP_JOB_NAME, interval);

    // Run an initial sweep on startup rather than waiting for the first tick.
    void this.cleanupExpired();
  }

  async cleanupExpired(): Promise<number> {
    try {
      const deletedCount = await this.pendingTx.deleteExpired();
      if (deletedCount > 0) {
        this.logger.log(
          `Cleaned up ${deletedCount} expired pending transaction(s).`,
        );
      }
      return deletedCount;
    } catch (err) {
      this.logger.error('Failed to clean up expired pending transactions', err);
      return 0;
    }
  }
}
