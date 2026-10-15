import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { ConfirmPublishDto } from './dto/confirm-publish.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponseInterceptor } from '../common/interceptors/paginated-response.interceptor';
import { ListOrganizationEventsQueryDto } from './dto/list-organization-events-query.dto';
import { ResponseCacheInterceptor } from '../common/interceptors/response-cache.interceptor';

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('events')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  // The cache wraps the paginator so it stores the finished page body.
  @UseInterceptors(ResponseCacheInterceptor, PaginatedResponseInterceptor)
  findPublished(@Query() query: PaginationQueryDto) {
    return this.eventsService.findPublished(query);
  }

  @Get('events/:eventId')
  @UseInterceptors(ResponseCacheInterceptor)
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
    @Query() query: ListOrganizationEventsQueryDto,
  ) {
    return this.eventsService.findForOrganization(
      user.userId,
      organizationId,
      query,
    );
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

  @Post('events/:eventId/unpublish')
  @UseGuards(JwtAuthGuard)
  unpublish(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.unpublish(user.userId, eventId);
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

  @Delete('events/:eventId')
  @UseGuards(JwtAuthGuard)
  softDelete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.softDelete(user.userId, eventId);
  }

  @Post('events/:eventId/restore')
  @UseGuards(JwtAuthGuard)
  restore(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.restore(user.userId, eventId);
  }
}
