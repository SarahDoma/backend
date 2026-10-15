import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { WEBHOOK_QUEUE, assertWebhookUrl } from './webhook-queue';
import type { WebhookQueue } from './webhook-queue';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationsService: OrganizationsService,
    @Inject(WEBHOOK_QUEUE) private readonly webhookQueue: WebhookQueue,
  ) {}

  async registerEndpoint(
    organizationId: string,
    userId: string,
    dto: CreateWebhookEndpointDto,
  ) {
    await this.organizationsService.assertMember(organizationId, userId);
    assertWebhookUrl(dto.url);

    const secret = dto.secret || crypto.randomBytes(32).toString('hex');
    const events = dto.events?.trim() || '*';

    return this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: dto.url,
        secret,
        events,
      },
    });
  }

  async listEndpoints(organizationId: string, userId: string) {
    await this.organizationsService.assertMember(organizationId, userId);
    return this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteEndpoint(
    organizationId: string,
    webhookId: string,
    userId: string,
  ) {
    await this.organizationsService.assertMember(organizationId, userId);

    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, organizationId },
    });

    if (!endpoint) {
      throw new NotFoundException('Webhook endpoint not found');
    }

    return this.prisma.webhookEndpoint.delete({
      where: { id: webhookId },
    });
  }

  async notifyOrganization(
    organizationId: string,
    event: string,
    payload: unknown,
  ): Promise<number> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        organizationId,
        isActive: true,
      },
    });

    let enqueuedCount = 0;
    for (const endpoint of endpoints) {
      const subscribedEvents = endpoint.events.split(',').map((e) => e.trim());
      const isSubscribed =
        endpoint.events === '*' ||
        subscribedEvents.includes('*') ||
        subscribedEvents.includes(event);

      if (isSubscribed) {
        await this.webhookQueue.enqueue({
          url: endpoint.url,
          event,
          payload,
          secret: endpoint.secret,
        });
        enqueuedCount++;
      }
    }

    return enqueuedCount;
  }
}
