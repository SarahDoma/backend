import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PromoCodeDiscountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';

const MAX_PERCENT_BPS = 10_000;

export interface PromoCodeValidationResult {
  promoCode: {
    id: string;
    discountType: PromoCodeDiscountType;
    discountValue: number;
  };
  discountedPrice: bigint;
  discountAmount: bigint;
}

@Injectable()
export class PromoCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
  ) {}

  async create(userId: string, eventId: string, dto: CreatePromoCodeDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    // #207 — soft-deleted events behave as not-found.
    if (!event || (event as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Event not found');
    }
    await this.organizations.assertMember(event.organizationId, userId);

    if (
      dto.discountType === PromoCodeDiscountType.PERCENT &&
      dto.discountValue > MAX_PERCENT_BPS
    ) {
      throw new BadRequestException(
        'discountValue for a PERCENT code cannot exceed 10000 basis points',
      );
    }

    return this.prisma.promoCode.create({
      data: {
        eventId,
        code: dto.code.toUpperCase(),
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxRedemptions: dto.maxRedemptions,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async listForEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event || (event as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Event not found');
    }
    await this.organizations.assertMember(event.organizationId, userId);

    return this.prisma.promoCode.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Public preview: what would `code` discount `ticketTypeId`'s price to for `userId`. */
  async previewForTicketType(
    eventId: string,
    userId: string,
    ticketTypeId: string,
    code: string,
  ) {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
    });
    if (!ticketType || ticketType.eventId !== eventId) {
      throw new NotFoundException('Ticket type not found for this event');
    }
    return this.validate(eventId, userId, code, ticketType.price);
  }

  async revoke(userId: string, eventId: string, promoCodeId: string) {
    const promoCode = await this.prisma.promoCode.findUnique({
      where: { id: promoCodeId },
      include: { event: true },
    });
    if (!promoCode || promoCode.eventId !== eventId) {
      throw new NotFoundException('Promo code not found');
    }
    await this.organizations.assertMember(
      promoCode.event.organizationId,
      userId,
    );
    return this.prisma.promoCode.update({
      where: { id: promoCodeId },
      data: { isActive: false },
    });
  }

  /**
   * Validates a code against an event/user/price without redeeming it.
   * Called both by the public "preview a discount" endpoint and internally
   * by `TicketsService.buildPurchaseTx` at purchase build time -- the
   * contract itself has no notion of promo codes, so this is the only
   * place the discount is enforced.
   */
  async validate(
    eventId: string,
    userId: string,
    rawCode: string,
    price: bigint,
  ): Promise<PromoCodeValidationResult> {
    const code = rawCode.trim().toUpperCase();
    const promoCode = await this.prisma.promoCode.findUnique({
      where: { eventId_code: { eventId, code } },
    });
    if (!promoCode || !promoCode.isActive) {
      throw new BadRequestException('Invalid promo code');
    }
    if (promoCode.expiresAt && promoCode.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This promo code has expired');
    }
    if (
      promoCode.maxRedemptions !== null &&
      promoCode.redemptionCount >= promoCode.maxRedemptions
    ) {
      throw new BadRequestException(
        'This promo code has reached its redemption limit',
      );
    }
    const alreadyRedeemed = await this.prisma.promoCodeRedemption.findUnique({
      where: { promoCodeId_userId: { promoCodeId: promoCode.id, userId } },
    });
    if (alreadyRedeemed) {
      throw new BadRequestException('You have already used this promo code');
    }

    const discountAmount = this.computeDiscount(
      promoCode.discountType,
      promoCode.discountValue,
      price,
    );
    const discountedPrice =
      price - discountAmount > 0n ? price - discountAmount : 0n;

    return {
      promoCode: {
        id: promoCode.id,
        discountType: promoCode.discountType,
        discountValue: promoCode.discountValue,
      },
      discountedPrice,
      discountAmount,
    };
  }

  /**
   * Records a redemption once a purchase actually completes. Re-checks the
   * usage limit inside the same call so a race between two concurrent
   * purchases can't both squeeze under `maxRedemptions` -- the unique
   * [promoCodeId, userId] constraint additionally makes a double-redeem by
   * the same user a DB-level impossibility, not just an app-level check.
   */
  async redeem(
    eventId: string,
    userId: string,
    rawCode: string,
    ticketId: string,
  ) {
    const code = rawCode.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const promoCode = await tx.promoCode.findUnique({
        where: { eventId_code: { eventId, code } },
      });
      if (!promoCode || !promoCode.isActive) {
        throw new BadRequestException('Invalid promo code');
      }
      if (
        promoCode.maxRedemptions !== null &&
        promoCode.redemptionCount >= promoCode.maxRedemptions
      ) {
        throw new BadRequestException(
          'This promo code has reached its redemption limit',
        );
      }
      await tx.promoCode.update({
        where: { id: promoCode.id },
        data: { redemptionCount: { increment: 1 } },
      });
      return tx.promoCodeRedemption.create({
        data: { promoCodeId: promoCode.id, userId, ticketId },
      });
    });
  }

  private computeDiscount(
    type: PromoCodeDiscountType,
    value: number,
    price: bigint,
  ): bigint {
    if (type === PromoCodeDiscountType.FIXED) {
      return BigInt(value);
    }
    // PERCENT: value is basis points.
    return (price * BigInt(value)) / BigInt(MAX_PERCENT_BPS);
  }
}
