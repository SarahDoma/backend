import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('findMe', () => {
    it('throws NotFoundException when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findMe('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the profile projection', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
      });

      const result = await service.findMe('user-1');
      expect(result).toEqual({ id: 'user-1', email: 'a@b.com' });
    });
  });

  describe('connectWallet', () => {
    it('rejects a wallet already connected to another account', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.connectWallet('user-1', 'GABC'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('responds with a 409 and a friendly, non-technical message', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      try {
        await service.connectWallet('user-1', 'GABC');
        throw new Error('expected connectWallet to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const exception = err as ConflictException;
        expect(exception.getStatus()).toBe(409);
        expect(exception.message).toBe(
          'That wallet is already connected to another account',
        );
      }
    });

    it('rethrows unrelated errors', async () => {
      prisma.user.update.mockRejectedValue(new Error('connection lost'));

      await expect(service.connectWallet('user-1', 'GABC')).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('lookupByEmail', () => {
    it('throws NotFoundException when no account matches', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.lookupByEmail('nobody@example.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
