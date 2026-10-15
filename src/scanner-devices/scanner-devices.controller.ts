import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ScannerDevicesService } from './scanner-devices.service';
import { RegisterScannerDeviceDto } from './dto/register-scanner-device.dto';

@Controller('events/:eventId/scanner-devices')
@UseGuards(JwtAuthGuard)
export class ScannerDevicesController {
  constructor(private readonly scannerDevices: ScannerDevicesService) {}

  @Post()
  register(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Body() dto: RegisterScannerDeviceDto,
  ) {
    return this.scannerDevices.register(user.userId, eventId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
  ) {
    return this.scannerDevices.listForEvent(user.userId, eventId);
  }

  @Patch(':deviceId/revoke')
  revoke(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.scannerDevices.revoke(user.userId, eventId, deviceId);
  }
}
