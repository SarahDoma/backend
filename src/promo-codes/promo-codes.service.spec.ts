import { BadRequestException } from '@nestjs/common';
import { PromoCodeDiscountType } from '@prisma/client';
import { PromoCodesService } from './promo-codes.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';

describe('PromoCodesService', () => {
  let service: PromoCodesService;
  let prisma: {
    event: { findUnique: jest.Mock };
    ticketType: { findUnique: jest.Mock };
    promoCode: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    promoCodeRedemption: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let organizations: { assertMember: jest.Mock };

  beforeEach(() => {
    prisma = {
      event: { findUnique: jest.fn() },
      ticketType: { findUnique: jest.fn() },
      promoCode: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      promoCodeRedemption: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    organizations = { assertMember: jest.fn() };
    service = new PromoCodesService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
    );
  });

  describe('validate', () => {
    it('rejects an unknown code', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);

      await expect(
        service.validate('event-1', 'user-1', 'NOPE', 1000n),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an inactive code', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: false,
      });

      await expect(
        service.validate('event-1', 'user-1', 'SAVE10', 1000n),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an expired code', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: true,
        expiresAt: new Date(Date.now() - 1000),
        maxRedemptions: null,
        redemptionCount: 0,
      });

      await expect(
        service.validate('event-1', 'user-1', 'SAVE10', 1000n),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a code at its redemption limit', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: true,
        expiresAt: null,
        maxRedemptions: 5,
        redemptionCount: 5,
      });

      await expect(
        service.validate('event-1', 'user-1', 'SAVE10', 1000n),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a user who already redeemed this code', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: true,
        expiresAt: null,
        maxRedemptions: null,
        redemptionCount: 0,
      });
      prisma.promoCodeRedemption.findUnique.mockResolvedValue({ id: 'r-1' });

      await expect(
        service.validate('event-1', 'user-1', 'SAVE10', 1000n),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('computes a PERCENT discount in basis points', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: true,
        expiresAt: null,
        maxRedemptions: null,
        redemptionCount: 0,
        discountType: PromoCodeDiscountType.PERCENT,
        discountValue: 2_500, // 25%
      });
      prisma.promoCodeRedemption.findUnique.mockResolvedValue(null);

      const result = await service.validate(
        'event-1',
        'user-1',
        'save10',
        1000n,
      );

      expect(result.discountAmount).toBe(250n);
      expect(result.discountedPrice).toBe(750n);
    });

    it('computes a FIXED discount and floors at zero', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: true,
        expiresAt: null,
        maxRedemptions: null,
        redemptionCount: 0,
        discountType: PromoCodeDiscountType.FIXED,
        discountValue: 5_000,
      });
      prisma.promoCodeRedemption.findUnique.mockResolvedValue(null);

      const result = await service.validate(
        'event-1',
        'user-1',
        'BIGSAVE',
        1000n,
      );

      expect(result.discountAmount).toBe(5000n);
      expect(result.discountedPrice).toBe(0n);
    });
  });

  describe('redeem', () => {
    it('increments redemptionCount and records a redemption atomically', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: true,
        maxRedemptions: 10,
        redemptionCount: 3,
      });
      prisma.promoCodeRedemption.create.mockResolvedValue({ id: 'r-1' });

      await service.redeem('event-1', 'user-1', 'save10', 'ticket-1');

      expect(prisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: 'pc-1' },
        data: { redemptionCount: { increment: 1 } },
      });
      expect(prisma.promoCodeRedemption.create).toHaveBeenCalledWith({
        data: { promoCodeId: 'pc-1', userId: 'user-1', ticketId: 'ticket-1' },
      });
    });

    it('rejects redeeming a code that hit its limit inside the transaction', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'pc-1',
        isActive: true,
        maxRedemptions: 3,
        redemptionCount: 3,
      });

      await expect(
        service.redeem('event-1', 'user-1', 'save10', 'ticket-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.promoCode.update).not.toHaveBeenCalled();
    });
  });
});
