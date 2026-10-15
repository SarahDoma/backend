import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { ConfirmPublishDto } from './dto/confirm-publish.dto';

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('events')
  findPublished() {
    return this.eventsService.findPublished();
  }

  @Get('events/:eventId')
  findOne(
    @Param('eventId') eventId: string,
    @Query('reconcile') reconcile?: string,
  ) {
    return this.eventsService.getWithReconciliation(
      eventId,
      reconcile === 'true',
    );
  }

  @Get('organizations/:organizationId/events')
  @UseGuards(JwtAuthGuard)
  findForOrganization(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
  ) {
    return this.eventsService.findForOrganization(user.userId, organizationId);
  }

  @Post('organizations/:organizationId/events')
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.create(user.userId, organizationId, dto);
  }

  @Post('events/:eventId/ticket-types')
  @UseGuards(JwtAuthGuard)
  addTicketType(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Body() dto: CreateTicketTypeDto,
  ) {
    return this.eventsService.addTicketType(user.userId, eventId, dto);
  }

  @Post('events/:eventId/publish')
  @UseGuards(JwtAuthGuard)
  buildPublishTx(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.buildPublishTx(user.userId, eventId);
  }

  @Post('events/:eventId/confirm-publish')
  @UseGuards(JwtAuthGuard)
  confirmPublish(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Body() dto: ConfirmPublishDto,
  ) {
    return this.eventsService.confirmPublish(
      user.userId,
      eventId,
      dto.signedXdr,
    );
  }
}
