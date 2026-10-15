import { ConflictException, NotFoundException } from '@nestjs/common';
import { WaitlistEntryStatus } from '@prisma/client';
import { WaitlistService } from './waitlist.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';

describe('WaitlistService', () => {
  let service: WaitlistService;
  let prisma: {
    ticketType: { findUnique: jest.Mock };
    waitlistEntry: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let organizations: { assertMember: jest.Mock };

  beforeEach(() => {
    prisma = {
      ticketType: { findUnique: jest.fn() },
      waitlistEntry: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    organizations = { assertMember: jest.fn() };
    service = new WaitlistService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
    );
  });

  describe('join', () => {
    it('rejects joining a ticket type that still has capacity', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        id: 'tt-1',
        quantityIssued: 5,
        quantityTotal: 10,
      });

      await expect(service.join('user-1', 'tt-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.waitlistEntry.create).not.toHaveBeenCalled();
    });

    it('rejects a user already WAITING on the same ticket type', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        id: 'tt-1',
        quantityIssued: 10,
        quantityTotal: 10,
      });
      prisma.waitlistEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        status: WaitlistEntryStatus.WAITING,
      });

      await expect(service.join('user-1', 'tt-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('assigns fair FIFO position based on earlier WAITING entries', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        id: 'tt-1',
        quantityIssued: 10,
        quantityTotal: 10,
      });
      prisma.waitlistEntry.findUnique.mockResolvedValue(null);
      const createdAt = new Date('2026-01-01T00:00:00Z');
      prisma.waitlistEntry.create.mockResolvedValue({
        id: 'entry-2',
        ticketTypeId: 'tt-1',
        userId: 'user-1',
        createdAt,
      });
      prisma.waitlistEntry.count.mockResolvedValue(3);

      const result = await service.join('user-1', 'tt-1');

      expect(prisma.waitlistEntry.count).toHaveBeenCalledWith({
        where: {
          ticketTypeId: 'tt-1',
          status: WaitlistEntryStatus.WAITING,
          createdAt: { lt: createdAt },
        },
      });
      expect(result.position).toBe(4);
    });

    it('re-joins a previously CANCELLED entry instead of erroring', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        id: 'tt-1',
        quantityIssued: 10,
        quantityTotal: 10,
      });
      const createdAt = new Date();
      prisma.waitlistEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        status: WaitlistEntryStatus.CANCELLED,
        createdAt,
      });
      prisma.waitlistEntry.update.mockResolvedValue({
        id: 'entry-1',
        ticketTypeId: 'tt-1',
        status: WaitlistEntryStatus.WAITING,
        createdAt,
      });
      prisma.waitlistEntry.count.mockResolvedValue(0);

      await service.join('user-1', 'tt-1');

      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: {
          status: WaitlistEntryStatus.WAITING,
          offeredAt: null,
          offerExpiresAt: null,
        },
      });
    });
  });

  describe('leave', () => {
    it('throws when the user has no active waitlist entry', async () => {
      prisma.waitlistEntry.findUnique.mockResolvedValue(null);

      await expect(service.leave('user-1', 'tt-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marks a WAITING entry CANCELLED', async () => {
      prisma.waitlistEntry.findUnique.mockResolvedValue({
        id: 'entry-1',
        status: WaitlistEntryStatus.WAITING,
      });

      await service.leave('user-1', 'tt-1');

      expect(prisma.waitlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { status: WaitlistEntryStatus.CANCELLED },
      });
    });
  });

  describe('offerNext', () => {
    it('offers entries strictly in FIFO (createdAt asc) order', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        id: 'tt-1',
        event: { organizationId: 'org-1' },
      });
      prisma.waitlistEntry.findMany.mockResolvedValue([
        { id: 'entry-1' },
        { id: 'entry-2' },
      ]);

      await service.offerNext('organizer-1', 'tt-1', 2);

      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'organizer-1',
      );
      expect(prisma.waitlistEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ticketTypeId: 'tt-1', status: WaitlistEntryStatus.WAITING },
          orderBy: { createdAt: 'asc' },
          take: 2,
        }),
      );
      expect(prisma.waitlistEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['entry-1', 'entry-2'] } },
          data: expect.objectContaining({
            status: WaitlistEntryStatus.OFFERED,
          }) as object,
        }),
      );
    });
  });
});
