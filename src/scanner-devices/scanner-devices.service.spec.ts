import { UnauthorizedException } from '@nestjs/common';
import { ScannerDevicesService } from './scanner-devices.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';

describe('ScannerDevicesService', () => {
  let service: ScannerDevicesService;
  let prisma: {
    event: { findUnique: jest.Mock };
    scannerDevice: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let organizations: { assertMember: jest.Mock };

  beforeEach(() => {
    prisma = {
      event: { findUnique: jest.fn() },
      scannerDevice: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    organizations = { assertMember: jest.fn() };
    service = new ScannerDevicesService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
    );
  });

  describe('register', () => {
    it('returns the raw token exactly once and persists only its hash', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        organizationId: 'org-1',
      });
      prisma.scannerDevice.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'device-1', ...data }),
      );

      const { device, token } = await service.register('user-1', 'event-1', {
        name: 'Gate A Scanner',
      });

      expect(token).toMatch(/^scn_[a-f0-9]{64}$/);
      expect(device.tokenHash).not.toBe(token);
      expect(device.tokenHash).toHaveLength(64);
    });
  });

  describe('authenticate', () => {
    it('rejects an unknown token', async () => {
      prisma.scannerDevice.findUnique.mockResolvedValue(null);

      await expect(service.authenticate('bad-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a revoked token', async () => {
      prisma.scannerDevice.findUnique.mockResolvedValue({
        id: 'device-1',
        revokedAt: new Date(),
      });

      await expect(
        service.authenticate('revoked-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.scannerDevice.update).not.toHaveBeenCalled();
    });

    it('accepts a live token and bumps lastUsedAt', async () => {
      prisma.scannerDevice.findUnique.mockResolvedValue({
        id: 'device-1',
        revokedAt: null,
      });

      const device = await service.authenticate('good-token');

      expect(device.id).toBe('device-1');
      expect(prisma.scannerDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'device-1' } }),
      );
    });
  });

  describe('revoke', () => {
    it('sets revokedAt so the token stops authenticating', async () => {
      prisma.scannerDevice.findUnique.mockResolvedValue({
        id: 'device-1',
        eventId: 'event-1',
        event: { organizationId: 'org-1' },
      });

      await service.revoke('user-1', 'event-1', 'device-1');

      expect(prisma.scannerDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });
  });
});
