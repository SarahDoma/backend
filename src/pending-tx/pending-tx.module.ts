import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PendingTxService } from './pending-tx.service';
import { PendingTxCleanupService } from './pending-tx-cleanup.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [PendingTxService, PendingTxCleanupService],
  exports: [PendingTxService],
})
export class PendingTxModule {}
