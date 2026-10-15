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
import { PromoCodesService } from './promo-codes.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { PreviewPromoCodeDto } from './dto/preview-promo-code.dto';

@Controller('events/:eventId/promo-codes')
@UseGuards(JwtAuthGuard)
export class PromoCodesController {
  constructor(private readonly promoCodes: PromoCodesService) {}

  @Post()
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Body() dto: CreatePromoCodeDto,
  ) {
    return this.promoCodes.create(user.userId, eventId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
  ) {
    return this.promoCodes.listForEvent(user.userId, eventId);
  }

  @Post('preview')
  preview(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Body() dto: PreviewPromoCodeDto,
  ) {
    return this.promoCodes.previewForTicketType(
      eventId,
      user.userId,
      dto.ticketTypeId,
      dto.code,
    );
  }

  @Delete(':promoCodeId')
  revoke(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Param('promoCodeId') promoCodeId: string,
  ) {
    return this.promoCodes.revoke(user.userId, eventId, promoCodeId);
  }
}
