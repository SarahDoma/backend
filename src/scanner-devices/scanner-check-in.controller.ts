import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ScannerDeviceGuard } from './guards/scanner-device.guard';
import { TicketsService } from '../tickets/tickets.service';
import { ConfirmCheckInDto } from '../tickets/dto/confirm-check-in.dto';

/** Device-token authenticated check-in path -- no staff JWT needed. */
@Controller('tickets')
@UseGuards(ScannerDeviceGuard)
export class ScannerCheckInController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post(':ticketId/scanner-check-in')
  confirmCheckIn(
    @Param('ticketId') ticketId: string,
    @Body() dto: ConfirmCheckInDto,
  ) {
    return this.ticketsService.confirmCheckInByDevice(
      ticketId,
      dto.signedXdr,
      dto.gateId,
    );
  }
}
