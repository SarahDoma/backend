import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

export const HEARTBEAT_JOB_NAME = 'scheduler-heartbeat';

/**
 * Sample cron job, and a liveness signal for the scheduler itself: if this line
 * stops appearing hourly, no cron job is running. Copy it as the template for
 * real jobs and register them in `SchedulerModule`.
 */
@Injectable()
export class HeartbeatJob {
  private readonly logger = new Logger(HeartbeatJob.name);

  @Cron(CronExpression.EVERY_HOUR, { name: HEARTBEAT_JOB_NAME })
  run(): void {
    this.logger.log('Scheduler heartbeat');
  }
}
