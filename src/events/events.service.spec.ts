import { BadRequestException } from '@nestjs/common';

// See tickets.service.spec.ts for why StellarService is mocked at the
// module level rather than imported for real.
jest.mock('../stellar/stellar.service', () => ({ StellarService: jest.fn() }));

import { EventsService } from './events.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { StellarService } from '../stellar/stellar.service';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    event: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    ticketType: { createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let organizations: { assertMember: jest.Mock; findOne: jest.Mock };
  let stellar: {
    buildCreateEventTx: jest.Mock;
    submitSignedTransaction: jest.Mock;
    getEvent: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      event: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
      },
      ticketType: { createMany: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
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
        organizer: 'GORG',
        name: 'Radiohead Live',
        category: 'CONCERTS',
        maxResaleMultiplierBps: 11_000,
        royaltyBps: 500,
        ticketsIssued: 0n,
      }),
    };

    service = new EventsService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
      stellar as unknown as StellarService,
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
        id: 'event-1',
        organizationId: 'org-1',
        status: 'PUBLISHED',
        chainEventId: null,
        organization: { stellarAccount: 'GORG' },
      });

      await expect(
        service.buildPublishTx('organizer-1', 'event-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stellar.buildCreateEventTx).not.toHaveBeenCalled();
    });

    it('refuses to re-publish an event that already reserved an on-chain id', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        status: 'DRAFT',
        chainEventId: 99n,
        organization: { stellarAccount: 'GORG' },
      });

      await expect(
        service.buildPublishTx('organizer-1', 'event-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reserves a chain event id and builds create_event against the org account', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        status: 'DRAFT',
        chainEventId: null,
        name: 'Radiohead Live',
        category: 'CONCERTS',
        maxResaleMultiplierBps: 12_000,
        royaltyBps: 500,
        organization: { stellarAccount: 'GORG' },
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
        id: 'event-1',
        organizationId: 'org-1',
        chainEventId: null,
        organization: { stellarAccount: 'GORG' },
      });

      await expect(
        service.confirmPublish('organizer-1', 'event-1', 'signed-xdr'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('submits the signed transaction, confirms it on-chain, and marks the event published', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        chainEventId: 99n,
        organization: { stellarAccount: 'GORG' },
      });
      prisma.event.update.mockResolvedValue({
        id: 'event-1',
        status: 'PUBLISHED',
      });

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
        data: { status: 'PUBLISHED' },
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

  describe('findForOrganization', () => {
    it('requires membership before listing an organization’s events', async () => {
      organizations.assertMember.mockRejectedValue(new Error('not a member'));

      await expect(
        service.findForOrganization('outsider-1', 'org-1'),
      ).rejects.toThrow('not a member');
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });

    it('returns every event for the organization, drafts included', async () => {
      prisma.event.findMany.mockResolvedValue([
        { id: 'event-1', status: 'DRAFT' },
      ]);

      const events = await service.findForOrganization('organizer-1', 'org-1');

      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'organizer-1',
      );
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
      expect(events).toEqual([{ id: 'event-1', status: 'DRAFT' }]);
    });
  });
});
