import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { WEBHOOK_QUEUE } from './webhook-queue';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: {
    webhookEndpoint: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
  };
  let organizationsService: { assertMember: jest.Mock };
  let webhookQueue: { enqueue: jest.Mock };

  beforeEach(async () => {
    prisma = {
      webhookEndpoint: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };

    organizationsService = {
      assertMember: jest.fn().mockResolvedValue(undefined),
    };

    webhookQueue = {
      enqueue: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrganizationsService, useValue: organizationsService },
        { provide: WEBHOOK_QUEUE, useValue: webhookQueue },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  it('registers a webhook endpoint', async () => {
    const mockEndpoint = {
      id: 'wh-1',
      organizationId: 'org-1',
      url: 'https://example.com/webhook',
      secret: 'custom-secret',
      events: 'ticket.issued',
    };
    prisma.webhookEndpoint.create.mockResolvedValue(mockEndpoint);

    const result = await service.registerEndpoint('org-1', 'user-1', {
      url: 'https://example.com/webhook',
      secret: 'custom-secret',
      events: 'ticket.issued',
    });

    expect(organizationsService.assertMember).toHaveBeenCalledWith(
      'org-1',
      'user-1',
    );
    expect(prisma.webhookEndpoint.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        url: 'https://example.com/webhook',
        secret: 'custom-secret',
        events: 'ticket.issued',
      },
    });
    expect(result).toEqual(mockEndpoint);
  });

  it('lists webhook endpoints for an organization', async () => {
    const mockEndpoints = [{ id: 'wh-1', url: 'https://example.com/webhook' }];
    prisma.webhookEndpoint.findMany.mockResolvedValue(mockEndpoints);

    const result = await service.listEndpoints('org-1', 'user-1');

    expect(organizationsService.assertMember).toHaveBeenCalledWith(
      'org-1',
      'user-1',
    );
    expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual(mockEndpoints);
  });

  it('deletes a webhook endpoint', async () => {
    prisma.webhookEndpoint.findFirst.mockResolvedValue({ id: 'wh-1' });
    prisma.webhookEndpoint.delete.mockResolvedValue({ id: 'wh-1' });

    const result = await service.deleteEndpoint('org-1', 'wh-1', 'user-1');

    expect(organizationsService.assertMember).toHaveBeenCalledWith(
      'org-1',
      'user-1',
    );
    expect(prisma.webhookEndpoint.delete).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
    });
    expect(result).toEqual({ id: 'wh-1' });
  });

  it('throws NotFoundException when deleting non-existent endpoint', async () => {
    prisma.webhookEndpoint.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteEndpoint('org-1', 'wh-99', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('notifies organization webhooks matching event filter', async () => {
    prisma.webhookEndpoint.findMany.mockResolvedValue([
      {
        id: 'wh-1',
        url: 'https://example.com/hook1',
        secret: 'sec-1',
        events: 'ticket.issued,ticket.transferred',
        isActive: true,
      },
      {
        id: 'wh-2',
        url: 'https://example.com/hook2',
        secret: 'sec-2',
        events: 'event.created',
        isActive: true,
      },
    ]);

    const enqueued = await service.notifyOrganization(
      'org-1',
      'ticket.issued',
      {
        ticketId: 't-1',
      },
    );

    expect(enqueued).toBe(1);
    expect(webhookQueue.enqueue).toHaveBeenCalledWith({
      url: 'https://example.com/hook1',
      event: 'ticket.issued',
      payload: { ticketId: 't-1' },
      secret: 'sec-1',
    });
  });
});
