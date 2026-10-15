import { ConflictException, NotFoundException } from '@nestjs/common';
import { GatesService } from './gates.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';

describe('GatesService', () => {
  let service: GatesService;
  let prisma: {
    event: { findUnique: jest.Mock };
    gate: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
  };
  let organizations: { assertMember: jest.Mock };

  beforeEach(() => {
    prisma = {
      event: { findUnique: jest.fn() },
      gate: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
    };
    organizations = { assertMember: jest.fn() };
    service = new GatesService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
    );
  });

  describe('create', () => {
    it('throws when the event does not exist', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'event-1', { name: 'Main Gate' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires organization membership', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
      });
      prisma.gate.findUnique.mockResolvedValue(null);

      await service.create('user-1', 'event-1', { name: 'Main Gate' });

      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'user-1',
      );
    });

    it('rejects a duplicate gate name for the same event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
      });
      prisma.gate.findUnique.mockResolvedValue({ id: 'gate-1' });

      await expect(
        service.create('user-1', 'event-1', { name: 'Main Gate' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('assertBelongsToEvent', () => {
    it('throws when the gate belongs to a different event', async () => {
      prisma.gate.findUnique.mockResolvedValue({
        id: 'gate-1',
        eventId: 'event-other',
      });

      await expect(
        service.assertBelongsToEvent('gate-1', 'event-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the gate when it belongs to the event', async () => {
      const gate = { id: 'gate-1', eventId: 'event-1' };
      prisma.gate.findUnique.mockResolvedValue(gate);

      await expect(
        service.assertBelongsToEvent('gate-1', 'event-1'),
      ).resolves.toBe(gate);
    });
  });
});
