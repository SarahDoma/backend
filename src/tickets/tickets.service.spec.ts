import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// TicketsService only needs StellarService's shape here (it's fully mocked
// below); avoid touching the real @stellar/stellar-sdk import chain, which
// ships ESM-only transitive deps (@noble/hashes, uint8array-extras) that
// Jest can't parse without a much heavier transform config.
jest.mock('../stellar/stellar.service', () => ({ StellarService: jest.fn() }));

import {
  ListingInactiveError,
  TicketTypeSoldOutError,
} from '../common/errors/domain.error';
import { Prisma } from '@prisma/client';
import { TicketsService } from './tickets.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { StellarService } from '../stellar/stellar.service';
import type { OfflineTokenService } from './offline-token.service';
import type { ConfigService } from '@nestjs/config';
import {
  createEvent,
  createOrganization,
  createTicket,
  createTicketType,
  createUser,
} from '../../test/factories';

function buildTicketType(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...createTicketType({
      id: 'tt-1',
      name: 'GA',
      price: 1_000n,
      quantityIssued: 0,
      quantityTotal: 100,
    }),
    event: {
      ...createEvent({
        id: 'event-1',
        organizationId: 'org-1',
        chainEventId: 42n,
      }),
      organization: createOrganization({ stellarAccount: 'GORGANIZER' }),
    },
    ...overrides,
  };
}

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: {
    $queryRaw: jest.Mock;
    ticketType: { findUnique: jest.Mock; update: jest.Mock };
    ticket: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    event: { findUnique: jest.Mock };
    resaleListing: {
      create: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    resalePriceHistory: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let organizations: { assertMember: jest.Mock };
  let stellar: Record<string, jest.Mock>;
  let offlineTokens: { sign: jest.Mock; getPublicKeys: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ quantityIssued: 0, quantityTotal: 100 }]),
      ticketType: { findUnique: jest.fn(), update: jest.fn() },
      ticket: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      event: { findUnique: jest.fn() },
      resaleListing: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      resalePriceHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        Array.isArray(cb) ? Promise.all(cb) : cb(prisma),
      ),
    };
    organizations = { assertMember: jest.fn().mockResolvedValue(undefined) };
    stellar = {
      buildIssueTicketTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildPurchasePrimaryTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildTransferTicketTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildCheckInTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildRevokeTicketTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildListForResaleTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildCancelResaleTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildBuyResaleTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      submitSignedTransaction: jest
        .fn()
        .mockResolvedValue({ result: 7n, txHash: '0xabc' }),
      verifyTicket: jest.fn(),
    };
    offlineTokens = {
      sign: jest.fn().mockReturnValue({
        payload: {
          ticketId: 'ticket-1',
          chainTicketId: '7',
          eventId: 'event-1',
          status: 'VALID',
          exp: 9_999_999_999,
        },
        kid: 'test-key',
        signature: 'sig',
      }),
      getPublicKeys: jest.fn().mockReturnValue({ 'test-key': 'pem' }),
    };
    config = { get: jest.fn().mockReturnValue(5) };

    service = new TicketsService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
      stellar as unknown as StellarService,
      undefined,
      offlineTokens as unknown as OfflineTokenService,
      config as unknown as ConfigService,
    );
  });

  describe('buildIssueTx', () => {
    it('rejects once a ticket type is sold out', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(
        buildTicketType({ quantityIssued: 100, quantityTotal: 100 }),
      );

      await expect(
        service.buildIssueTx('organizer-1', 'tt-1', 'buyer-1', 'GBUYER'),
      ).rejects.toBeInstanceOf(TicketTypeSoldOutError);
      expect(stellar.buildIssueTicketTx).not.toHaveBeenCalled();
    });

    it('rejects issuing against an unpublished event', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(
        buildTicketType({
          event: { ...buildTicketType().event, chainEventId: null },
        }),
      );

      await expect(
        service.buildIssueTx('organizer-1', 'tt-1', 'buyer-1', 'GBUYER'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires the recipient to have a connected wallet', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.user.findUnique.mockResolvedValue(
        createUser({ id: 'buyer-1', stellarPublicKey: null }),
      );

      await expect(
        service.buildIssueTx('organizer-1', 'tt-1', 'buyer-1', 'GBUYER'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('builds an issue_ticket transaction against the organizer account', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.user.findUnique.mockResolvedValue(
        createUser({ id: 'buyer-1', stellarPublicKey: 'GBUYER' }),
      );

      const { unsignedXdr } = await service.buildIssueTx(
        'organizer-1',
        'tt-1',
        'buyer-1',
        'GBUYER',
        'A1',
      );

      expect(unsignedXdr).toBe('unsigned-xdr');
      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'organizer-1',
      );
      expect(stellar.buildIssueTicketTx).toHaveBeenCalledWith({
        organizerPublicKey: 'GORGANIZER',
        chainEventId: 42n,
        toPublicKey: 'GBUYER',
        tier: 'GA',
        seat: 'A1',
        price: 1_000n,
      });
    });
  });

  describe('confirmIssue', () => {
    it('creates the ticket row and increments quantityIssued using the on-chain ticket id', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.ticket.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'ticket-1', ...data }),
      );

      prisma.user.findUnique.mockResolvedValue(
        createUser({ id: 'buyer-1', stellarPublicKey: 'GBUYER' }),
      );

      const ticket = await service.confirmIssue(
        'organizer-1',
        'tt-1',
        'buyer-1',
        'GBUYER',
        'A1',
        'signed-xdr',
      );

      expect(stellar.submitSignedTransaction).toHaveBeenCalledWith(
        'signed-xdr',
      );
      expect(prisma.ticketType.update).toHaveBeenCalledWith({
        where: { id: 'tt-1' },
        data: { quantityIssued: { increment: 1 } },
      });
      expect(ticket).toMatchObject({
        chainTicketId: 7n,
        ownerId: 'buyer-1',
        seat: 'A1',
      });
    });

    it('locks the TicketType row and re-checks capacity under the lock (#217)', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.user.findUnique.mockResolvedValue(
        createUser({ id: 'buyer-1', stellarPublicKey: 'GBUYER' }),
      );
      prisma.ticketType.update.mockResolvedValue({});
      prisma.ticket.create.mockResolvedValue(
        createTicket({ id: 'ticket-new', ownerId: 'buyer-1' }),
      );

      await service.confirmIssue(
        'organizer-1',
        'tt-1',
        'buyer-1',
        'GBUYER',
        undefined,
        'signed-xdr',
      );

      // The row lock precedes the increment inside the same transaction.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const [query] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(query.join('')).toContain('FOR UPDATE');
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.ticketType.update.mock.invocationCallOrder[0],
      );
    });

    it('uses the locked row as the capacity authority, not the stale read (#217)', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.user.findUnique.mockResolvedValue(
        createUser({ id: 'buyer-1', stellarPublicKey: 'GBUYER' }),
      );
      // The stale pre-transaction read said capacity was available, but the
      // locked row shows a concurrent transaction already filled the tier.
      prisma.$queryRaw.mockResolvedValueOnce([
        { quantityIssued: 100, quantityTotal: 100 },
      ]);

      await expect(
        service.confirmIssue(
          'organizer-1',
          'tt-1',
          'buyer-1',
          'GBUYER',
          undefined,
          'signed-xdr',
        ),
      ).rejects.toBeInstanceOf(TicketTypeSoldOutError);

      expect(prisma.ticketType.update).not.toHaveBeenCalled();
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate assigned seat for the same event (#211)', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.ticket.findFirst.mockResolvedValueOnce({ id: 'existing-ticket' });
      prisma.user.findUnique.mockResolvedValue(
        createUser({ id: 'buyer-1', stellarPublicKey: 'GBUYER' }),
      );

      await expect(
        service.confirmIssue(
          'organizer-1',
          'tt-1',
          'buyer-1',
          'GBUYER',
          'A1',
          'signed-xdr',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stellar.submitSignedTransaction).not.toHaveBeenCalled();
    });
  });

  describe('transfer', () => {
    it('refuses to build a transfer for a ticket the caller does not own', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...createTicket({
          id: 'ticket-1',
          ownerId: 'someone-else',
          chainTicketId: 7n,
        }),
        event: {
          organizationId: 'org-1',
          organization: createOrganization({ stellarAccount: 'GORG' }),
        },
      });

      await expect(
        service.buildTransferTx(
          'not-the-owner',
          'ticket-1',
          'friend-1',
          'GFRIEND',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('builds a transfer using both parties on-chain public keys', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...createTicket({
          id: 'ticket-1',
          ownerId: 'owner-1',
          chainTicketId: 7n,
        }),
        event: {
          organizationId: 'org-1',
          organization: createOrganization({ stellarAccount: 'GORG' }),
        },
      });
      prisma.user.findUnique
        .mockResolvedValueOnce(
          createUser({ id: 'owner-1', stellarPublicKey: 'GOWNER' }),
        )
        .mockResolvedValueOnce(
          createUser({ id: 'friend-1', stellarPublicKey: 'GFRIEND' }),
        );

      await service.buildTransferTx(
        'owner-1',
        'ticket-1',
        'friend-1',
        'GFRIEND',
      );

      expect(stellar.buildTransferTicketTx).toHaveBeenCalledWith({
        fromPublicKey: 'GOWNER',
        chainTicketId: 7n,
        toPublicKey: 'GFRIEND',
      });
    });
  });

  describe('verify', () => {
    it('reconciles the cached status when it diverges from the chain', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        chainTicketId: 7n,
        status: 'VALID',
        seat: 'A1',
        event: { organizationId: 'org-1', name: 'Radiohead Live' },
        owner: { name: 'Ada Lovelace' },
        ticketType: { name: 'GA' },
      });
      stellar.verifyTicket.mockResolvedValue({
        owner: 'GBUYER',
        status: 'Used',
      });

      const result = await service.verify('staff-1', 'qr-secret-abc');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'USED' },
      });
      expect(result.status).toBe('USED');
      expect(result.eventName).toBe('Radiohead Live');
    });

    it('throws when no ticket matches the scanned secret', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.verify('staff-1', 'unknown-secret'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOfflineToken', () => {
    it('signs a payload built from the ticket for an authorized staff member', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        eventId: 'event-1',
        chainTicketId: 7n,
        status: 'VALID',
        event: { organizationId: 'org-1', organization: {} },
      });

      const token = await service.getOfflineToken('staff-1', 'ticket-1');

      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'staff-1',
      );
      expect(offlineTokens.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 'ticket-1',
          chainTicketId: '7',
          eventId: 'event-1',
          status: 'VALID',
        }),
      );
      expect(token.kid).toBe('test-key');
    });

    it('throws when the ticket does not exist', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.getOfflineToken('staff-1', 'missing-ticket'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(offlineTokens.sign).not.toHaveBeenCalled();
    });

    it('rejects a caller who is not a member of the owning organization', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        eventId: 'event-1',
        chainTicketId: 7n,
        status: 'VALID',
        event: { organizationId: 'org-1', organization: {} },
      });
      organizations.assertMember.mockRejectedValueOnce(
        new ForbiddenException('You are not a member of this organization'),
      );

      await expect(
        service.getOfflineToken('outsider-1', 'ticket-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(offlineTokens.sign).not.toHaveBeenCalled();
    });
  });

  describe('getOfflinePublicKeys', () => {
    it('returns the offline token service public keys', () => {
      expect(service.getOfflinePublicKeys()).toEqual({ 'test-key': 'pem' });
    });
  });

  describe('resale marketplace', () => {
    it('rejects buying a ticket that is not listed for resale', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        status: 'VALID',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
        },
      });

      await expect(
        service.buildBuyResaleTx('buyer-1', 'ticket-1'),
      ).rejects.toBeInstanceOf(ListingInactiveError);
    });

    it('creates an active resale listing on confirm', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'owner-1',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
          maxResaleMultiplierBps: 20_000,
        },
        ticketType: { price: 1_000n },
      });
      prisma.resaleListing.create.mockResolvedValue({
        id: 'listing-1',
        status: 'ACTIVE',
      });

      await service.confirmListForResale(
        'owner-1',
        'ticket-1',
        '1200',
        'signed-xdr',
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'RESALE' },
      });
      expect(prisma.resaleListing.create).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket-1',
          sellerId: 'owner-1',
          price: 1200n,
          txHash: '0xabc',
          expiresAt: null,
          priceHistory: {
            create: {
              price: 1200n,
            },
          },
        },
      });
    });

    it('rejects listing a ticket that already has an ACTIVE listing (#216)', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'owner-1',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
          maxResaleMultiplierBps: 20_000,
        },
        ticketType: { price: 1_000n },
      });
      prisma.resaleListing.findFirst.mockResolvedValueOnce({
        id: 'existing-listing',
      });

      await expect(
        service.confirmListForResale(
          'owner-1',
          'ticket-1',
          '1200',
          'signed-xdr',
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      // Fail fast: the chain is never touched and no listing row is written.
      expect(stellar.submitSignedTransaction).not.toHaveBeenCalled();
      expect(prisma.resaleListing.create).not.toHaveBeenCalled();
    });

    it('maps the DB unique-index violation to 409 when a concurrent create wins (#216)', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'owner-1',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
          maxResaleMultiplierBps: 20_000,
        },
        ticketType: { price: 1_000n },
      });
      // Both transactions race past the pre-check; the DB partial unique
      // index rejects the loser with a P2002 on the active-listing index.
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['ticketId', 'ResaleListing_ticketId_active_key'] },
        }),
      );

      await expect(
        service.confirmListForResale(
          'owner-1',
          'ticket-1',
          '1200',
          'signed-xdr',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('enforces soft limit on active resale listings per user (409 Conflict)', async () => {
      prisma.resaleListing.count.mockResolvedValue(5);

      await expect(
        service.buildListForResaleTx('seller-1', 'ticket-1', '1000'),
      ).rejects.toBeInstanceOf(ConflictException);

      await expect(
        service.confirmListForResale(
          'seller-1',
          'ticket-1',
          '1000',
          'signed-xdr',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('supports optional expiresAt when creating resale listing', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'owner-1',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
          maxResaleMultiplierBps: 20_000,
        },
        ticketType: { price: 1_000n },
      });
      prisma.resaleListing.create.mockResolvedValue({
        id: 'listing-1',
        status: 'ACTIVE',
      });

      const expiryStr = '2026-12-31T23:59:59.000Z';
      await service.confirmListForResale(
        'owner-1',
        'ticket-1',
        '1200',
        'signed-xdr',
        expiryStr,
      );

      const expectedData: unknown = expect.objectContaining({
        expiresAt: new Date(expiryStr),
      });
      expect(prisma.resaleListing.create).toHaveBeenCalledWith({
        data: expectedData,
      });
    });

    it('updates resale listing price and logs price audit history', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue({
        id: 'listing-1',
        sellerId: 'owner-1',
        status: 'ACTIVE',
        price: 1000n,
        ticket: {
          ticketType: { price: 1_000n },
          event: { maxResaleMultiplierBps: 20_000 },
        },
      });

      await service.updateResalePrice('owner-1', 'listing-1', '1500');

      expect(prisma.resalePriceHistory.create).toHaveBeenCalledWith({
        data: {
          resaleListingId: 'listing-1',
          price: 1500n,
        },
      });
      expect(prisma.resaleListing.update).toHaveBeenCalledWith({
        where: { id: 'listing-1' },
        data: { price: 1500n },
      });
    });

    it('fetches price history audit trail for a listing', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue({ id: 'listing-1' });
      prisma.resalePriceHistory.findMany.mockResolvedValue([
        { id: 'h-1', price: 1000n },
        { id: 'h-2', price: 1500n },
      ]);

      const history = await service.getPriceHistory('listing-1');
      expect(history).toHaveLength(2);
      expect(prisma.resalePriceHistory.findMany).toHaveBeenCalledWith({
        where: { resaleListingId: 'listing-1' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('cancels expired listings and restores ticket status to VALID', async () => {
      prisma.resaleListing.findMany.mockResolvedValue([
        { id: 'listing-exp-1', ticketId: 'ticket-exp-1' },
        { id: 'listing-exp-2', ticketId: 'ticket-exp-2' },
      ]);

      const res = await service.cancelExpiredListings();

      expect(res.cancelledCount).toBe(2);
      expect(prisma.resaleListing.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['listing-exp-1', 'listing-exp-2'] } },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ticket-exp-1', 'ticket-exp-2'] } },
        data: { status: 'VALID' },
      });
    });
  });

  describe('findActiveResaleListings', () => {
    it('returns a cursor page with stable createdAt+id ordering', async () => {
      const newer = {
        id: 'listing-2',
        price: 1_000n,
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
        ticket: { event: { royaltyBps: 500 }, ticketType: {} },
      };
      const older = {
        id: 'listing-1',
        price: 1_000n,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        ticket: { event: { royaltyBps: 500 }, ticketType: {} },
      };
      prisma.resaleListing.findMany.mockResolvedValue([newer, older]);

      const page = await service.findActiveResaleListings(undefined, 10);

      expect(prisma.resaleListing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 11,
        }),
      );
      // items contain enriched rows; check id equality
      expect(page.items.map((i) => i.id)).toEqual([newer.id, older.id]);
      expect(page.nextCursor).toBeNull();
      expect(page.limit).toBe(10);
    });

    it('exposes nextCursor when more rows remain', async () => {
      const rows = [
        {
          id: 'c',
          price: 1_000n,
          createdAt: new Date('2026-09-03T00:00:00.000Z'),
          ticket: { event: { royaltyBps: 500 }, ticketType: {} },
        },
        {
          id: 'b',
          price: 1_000n,
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
          ticket: { event: { royaltyBps: 500 }, ticketType: {} },
        },
        {
          id: 'a',
          price: 1_000n,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          ticket: { event: { royaltyBps: 500 }, ticketType: {} },
        },
      ];
      prisma.resaleListing.findMany.mockResolvedValue(rows);

      const page = await service.findActiveResaleListings(undefined, 2);

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toEqual(
        Buffer.from(
          `${rows[1].createdAt.toISOString()}|${rows[1].id}`,
          'utf8',
        ).toString('base64url'),
      );
    });

    it('rejects a malformed cursor', async () => {
      await expect(
        service.findActiveResaleListings('%%%', 10),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findMine', () => {
    it('scopes the query to the caller’s own tickets', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        { id: 'ticket-1', ownerId: 'owner-1' },
      ]);

      await service.findMine('owner-1');

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'owner-1' } }),
      );
    });

    it('filters by status when provided, using the (ownerId, status) index (#213)', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      await service.findMine('owner-1', 'VALID');

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerId: 'owner-1', status: 'VALID' },
        }),
      );
    });
  });

  describe('findByChainTicketId (#268)', () => {
    const ticket = {
      id: 'ticket-1',
      chainTicketId: 7n,
      event: { id: 'event-1', organizationId: 'org-1', organization: {} },
      ticketType: { id: 'tt-1' },
    };

    it('returns the ticket when the caller is staff of the owning organization', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      const result = await service.findByChainTicketId('staff-1', 7n);

      expect(prisma.ticket.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { chainTicketId: 7n } }),
      );
      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'staff-1',
      );
      expect(result).toBe(ticket);
    });

    it('throws NotFoundException for an unknown chainTicketId', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.findByChainTicketId('staff-1', 999n),
      ).rejects.toThrow(NotFoundException);
      expect(organizations.assertMember).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException when the caller is not org staff', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      organizations.assertMember.mockRejectedValueOnce(
        new ForbiddenException('You are not a member of this organization'),
      );

      await expect(
        service.findByChainTicketId('outsider-1', 7n),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---- #321 Graceful degradation ----

  describe('verify — graceful RPC degradation (#321)', () => {
    const baseTicket = {
      id: 'ticket-1',
      chainTicketId: 7n,
      status: 'VALID',
      seat: 'A1',
      event: { organizationId: 'org-1', name: 'Radiohead Live' },
      owner: { name: 'Ada Lovelace' },
      ticketType: { name: 'GA' },
    };

    it('returns stale:false and on-chain data when RPC is available', async () => {
      prisma.ticket.findUnique.mockResolvedValue(baseTicket);
      stellar.verifyTicket.mockResolvedValue({
        owner: 'GBUYER',
        status: 'Valid',
      });

      const result = await service.verify('staff-1', 'qr-secret');

      expect(result.stale).toBe(false);
      expect(result.status).toBe('VALID');
      expect(result.onChainOwner).toBe('GBUYER');
    });

    it('returns stale:true with cached DB data when RPC throws', async () => {
      prisma.ticket.findUnique.mockResolvedValue(baseTicket);
      stellar.verifyTicket.mockRejectedValue(new Error('RPC unavailable'));

      const result = await service.verify('staff-1', 'qr-secret');

      expect(result.stale).toBe(true);
      expect(result.status).toBe('VALID');
      expect(result.onChainOwner).toBeNull();
      // should NOT attempt a DB update when RPC is down
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  // ---- #320 Royalty and seller proceeds ----

  describe('findActiveResaleListings — royalty and proceeds (#320)', () => {
    it('computes royaltyFee and sellerProceeds matching contract math', async () => {
      const listing = {
        id: 'listing-1',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        price: 10_000n,
        ticket: {
          event: { royaltyBps: 500 },
          ticketType: { price: 1_000n },
        },
        seller: { name: 'Alice' },
      };
      prisma.resaleListing.findMany.mockResolvedValue([listing]);

      const page = await service.findActiveResaleListings(undefined, 10);

      // royaltyFee = floor(10_000 * 500 / 10_000) = 500
      expect(page.items[0].royaltyFee).toBe(500n);
      // sellerProceeds = 10_000 - 500 = 9_500
      expect(page.items[0].sellerProceeds).toBe(9_500n);
    });

    it('handles zero royaltyBps (no fee deducted)', async () => {
      const listing = {
        id: 'listing-2',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        price: 5_000n,
        ticket: {
          event: { royaltyBps: 0 },
          ticketType: { price: 1_000n },
        },
        seller: { name: 'Bob' },
      };
      prisma.resaleListing.findMany.mockResolvedValue([listing]);

      const page = await service.findActiveResaleListings(undefined, 10);

      expect(page.items[0].royaltyFee).toBe(0n);
      expect(page.items[0].sellerProceeds).toBe(5_000n);
    });
  });

  // ---- #319 Resale price cap validation ----

  describe('computeResalePriceCap (#319)', () => {
    it('mirrors contract floor(originalPrice * multiplierBps / 10_000)', () => {
      // 1_000 * 11_000 / 10_000 = 1_100
      expect(TicketsService.computeResalePriceCap(1_000n, 11_000)).toBe(1_100n);
    });

    it('truncates fractional results like Rust integer division', () => {
      // 999 * 11_000 / 10_000 = 1098.9 → 1098
      expect(TicketsService.computeResalePriceCap(999n, 11_000)).toBe(1098n);
    });

    it('returns 0 when multiplier is 0', () => {
      expect(TicketsService.computeResalePriceCap(1_000n, 0)).toBe(0n);
    });
  });

  describe('buildListForResaleTx — price cap validation (#319)', () => {
    const ticketRow = {
      id: 'ticket-1',
      ownerId: 'owner-1',
      chainTicketId: 7n,
      event: {
        organizationId: 'org-1',
        organization: { stellarAccount: 'GORG' },
        maxResaleMultiplierBps: 11_000,
      },
      ticketType: { price: 1_000n },
    };

    it('rejects a price above the cap', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketRow);
      prisma.user.findUnique.mockResolvedValue({
        id: 'owner-1',
        stellarPublicKey: 'GOWNER',
      });

      // cap = 1_100; 1_101 > cap
      await expect(
        service.buildListForResaleTx('owner-1', 'ticket-1', '1101'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stellar.buildListForResaleTx).not.toHaveBeenCalled();
    });

    it('accepts a price exactly at the cap', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketRow);
      prisma.user.findUnique.mockResolvedValue({
        id: 'owner-1',
        stellarPublicKey: 'GOWNER',
      });

      const result = await service.buildListForResaleTx(
        'owner-1',
        'ticket-1',
        '1100',
      );
      expect(result.unsignedXdr).toBe('unsigned-xdr');
    });
  });

  // ---- #318 update-price with price cap ----

  describe('updateResalePrice — price cap validation (#318)', () => {
    const listingWithPricingInfo = {
      id: 'listing-1',
      sellerId: 'owner-1',
      status: 'ACTIVE',
      price: 1_000n,
      ticket: {
        ticketType: { price: 1_000n },
        event: { maxResaleMultiplierBps: 11_000 },
      },
    };

    it('rejects a new price above the cap', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue(listingWithPricingInfo);

      await expect(
        service.updateResalePrice('owner-1', 'listing-1', '1101'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.resaleListing.update).not.toHaveBeenCalled();
    });

    it('accepts a new price at the cap', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue(listingWithPricingInfo);

      await service.updateResalePrice('owner-1', 'listing-1', '1100');

      expect(prisma.resaleListing.update).toHaveBeenCalledWith({
        where: { id: 'listing-1' },
        data: { price: 1100n },
      });
    });

    it('rejects when listing is not ACTIVE', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue({
        ...listingWithPricingInfo,
        status: 'SOLD',
      });

      await expect(
        service.updateResalePrice('owner-1', 'listing-1', '900'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when caller does not own the listing', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue(listingWithPricingInfo);

      await expect(
        service.updateResalePrice('someone-else', 'listing-1', '900'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ---- Bulk revoke (#267) ----

  describe('revokeBatch', () => {
    it('revokes a batch of tickets', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        organization: { stellarAccount: 'GORGANIZER' },
      });
      prisma.ticket.findMany.mockResolvedValue([
        { id: 'ticket-1', eventId: 'event-1' },
        { id: 'ticket-2', eventId: 'event-1' },
      ]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeBatch('user-1', 'event-1', [
        'ticket-1',
        'ticket-2',
      ]);

      expect(result.count).toBe(2);
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['ticket-1', 'ticket-2'] } },
          data: { status: 'REVOKED' },
        }),
      );
    });

    it('rejects batch exceeding max size', async () => {
      const ticketIds = Array.from({ length: 101 }, (_, i) => `ticket-${i}`);

      await expect(
        service.revokeBatch('user-1', 'event-1', ticketIds),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when user is not an organization member', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        organization: { stellarAccount: 'GORGANIZER' },
      });
      organizations.assertMember.mockRejectedValue(
        new ForbiddenException('Not a member'),
      );

      await expect(
        service.revokeBatch('user-1', 'event-1', ['ticket-1']),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when some tickets are not found', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
        organization: { stellarAccount: 'GORGANIZER' },
      });
      prisma.ticket.findMany.mockResolvedValue([
        { id: 'ticket-1', eventId: 'event-1' },
      ]);

      await expect(
        service.revokeBatch('user-1', 'event-1', ['ticket-1', 'ticket-2']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ---- Check-in with reason (#266) ----

  describe('confirmCheckIn with reason', () => {
    it('stores check-in reason when provided', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        eventId: 'event-1',
        ownerId: 'owner-1',
        event: { organizationId: 'org-1', organization: {} },
      });
      prisma.ticket.update.mockResolvedValue({
        id: 'ticket-1',
        checkInReason: 'scanner_malfunction',
      });

      await service.confirmCheckIn(
        'user-1',
        'ticket-1',
        'signed-xdr',
        undefined,
        'scanner_malfunction',
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            checkInReason: 'scanner_malfunction',
          }) as object,
        }),
      );
    });

    it('stores null reason when not provided', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        eventId: 'event-1',
        ownerId: 'owner-1',
        event: { organizationId: 'org-1', organization: {} },
      });
      prisma.ticket.update.mockResolvedValue({
        id: 'ticket-1',
        checkInReason: null,
      });

      await service.confirmCheckIn('user-1', 'ticket-1', 'signed-xdr');

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            checkInReason: null,
          }) as object,
        }),
      );
    });
  });
});
