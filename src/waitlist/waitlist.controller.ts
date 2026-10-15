import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { WaitlistService } from './waitlist.service';
import { OfferNextDto } from './dto/offer-next.dto';

@Controller('ticket-types/:ticketTypeId/waitlist')
@UseGuards(JwtAuthGuard)
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  join(
    @CurrentUser() user: CurrentUserPayload,
    @Param('ticketTypeId') ticketTypeId: string,
  ) {
    return this.waitlist.join(user.userId, ticketTypeId);
  }

  @Delete()
  leave(
    @CurrentUser() user: CurrentUserPayload,
    @Param('ticketTypeId') ticketTypeId: string,
  ) {
    return this.waitlist.leave(user.userId, ticketTypeId);
  }

  @Get('me')
  myEntry(
    @CurrentUser() user: CurrentUserPayload,
    @Param('ticketTypeId') ticketTypeId: string,
  ) {
    return this.waitlist.myEntry(user.userId, ticketTypeId);
  }

  @Get()
  listForOrganizer(
    @CurrentUser() user: CurrentUserPayload,
    @Param('ticketTypeId') ticketTypeId: string,
  ) {
    return this.waitlist.listForOrganizer(user.userId, ticketTypeId);
  }

  @Post('offer-next')
  offerNext(
    @CurrentUser() user: CurrentUserPayload,
    @Param('ticketTypeId') ticketTypeId: string,
    @Body() dto: OfferNextDto,
  ) {
    return this.waitlist.offerNext(
      user.userId,
      ticketTypeId,
      dto.count,
      dto.windowMs,
    );
  }
}
