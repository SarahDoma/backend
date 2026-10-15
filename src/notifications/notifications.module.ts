import { Module } from '@nestjs/common';
import { LogEmailProvider, NotificationService } from './notifications.service';

@Module({
  providers: [
    NotificationService,
    { provide: LogEmailProvider, useClass: LogEmailProvider },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
