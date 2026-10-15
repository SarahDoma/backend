import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ScannerDevicesController } from './scanner-devices.controller';
import { ScannerCheckInController } from './scanner-check-in.controller';
import { ScannerDevicesService } from './scanner-devices.service';
import { ScannerDeviceGuard } from './guards/scanner-device.guard';

@Module({
  imports: [OrganizationsModule, TicketsModule],
  controllers: [ScannerDevicesController, ScannerCheckInController],
  providers: [ScannerDevicesService, ScannerDeviceGuard],
  exports: [ScannerDevicesService, ScannerDeviceGuard],
})
export class ScannerDevicesModule {}
