import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TicketsService } from './tickets.service';

/** Interval for checking and cancelling expired resale listings (every 60 seconds). */
const EXPIRY_CHECK_INTERVAL_MS = 60_000;

@Injectable()
export class ResaleExpiryService implements OnModuleInit {
  private readonly logger = new Logger(ResaleExpiryService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly ticketsService: TicketsService) {}

  onModuleInit() {
    this.startCron();
  }

  startCron() {
    // Run an initial check on startup
    void this.checkExpiredListings();
    this.timer = setInterval(() => {
      void this.checkExpiredListings();
    }, EXPIRY_CHECK_INTERVAL_MS);
  }

  stopCron() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async checkExpiredListings() {
    try {
      const result = await this.ticketsService.cancelExpiredListings();
      if (result.cancelledCount > 0) {
        this.logger.log(
          `Cancelled ${result.cancelledCount} expired resale listing(s).`,
        );
      }
    } catch (err) {
      this.logger.error('Failed to cancel expired resale listings', err);
    }
  }
}
