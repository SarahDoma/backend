import { BadRequestException, ConflictException } from '@nestjs/common';

// See tickets.service.spec.ts for why StellarService is mocked at the
// module level rather than imported for real.
jest.mock('../stellar/stellar.service', () => ({ StellarService: jest.fn() }));

import { EventsService } from './events.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { StellarService } from '../stellar/stellar.service';
import { createEvent, createOrganization } from '../../test/factories';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    $transaction: jest.Mock;
    event: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    ticket: { count: jest.Mock };
    ticketType: { count: jest.Mock; createMany: jest.Mock };
  };
  let organizations: { assertMember: jest.Mock; findOne: jest.Mock };
  let stellar: {
    buildCreateEventTx: jest.Mock;
    submitSignedTransaction: jest.Mock;
    getEvent: jest.Mock;
  };
  let cache: { delete: jest.Mock };

  beforeEach(() => {
    prisma = {
      // events.service.ts uses both the array form (`findPublished`) and the
      // interactive-callback form (`create`) of `$transaction`.
      $transaction: jest.fn((arg: unknown) =>
        Array.isArray(arg)
          ? Promise.all(arg)
          : (arg as (tx: unknown) => unknown)(prisma),
      ),
      event: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      ticket: { count: jest.fn() },
      ticketType: {
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn(),
      },
    };
    organizations = {
      assertMember: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({
        id: 'org-1',
        defaultMaxResaleMultiplierBps: 11_000,
        defaultRoyaltyBps: 500,
      }),
    };
    stellar = {
      buildCreateEventTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      submitSignedTransaction: jest
        .fn()
        .mockResolvedValue({ result: null, txHash: '0xabc' }),
      getEvent: jest.fn().mockResolvedValue({
        eventId: 99n,
        organizer: 'GORG',
        name: 'Radiohead Live',
        category: 'CONCERTS',
        maxResaleMultiplierBps: 11_000,
        royaltyBps: 500,
        ticketsIssued: 0n,
      }),
    };
    cache = { delete: jest.fn().mockResolvedValue(undefined) };

    service = new EventsService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
      stellar as unknown as StellarService,
      undefined,
      cache,
    );
  });

  describe('create', () => {
    it('falls back to the organization defaults when the DTO omits resale terms', async () => {
      prisma.event.create.mockResolvedValue({ id: 'event-1' });
      prisma.event.findUniqueOrThrow.mockResolvedValue({
        id: 'event-1',
        ticketTypes: [],
      });

      await service.create('organizer-1', 'org-1', {
        name: 'Radiohead Live',
        category: 'CONCERTS',
        venue: 'O2 Arena',
        startsAt: new Date(),
      } as never);

      expect(prisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            maxResaleMultiplierBps: 11_000,
            royaltyBps: 500,
          }),
        }),
      );
      expect(prisma.ticketType.createMany).not.toHaveBeenCalled();
    });

    it('prefers resale terms given on the DTO over the organization defaults', async () => {
      organizations.findOne.mockResolvedValue({
        id: 'org-1',
        defaultMaxResaleMultiplierBps: 15_000,
        defaultRoyaltyBps: 1_000,
      });
      prisma.event.create.mockResolvedValue({ id: 'event-1' });
      prisma.event.findUniqueOrThrow.mockResolvedValue({
        id: 'event-1',
        ticketTypes: [],
      });

      await service.create('organizer-1', 'org-1', {
        name: 'Radiohead Live',
        category: 'CONCERTS',
        venue: 'O2 Arena',
        startsAt: new Date(),
        maxResaleMultiplierBps: 12_000,
        royaltyBps: 500,
      } as never);

      expect(prisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            maxResaleMultiplierBps: 12_000,
            royaltyBps: 500,
          }),
        }),
      );
    });

    it('creates the first ticket type in the same transaction as the event', async () => {
      prisma.event.create.mockResolvedValue({ id: 'event-1' });
      prisma.event.findUniqueOrThrow.mockResolvedValue({
        id: 'event-1',
        ticketTypes: [{ id: 'tt-1', name: 'General' }],
      });

      await service.create('organizer-1', 'org-1', {
        name: 'Radiohead Live',
        category: 'CONCERTS',
        venue: 'O2 Arena',
        startsAt: new Date(),
        ticketTypes: [
          { name: 'General', price: '1000', quantityTotal: 100 },
        ],
      } as never);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.ticketType.createMany).toHaveBeenCalledWith({
        data: [
          {
            eventId: 'event-1',
            name: 'General',
            price: 1000n,
            quantityTotal: 100,
          },
        ],
      });
    });

    it('rolls back the event when the ticket type fails to create', async () => {
      prisma.event.create.mockResolvedValue({ id: 'event-1' });
      prisma.ticketType.createMany.mockRejectedValue(
        new Error('duplicate ticket type name'),
      );

      await expect(
        service.create('organizer-1', 'org-1', {
          name: 'Radiohead Live',
          category: 'CONCERTS',
          venue: 'O2 Arena',
          startsAt: new Date(),
          ticketTypes: [
            { name: 'General', price: '1000', quantityTotal: 100 },
          ],
        } as never),
      ).rejects.toThrow('duplicate ticket type name');
    });
  });

  describe('buildPublishTx', () => {
    it('refuses to publish an already-published event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          status: 'PUBLISHED',
          chainEventId: null,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });

      await expect(
        service.buildPublishTx('organizer-1', 'event-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stellar.buildCreateEventTx).not.toHaveBeenCalled();
    });

    it('refuses to re-publish an event that already reserved an on-chain id', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          status: 'DRAFT',
          chainEventId: 99n,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });

      await expect(
        service.buildPublishTx('organizer-1', 'event-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns conflict when the event has no ticket types to sell', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          status: 'DRAFT',
          chainEventId: null,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.ticketType.count.mockResolvedValue(0);

      const attempt = service.buildPublishTx('organizer-1', 'event-1');

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({ status: 409 });
      expect(prisma.ticketType.count).toHaveBeenCalledWith({
        where: { eventId: 'event-1' },
      });
      expect(prisma.event.update).not.toHaveBeenCalled();
      expect(stellar.buildCreateEventTx).not.toHaveBeenCalled();
    });

    it('reserves a chain event id and builds create_event against the org account', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          status: 'DRAFT',
          chainEventId: null,
          name: 'Radiohead Live',
          category: 'CONCERTS',
          maxResaleMultiplierBps: 12_000,
          royaltyBps: 500,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.event.update.mockResolvedValue({});

      const { unsignedXdr } = await service.buildPublishTx(
        'organizer-1',
        'event-1',
      );

      expect(unsignedXdr).toBe('unsigned-xdr');
      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'organizer-1',
      );
      expect(stellar.buildCreateEventTx).toHaveBeenCalledWith(
        expect.objectContaining({
          organizerPublicKey: 'GORG',
          name: 'Radiohead Live',
          category: 'CONCERTS',
          maxResaleMultiplierBps: 12_000,
          royaltyBps: 500,
        }),
      );
    });
  });

  describe('confirmPublish', () => {
    it('requires publish to have been called first', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          chainEventId: null,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });

      await expect(
        service.confirmPublish('organizer-1', 'event-1', 'signed-xdr'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a confirmed transaction whose on-chain event does not match', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          chainEventId: 99n,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      stellar.getEvent.mockResolvedValue({
        eventId: 100n,
        organizer: 'GOTHER',
      });

      await expect(
        service.confirmPublish('organizer-1', 'event-1', 'signed-xdr'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.event.update).not.toHaveBeenCalled();
    });

    it('submits the signed transaction, confirms it on-chain, and marks the event published', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          chainEventId: 99n,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.event.update.mockResolvedValue(
        createEvent({ id: 'event-1', status: 'PUBLISHED' }),
      );

      const event = await service.confirmPublish(
        'organizer-1',
        'event-1',
        'signed-xdr',
      );

      expect(stellar.submitSignedTransaction).toHaveBeenCalledWith(
        'signed-xdr',
      );
      expect(stellar.getEvent).toHaveBeenCalledWith(99n);
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { status: 'PUBLISHED', publishedTxHash: '0xabc' },
      });
      expect(event.status).toBe('PUBLISHED');
    });

    it('fails the request when the on-chain event cannot be confirmed after submission', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        chainEventId: 99n,
        organization: { stellarAccount: 'GORG' },
      });
      stellar.getEvent.mockRejectedValue(new Error('not found'));

      await expect(
        service.confirmPublish('organizer-1', 'event-1', 'signed-xdr'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.event.update).not.toHaveBeenCalled();
    });
  });

  describe('getWithReconciliation', () => {
    it('skips the chain lookup when reconciliation is not requested', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        status: 'PUBLISHED',
        chainEventId: 99n,
        organization: { stellarAccount: 'GORG' },
      });

      const event = await service.getWithReconciliation('event-1', false);

      expect(stellar.getEvent).not.toHaveBeenCalled();
      expect(event).not.toHaveProperty('onChainStatus');
    });

    it('reports PUBLISHED when the chain agrees with the cached status', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        status: 'PUBLISHED',
        chainEventId: 99n,
        organization: { stellarAccount: 'GORG' },
      });

      const event = await service.getWithReconciliation('event-1', true);

      expect(stellar.getEvent).toHaveBeenCalledWith(99n);
      expect(event.onChainStatus).toBe('PUBLISHED');
    });

    it('reports NOT_FOUND when the DB says published but the chain lookup fails', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        status: 'PUBLISHED',
        chainEventId: 99n,
        organization: { stellarAccount: 'GORG' },
      });
      stellar.getEvent.mockRejectedValue(new Error('not found'));

      const event = await service.getWithReconciliation('event-1', true);

      expect(event.onChainStatus).toBe('NOT_FOUND');
    });

    it('reports NOT_PUBLISHED without a chain lookup when no chain id was reserved', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        status: 'DRAFT',
        chainEventId: null,
        organization: { stellarAccount: 'GORG' },
      });

      const event = await service.getWithReconciliation('event-1', true);

      expect(stellar.getEvent).not.toHaveBeenCalled();
      expect(event.onChainStatus).toBe('NOT_PUBLISHED');
    });
  });

  describe('findPublished', () => {
    const publishedWhere = {
      status: 'PUBLISHED',
      deletedAt: null,
      organization: { deletedAt: null },
    };

    it('returns one page of published events and the total count', async () => {
      prisma.event.findMany.mockResolvedValue([{ id: 'event-21' }]);
      prisma.event.count.mockResolvedValue(21);

      const result = await service.findPublished({ page: 2, limit: 20 });

      expect(result).toEqual([[{ id: 'event-21' }], 21]);
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: publishedWhere,
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          skip: 20,
          take: 20,
        }),
      );
      expect(prisma.event.count).toHaveBeenCalledWith({
        where: publishedWhere,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('still hides hidden ticket types', async () => {
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.count.mockResolvedValue(0);

      await service.findPublished({ page: 1, limit: 20 });

      const [args] = prisma.event.findMany.mock.calls[0] as [
        { include: { ticketTypes: unknown } },
      ];
      expect(args.include.ticketTypes).toEqual({ where: { isHidden: false } });
    });
  });

  describe('unpublish', () => {
    it('reverts a published event to draft when no tickets exist', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          status: 'PUBLISHED',
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.ticket.count.mockResolvedValue(0);
      prisma.event.update.mockResolvedValue(
        createEvent({ id: 'event-1', status: 'DRAFT' }),
      );

      const event = await service.unpublish('organizer-1', 'event-1');

      expect(prisma.ticket.count).toHaveBeenCalledWith({
        where: { eventId: 'event-1' },
      });
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { status: 'DRAFT' },
      });
      expect(event.status).toBe('DRAFT');
    });

    it('returns conflict when tickets have already been issued', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        status: 'PUBLISHED',
        organization: { stellarAccount: 'GORG' },
      });
      prisma.ticket.count.mockResolvedValue(1);

      await expect(
        service.unpublish('organizer-1', 'event-1'),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.event.update).not.toHaveBeenCalled();
    });
  });

  describe('findForOrganization', () => {
    it('requires membership before listing an organization’s events', async () => {
      organizations.assertMember.mockRejectedValue(new Error('not a member'));

      await expect(
        service.findForOrganization('outsider-1', 'org-1'),
      ).rejects.toThrow('not a member');
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });

    it('returns the organization’s events, drafts included, as a page', async () => {
      prisma.event.findMany.mockResolvedValue([
        { id: 'event-1', status: 'DRAFT' },
      ]);
      prisma.event.count.mockResolvedValue(1);

      const page = await service.findForOrganization('organizer-1', 'org-1');

      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'organizer-1',
      );
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', deletedAt: null },
          skip: 0,
          take: 20,
        }),
      );
      expect(page).toEqual({
        items: [{ id: 'event-1', status: 'DRAFT' }],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('narrows the listing to a single status when one is given', async () => {
      prisma.event.findMany.mockResolvedValue([]);

      await service.findForOrganization('organizer-1', 'org-1', {
        status: 'PUBLISHED',
      });

      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            deletedAt: null,
            status: 'PUBLISHED',
          },
        }),
      );
    });

    it('skips the preceding pages and caps the page at the requested limit', async () => {
      prisma.event.findMany.mockResolvedValue([]);

      const page = await service.findForOrganization('organizer-1', 'org-1', {
        page: 3,
        limit: 10,
      });

      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(page).toMatchObject({ page: 3, limit: 10 });
    });

    it('reports the total across all pages, counted with the same filter', async () => {
      prisma.event.findMany.mockResolvedValue([{ id: 'event-1' }]);
      prisma.event.count.mockResolvedValue(45);

      const page = await service.findForOrganization('organizer-1', 'org-1', {
        status: 'DRAFT',
        limit: 1,
      });

      expect(prisma.event.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', deletedAt: null, status: 'DRAFT' },
      });
      expect(page.total).toBe(45);
      expect(page.items).toHaveLength(1);
    });

    it('orders by createdAt then id so pages stay stable when timestamps tie', async () => {
      prisma.event.findMany.mockResolvedValue([]);

      await service.findForOrganization('organizer-1', 'org-1');

      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('excludes soft-deleted events from organization listings (#207)', async () => {
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.count.mockResolvedValue(0);

      await service.findForOrganization('organizer-1', 'org-1');

      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }) as never,
        }),
      );
      expect(prisma.event.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }) as never,
        }),
      );
    });
  });

  describe('soft-delete (#207)', () => {
    it('treats a soft-deleted event as not found', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({ id: 'event-1', organizationId: 'org-1' }),
        deletedAt: new Date('2026-09-26T00:00:00.000Z'),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });

      await expect(service.getWithOrg('event-1')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('soft-deletes by setting deletedAt instead of hard-deleting', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({ id: 'event-1', organizationId: 'org-1' }),
        deletedAt: null,
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.event.update.mockResolvedValue({ id: 'event-1' });

      await service.softDelete('organizer-1', 'event-1');

      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { deletedAt: expect.any(Date) as never },
      });
    });

    it('restores a soft-deleted event by clearing deletedAt', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({ id: 'event-1', organizationId: 'org-1' }),
        deletedAt: new Date('2026-09-26T00:00:00.000Z'),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.event.update.mockResolvedValue({ id: 'event-1' });

      await service.restore('organizer-1', 'event-1');

      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { deletedAt: null },
      });
    });
  });

  describe('cache invalidation', () => {
    it('invalidates cache on create', async () => {
      prisma.event.create.mockResolvedValue({ id: 'event-1' });
      await service.create('user-1', 'org-1', {
        name: 'Test',
        category: 'CONCERTS',
        startsAt: new Date(),
      } as never);
      expect(cache.delete).toHaveBeenCalledWith('cache:/v1/events');
    });

    it('invalidates cache on confirmPublish', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({
          id: 'event-1',
          organizationId: 'org-1',
          chainEventId: 99n,
        }),
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.event.update.mockResolvedValue({ id: 'event-1' });
      await service.confirmPublish('organizer-1', 'event-1', 'signed-xdr');
      expect(cache.delete).toHaveBeenCalledWith('cache:/v1/events');
    });

    it('invalidates cache on softDelete', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...createEvent({ id: 'event-1', organizationId: 'org-1' }),
        deletedAt: null,
        organization: createOrganization({ stellarAccount: 'GORG' }),
      });
      prisma.event.update.mockResolvedValue({ id: 'event-1' });
      await service.softDelete('organizer-1', 'event-1');
      expect(cache.delete).toHaveBeenCalledWith('cache:/v1/events');
    });
  });
});
