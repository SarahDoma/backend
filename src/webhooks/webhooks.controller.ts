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
import { WebhooksService } from './webhooks.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';

@Controller('organizations/:organizationId/webhooks')
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  registerEndpoint(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateWebhookEndpointDto,
  ) {
    return this.webhooksService.registerEndpoint(
      organizationId,
      user.userId,
      dto,
    );
  }

  @Get()
  listEndpoints(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.webhooksService.listEndpoints(organizationId, user.userId);
  }

  @Delete(':webhookId')
  deleteEndpoint(
    @Param('organizationId') organizationId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.webhooksService.deleteEndpoint(
      organizationId,
      webhookId,
      user.userId,
    );
  }
}
