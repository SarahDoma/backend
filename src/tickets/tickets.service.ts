import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ResaleListingStatus, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListingInactiveError,
  TicketTypeSoldOutError,
} from '../common/errors/domain.error';
import { OrganizationsService } from '../organizations/organizations.service';
import { StellarService } from '../stellar/stellar.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import { OfflineTokenService } from './offline-token.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { GatesService } from '../gates/gates.service';

/** How long an offline-verifiable token stays valid before a scanner must re-verify online. */
const OFFLINE_TOKEN_TTL_SECONDS = 12 * 60 * 60;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly stellar: StellarService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly offlineTokens?: OfflineTokenService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly promoCodes?: PromoCodesService,
    @Optional() private readonly gates?: GatesService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ---- Organizer-authorized issuance (off-chain payment already settled) ----

  async buildIssueTx(
    userId: string,
    ticketTypeId: string,
    toUserId: string,
    toPublicKey: string,
    seat?: string,
  ) {
    const { ticketType, event } =
      await this.getTicketTypeWithEvent(ticketTypeId);
    await this.organizations.assertMember(event.organizationId, userId);
    this.assertHasCapacity(ticketType.quantityIssued, ticketType.quantityTotal);
    this.assertSaleWindow(ticketType.saleStartsAt, ticketType.saleEndsAt);
    if (event.chainEventId === null) {
      throw new BadRequestException(
        'Event has not been published on-chain yet',
      );
    }

    const toUser = await this.getUserWithWallet(toUserId);
    this.assertRecipientPublicKey(toUser.stellarPublicKey, toPublicKey);
    const unsignedXdr = await this.stellar.buildIssueTicketTx({
      organizerPublicKey: event.organization.stellarAccount,
      chainEventId: event.chainEventId,
      toPublicKey: toUser.stellarPublicKey!,
      tier: ticketType.name,
      seat: seat ?? 'unassigned',
      price: ticketType.price,
    });
    return { unsignedXdr };
  }

  async confirmIssue(
    userId: string,
    ticketTypeId: string,
    toUserId: string,
    toPublicKey: string,
    seat: string | undefined,
    signedXdr: string,
  ) {
    const { event } = await this.getTicketTypeWithEvent(ticketTypeId);
    await this.organizations.assertMember(event.organizationId, userId);
    const toUser = await this.getUserWithWallet(toUserId);
    this.assertRecipientPublicKey(toUser.stellarPublicKey, toPublicKey);
    // #211 — fail fast on duplicate assigned seats before touching the chain.
    await this.assertSeatAvailable(event.id, seat);

    const { result, txHash } =
      await this.stellar.submitSignedTransaction(signedXdr);
    const chainTicketId = result as bigint;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // #217 — serialize concurrent issuances: lock the TicketType row and
        // re-check capacity FROM the locked row. The pre-transaction
        // assertHasCapacity only sees a possibly-stale read.
        const locked = await tx.$queryRaw<
          { quantityIssued: number; quantityTotal: number }[]
        >`SELECT "quantityIssued", "quantityTotal" FROM "TicketType" WHERE "id" = ${ticketTypeId} FOR UPDATE`;
        const row = locked[0];
        if (!row) {
          throw new BadRequestException('Ticket type not found');
        }
        this.assertHasCapacity(row.quantityIssued, row.quantityTotal);

        await tx.ticketType.update({
          where: { id: ticketTypeId },
          data: { quantityIssued: { increment: 1 } },
        });
        return tx.ticket.create({
          data: {
            eventId: event.id,
            ticketTypeId,
            ownerId: toUserId,
            chainTicketId,
            seat: seat ?? 'unassigned',
            issuedTxHash: txHash,
          },
        });
      });
    } catch (err) {
      this.throwOnSeatConflict(err);
      throw err;
    }
  }

  // ---- Fully on-chain primary sale ----

  async buildPurchaseTx(
    buyerId: string,
    ticketTypeId: string,
    seat?: string,
    promoCode?: string,
  ) {
    const { ticketType, event } =
      await this.getTicketTypeWithEvent(ticketTypeId);
    this.assertHasCapacity(ticketType.quantityIssued, ticketType.quantityTotal);
    if (event.chainEventId === null) {
      throw new BadRequestException(
        'Event has not been published on-chain yet',
      );
    }
    const buyer = await this.getUserWithWallet(buyerId);
    const price = promoCode
      ? (
          await this.promoCodes!.validate(
            event.id,
            buyerId,
            promoCode,
            ticketType.price,
          )
        ).discountedPrice
      : ticketType.price;

    const unsignedXdr = await this.stellar.buildPurchasePrimaryTx({
      buyerPublicKey: buyer.stellarPublicKey!,
      chainEventId: event.chainEventId,
      tier: ticketType.name,
      seat: seat ?? 'unassigned',
      price,
    });
    return { unsignedXdr };
  }

  async confirmPurchase(
    buyerId: string,
    ticketTypeId: string,
    seat: string | undefined,
    signedXdr: string,
    promoCode?: string,
  ) {
    const { event } = await this.getTicketTypeWithEvent(ticketTypeId);
    // #211 — fail fast on duplicate assigned seats before touching the chain.
    await this.assertSeatAvailable(event.id, seat);
    const { result, txHash } =
      await this.stellar.submitSignedTransaction(signedXdr);
    const chainTicketId = result as bigint;

    let ticket;
    try {
      ticket = await this.prisma.$transaction(async (tx) => {
        // #217 — serialize concurrent purchases: lock the TicketType row and
        // re-check capacity FROM the locked row, so concurrent buyers cannot
        // both pass the pre-transaction capacity check and oversell
        // quantityTotal.
        const locked = await tx.$queryRaw<
          { quantityIssued: number; quantityTotal: number }[]
        >`SELECT "quantityIssued", "quantityTotal" FROM "TicketType" WHERE "id" = ${ticketTypeId} FOR UPDATE`;
        const row = locked[0];
        if (!row) {
          throw new BadRequestException('Ticket type not found');
        }
        this.assertHasCapacity(row.quantityIssued, row.quantityTotal);

        await tx.ticketType.update({
          where: { id: ticketTypeId },
          data: { quantityIssued: { increment: 1 } },
        });
        return tx.ticket.create({
          data: {
            eventId: event.id,
            ticketTypeId,
            ownerId: buyerId,
            chainTicketId,
            seat: seat ?? 'unassigned',
            issuedTxHash: txHash,
          },
        });
      });
    } catch (err) {
      this.throwOnSeatConflict(err);
      throw err;
    }
    if (promoCode) {
      await this.promoCodes!.redeem(event.id, buyerId, promoCode, ticket.id);
    }
    const buyer = await this.prisma.user.findUnique({ where: { id: buyerId } });
    if (buyer && this.notifications) {
      await this.notifications.sendTicketReceipt({
        to: buyer.email,
        buyerName: buyer.name,
        eventName: event.name,
        ticketType: (await this.getTicketTypeWithEvent(ticketTypeId)).ticketType
          .name,
        seat: seat ?? 'unassigned',
      });
    }
    return ticket;
  }

  // ---- Direct transfer ----

  async buildTransferTx(
    userId: string,
    ticketId: string,
    toUserId: string,
    toPublicKey: string,
  ) {
    const ticket = await this.getOwnedTicket(ticketId, userId);
    const owner = await this.getUserWithWallet(userId);
    const toUser = await this.getUserWithWallet(toUserId);
    this.assertRecipientPublicKey(toUser.stellarPublicKey, toPublicKey);

    const unsignedXdr = await this.stellar.buildTransferTicketTx({
      fromPublicKey: owner.stellarPublicKey!,
      chainTicketId: ticket.chainTicketId,
      toPublicKey: toUser.stellarPublicKey!,
    });
    return { unsignedXdr };
  }

  async confirmTransfer(
    userId: string,
    ticketId: string,
    toUserId: string,
    toPublicKey: string,
    signedXdr: string,
  ) {
    await this.getOwnedTicket(ticketId, userId);
    const toUser = await this.getUserWithWallet(toUserId);
    this.assertRecipientPublicKey(toUser.stellarPublicKey, toPublicKey);
    await this.stellar.submitSignedTransaction(signedXdr);
    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: { ownerId: toUserId, status: TicketStatus.VALID },
    });
  }

  // ---- Verification (read-only, organizer/gate staff) ----

  async verify(userId: string, qrSecret: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { qrSecret },
      include: {
        event: { include: { organization: true } },
        owner: true,
        ticketType: true,
      },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    await this.organizations.assertMember(ticket.event.organizationId, userId);

    // #321 — Graceful degradation: if the Soroban RPC is unavailable, serve
    // the cached DB data with a `stale: true` marker rather than throwing.
    let reconciledStatus: TicketStatus = ticket.status;
    let onChainOwner: string | null = null;
    let stale = false;

    try {
      const onChain = await this.stellar.verifyTicket(ticket.chainTicketId);
      reconciledStatus = onChain.status.toUpperCase() as TicketStatus;
      onChainOwner = onChain.owner;

      if (reconciledStatus !== ticket.status) {
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: reconciledStatus },
        });
      }
    } catch (err) {
      this.logger.warn(
        `Soroban RPC unavailable during verify (ticketId=${ticket.id}): ${(err as Error).message}. Serving cached data.`,
      );
      stale = true;
    }

    return {
      ticketId: ticket.id,
      eventName: ticket.event.name,
      tier: ticket.ticketType.name,
      seat: ticket.seat,
      ownerName: ticket.owner.name,
      status: reconciledStatus,
      onChainOwner,
      stale,
    };
  }

  // ---- Offline gate verification (see docs/OFFLINE_VERIFICATION.md) ----

  getOfflinePublicKeys() {
    return this.offlineTokens!.getPublicKeys();
  }

  async getOfflineToken(userId: string, ticketId: string) {
    const ticket = await this.getTicketWithOrg(ticketId);
    await this.organizations.assertMember(ticket.event.organizationId, userId);

    return this.offlineTokens!.sign({
      ticketId: ticket.id,
      chainTicketId: ticket.chainTicketId.toString(),
      eventId: ticket.eventId,
      status: ticket.status,
      exp: Math.floor(Date.now() / 1000) + OFFLINE_TOKEN_TTL_SECONDS,
    });
  }

  // ---- Check-in ----

  async buildCheckInTx(userId: string, ticketId: string) {
    const ticket = await this.getTicketWithOrg(ticketId);
    await this.organizations.assertMember(ticket.event.organizationId, userId);

    const unsignedXdr = await this.stellar.buildCheckInTx({
      organizerPublicKey: ticket.event.organization.stellarAccount,
      chainTicketId: ticket.chainTicketId,
    });
    return { unsignedXdr };
  }

  async confirmCheckIn(
    userId: string,
    ticketId: string,
    signedXdr: string,
    gateId?: string,
    reason?: string,
  ) {
    const ticket = await this.getTicketWithOrg(ticketId);
    await this.organizations.assertMember(ticket.event.organizationId, userId);
    if (gateId) {
      await this.gates!.assertBelongsToEvent(gateId, ticket.eventId);
    }
    await this.stellar.submitSignedTransaction(signedXdr);
    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: TicketStatus.USED,
        checkedInAt: new Date(),
        checkedInGateId: gateId ?? null,
        checkInReason: reason ?? null,
      },
    });
  }

  /**
   * Check-in via a `ScannerDevice` token (see `ScannerDeviceGuard`) instead
   * of a staff JWT. The guard already confirmed the device is live and
   * scoped to this ticket's event, so no `organizations.assertMember` call
   * is needed here.
   */
  async confirmCheckInByDevice(
    ticketId: string,
    signedXdr: string,
    gateId?: string,
    reason?: string,
  ) {
    const ticket = await this.getTicketWithOrg(ticketId);
    if (gateId) {
      await this.gates!.assertBelongsToEvent(gateId, ticket.eventId);
    }
    await this.stellar.submitSignedTransaction(signedXdr);
    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: TicketStatus.USED,
        checkedInAt: new Date(),
        checkedInGateId: gateId ?? null,
        checkInReason: reason ?? null,
      },
    });
  }

  // ---- Revocation (fraud prevention) ----

  async buildRevokeTx(userId: string, ticketId: string) {
    const ticket = await this.getTicketWithOrg(ticketId);
    await this.organizations.assertMember(ticket.event.organizationId, userId);

    const unsignedXdr = await this.stellar.buildRevokeTicketTx({
      organizerPublicKey: ticket.event.organization.stellarAccount,
      chainTicketId: ticket.chainTicketId,
    });
    return { unsignedXdr };
  }

  async confirmRevoke(userId: string, ticketId: string, signedXdr: string) {
    const ticket = await this.getTicketWithOrg(ticketId);
    await this.organizations.assertMember(ticket.event.organizationId, userId);
    await this.stellar.submitSignedTransaction(signedXdr);
    const revoked = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.REVOKED },
    });
    // #209 — audit ticket revocation.
    await this.audit?.record(userId, 'ticket.revoke', 'Ticket', ticketId, {
      eventId: ticket.eventId,
    });
    return revoked;
  }

  async revokeBatch(userId: string, eventId: string, ticketIds: string[]) {
    const MAX_BATCH_SIZE = 100;
    if (ticketIds.length > MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `Cannot revoke more than ${MAX_BATCH_SIZE} tickets at once`,
      );
    }

    const event = await this.getEventWithOrg(eventId);
    await this.organizations.assertMember(event.organizationId, userId);

    const tickets = await this.prisma.ticket.findMany({
      where: {
        id: { in: ticketIds },
        eventId,
      },
    });

    if (tickets.length !== ticketIds.length) {
      throw new BadRequestException(
        'Some tickets were not found or do not belong to this event',
      );
    }

    const result = await this.prisma.ticket.updateMany({
      where: { id: { in: ticketIds } },
      data: { status: TicketStatus.REVOKED },
    });
    // #209 — audit batch revocation (one entry per batch).
    await this.audit?.record(userId, 'ticket.revoke_batch', 'Event', eventId, {
      ticketIds,
      count: result.count,
    });
    return result;
  }

  private async assertWithinResaleLimit(userId: string) {
    const maxLimit =
      this.config?.get<number>('MAX_ACTIVE_RESALE_LISTINGS_PER_USER') ?? 5;
    const activeCount = await this.prisma.resaleListing.count({
      where: {
        sellerId: userId,
        status: ResaleListingStatus.ACTIVE,
      },
    });
    if (activeCount >= maxLimit) {
      throw new ConflictException(
        'Maximum active resale listings limit reached',
      );
    }
  }

  // ---- Resale marketplace ----

  /**
   * #319 — Mirrors the contract's resale price cap arithmetic.
   *
   * cap = floor(originalPrice * maxResaleMultiplierBps / 10_000)
   *
   * Using BigInt division keeps the rounding identical to Rust's integer
   * division (truncation toward zero), which is what the Soroban contract uses.
   */
  static computeResalePriceCap(
    originalPrice: bigint,
    maxResaleMultiplierBps: number,
  ): bigint {
    return (originalPrice * BigInt(maxResaleMultiplierBps)) / 10_000n;
  }

  private assertResalePriceCap(
    price: bigint,
    originalPrice: bigint,
    maxResaleMultiplierBps: number,
  ) {
    const cap = TicketsService.computeResalePriceCap(
      originalPrice,
      maxResaleMultiplierBps,
    );
    if (price > cap) {
      throw new BadRequestException(
        `Resale price exceeds the event's anti-scalping cap of ${cap.toString()}`,
      );
    }
  }

  async buildListForResaleTx(userId: string, ticketId: string, price: string) {
    await this.assertWithinResaleLimit(userId);
    const ticket = await this.getOwnedTicketWithPricingInfo(ticketId, userId);
    const owner = await this.getUserWithWallet(userId);

    // #319 — validate price cap before building the transaction
    this.assertResalePriceCap(
      BigInt(price),
      ticket.ticketType.price,
      ticket.event.maxResaleMultiplierBps,
    );

    const unsignedXdr = await this.stellar.buildListForResaleTx({
      ownerPublicKey: owner.stellarPublicKey!,
      chainTicketId: ticket.chainTicketId,
      price: BigInt(price),
    });
    return { unsignedXdr };
  }

  async confirmListForResale(
    userId: string,
    ticketId: string,
    price: string,
    signedXdr: string,
    expiresAt?: string,
  ) {
    await this.assertWithinResaleLimit(userId);
    // #216 — fail fast when the ticket is already listed before touching the
    // chain. The DB-level partial unique index remains the source of truth.
    await this.assertNoActiveResaleListing(ticketId);
    const ticket = await this.getOwnedTicketWithPricingInfo(ticketId, userId);

    // #319 — validate price cap at confirm step too (guards against replays)
    this.assertResalePriceCap(
      BigInt(price),
      ticket.ticketType.price,
      ticket.event.maxResaleMultiplierBps,
    );

    const { txHash } = await this.stellar.submitSignedTransaction(signedXdr);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: ticketId },
          data: { status: TicketStatus.RESALE },
        });
        return tx.resaleListing.create({
          data: {
            ticketId,
            sellerId: userId,
            price: BigInt(price),
            txHash,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            priceHistory: {
              create: {
                price: BigInt(price),
              },
            },
          },
        });
      });
    } catch (err) {
      // #216 — a concurrent create raced us past the pre-check: the partial
      // unique index rejected it, surface it as a 409.
      this.throwOnResaleConflict(err);
      throw err;
    }
  }

  async updateResalePrice(userId: string, listingId: string, newPrice: string) {
    const listing = await this.prisma.resaleListing.findUnique({
      where: { id: listingId },
      include: {
        ticket: { include: { ticketType: true, event: true } },
      },
    });
    if (!listing) {
      throw new NotFoundException('Resale listing not found');
    }
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('You do not own this resale listing');
    }
    if (listing.status !== ResaleListingStatus.ACTIVE) {
      throw new BadRequestException('Listing is not active');
    }

    // #319/#318 — validate new price against the event's anti-scalping cap
    this.assertResalePriceCap(
      BigInt(newPrice),
      listing.ticket.ticketType.price,
      listing.ticket.event.maxResaleMultiplierBps,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.resalePriceHistory.create({
        data: {
          resaleListingId: listingId,
          price: BigInt(newPrice),
        },
      });
      return tx.resaleListing.update({
        where: { id: listingId },
        data: { price: BigInt(newPrice) },
      });
    });
  }

  async getPriceHistory(listingId: string) {
    const listing = await this.prisma.resaleListing.findUnique({
      where: { id: listingId },
    });
    if (!listing) {
      throw new NotFoundException('Resale listing not found');
    }
    return this.prisma.resalePriceHistory.findMany({
      where: { resaleListingId: listingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async cancelExpiredListings() {
    const now = new Date();
    const expiredListings = await this.prisma.resaleListing.findMany({
      where: {
        status: ResaleListingStatus.ACTIVE,
        expiresAt: { lte: now },
      },
    });

    if (expiredListings.length === 0) {
      return { cancelledCount: 0 };
    }

    const listingIds = expiredListings.map((l) => l.id);
    const ticketIds = expiredListings.map((l) => l.ticketId);

    await this.prisma.$transaction([
      this.prisma.resaleListing.updateMany({
        where: { id: { in: listingIds } },
        data: { status: ResaleListingStatus.CANCELLED },
      }),
      this.prisma.ticket.updateMany({
        where: { id: { in: ticketIds } },
        data: { status: TicketStatus.VALID },
      }),
    ]);

    return { cancelledCount: expiredListings.length };
  }

  async buildCancelResaleTx(userId: string, ticketId: string) {
    const ticket = await this.getOwnedTicket(ticketId, userId);
    const owner = await this.getUserWithWallet(userId);

    const unsignedXdr = await this.stellar.buildCancelResaleTx({
      ownerPublicKey: owner.stellarPublicKey!,
      chainTicketId: ticket.chainTicketId,
    });
    return { unsignedXdr };
  }

  async confirmCancelResale(
    userId: string,
    ticketId: string,
    signedXdr: string,
  ) {
    await this.getOwnedTicket(ticketId, userId);
    await this.stellar.submitSignedTransaction(signedXdr);

    return this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.VALID },
      });
      await tx.resaleListing.updateMany({
        where: { ticketId, status: ResaleListingStatus.ACTIVE },
        data: { status: ResaleListingStatus.CANCELLED },
      });
    });
  }

  async buildBuyResaleTx(buyerId: string, ticketId: string) {
    const ticket = await this.getTicketWithOrg(ticketId);
    if (ticket.status !== TicketStatus.RESALE) {
      throw new ListingInactiveError();
    }
    const buyer = await this.getUserWithWallet(buyerId);

    const unsignedXdr = await this.stellar.buildBuyResaleTx({
      buyerPublicKey: buyer.stellarPublicKey!,
      chainTicketId: ticket.chainTicketId,
    });
    return { unsignedXdr };
  }

  async confirmBuyResale(buyerId: string, ticketId: string, signedXdr: string) {
    await this.stellar.submitSignedTransaction(signedXdr);

    return this.prisma.$transaction(async (tx) => {
      await tx.resaleListing.updateMany({
        where: { ticketId, status: ResaleListingStatus.ACTIVE },
        data: { status: ResaleListingStatus.SOLD },
      });
      return tx.ticket.update({
        where: { id: ticketId },
        data: { ownerId: buyerId, status: TicketStatus.VALID },
      });
    });
  }

  async findActiveResaleListings(cursor?: string, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);
    const cursorFilter = cursor ? this.resaleCursorWhere(cursor) : undefined;

    const rows = await this.prisma.resaleListing.findMany({
      where: {
        status: ResaleListingStatus.ACTIVE,
        ...(cursorFilter ?? {}),
      },
      include: {
        ticket: { include: { event: true, ticketType: true } },
        seller: { select: { name: true } },
      },
      // createdAt + id keeps the order stable when timestamps collide.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? this.encodeResaleCursor(last.createdAt, last.id) : null;

    // #320 — Compute royalty fee and seller proceeds for each listing so
    // clients don't have to duplicate the contract math.
    // royaltyFee   = floor(price * royaltyBps / 10_000)
    // sellerProceeds = price - royaltyFee
    const enrichedItems = items.map((listing) => {
      const price = listing.price;
      const royaltyBps = listing.ticket.event.royaltyBps;
      const royaltyFee = (price * BigInt(royaltyBps)) / 10_000n;
      const sellerProceeds = price - royaltyFee;
      return {
        ...listing,
        royaltyFee,
        sellerProceeds,
      };
    });

    return { items: enrichedItems, nextCursor, limit: take };
  }

  findMine(userId: string, status?: TicketStatus) {
    // #213 — (ownerId, status) is covered by "Ticket_ownerId_status_idx".
    return this.prisma.ticket.findMany({
      where: { ownerId: userId, ...(status ? { status } : {}) },
      include: { event: true, ticketType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Looks up a ticket by its on-chain id. Restricted to staff of the owning event's organization. */
  async findByChainTicketId(staffUserId: string, chainTicketId: bigint) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { chainTicketId },
      include: { event: { include: { organization: true } }, ticketType: true },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    await this.organizations.assertMember(
      ticket.event.organizationId,
      staffUserId,
    );

    return ticket;
  }

  // ---- shared helpers ----

  private async getTicketTypeWithEvent(ticketTypeId: string) {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: { event: { include: { organization: true } } },
    });
    if (!ticketType) {
      throw new NotFoundException('Ticket type not found');
    }
    return { ticketType, event: ticketType.event };
  }

  private async getEventWithOrg(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organization: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async getTicketWithOrg(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { event: { include: { organization: true } } },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  private async getOwnedTicket(ticketId: string, userId: string) {
    const ticket = await this.getTicketWithOrg(ticketId);
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('You do not own this ticket');
    }
    return ticket;
  }

  /**
   * Like `getOwnedTicket` but additionally includes `ticketType` and `event`
   * relations needed for resale price-cap validation (#319).
   */
  private async getOwnedTicketWithPricingInfo(
    ticketId: string,
    userId: string,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: { include: { organization: true } },
        ticketType: true,
      },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('You do not own this ticket');
    }
    return ticket;
  }

  private async getUserWithWallet(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.stellarPublicKey) {
      throw new BadRequestException(
        'Connect a Stellar wallet to your account before continuing',
      );
    }
    return user;
  }

  private assertHasCapacity(issued: number, total: number) {
    if (issued >= total) {
      throw new TicketTypeSoldOutError();
    }
  }

  /**
   * #211 — application-level guard mirroring the partial unique index
   * `Ticket_eventId_seat_partial_key` (eventId, seat WHERE seat <> 'unassigned').
   * The DB remains the source of truth; this check only produces a nicer
   * 409 before the chain round-trip.
   */
  private async assertSeatAvailable(eventId: string, seat?: string) {
    const normalized = seat?.trim() ?? 'unassigned';
    if (!normalized || normalized === 'unassigned') return;
    const existing = await this.prisma.ticket.findFirst({
      where: { eventId, seat: normalized },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'That seat has already been issued for this event',
      );
    }
  }

  /** Translates a partial-index violation into a 409. */
  private throwOnSeatConflict(err: unknown): void {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const target = (err.meta as { target?: unknown } | undefined)?.target;
      const targets = Array.isArray(target)
        ? target.join(',')
        : typeof target === 'string'
          ? target
          : '';
      if (targets.includes('seat') || targets.includes('Ticket_eventId_seat')) {
        throw new ConflictException(
          'That seat has already been issued for this event',
        );
      }
    }
  }

  /**
   * #216 — application-level guard mirroring the partial unique index
   * `ResaleListing_ticketId_active_key` (ticketId WHERE status = 'ACTIVE').
   * The DB remains the source of truth; this check only produces a nicer
   * 409 before the chain round-trip.
   */
  private async assertNoActiveResaleListing(ticketId: string) {
    const existing = await this.prisma.resaleListing.findFirst({
      where: { ticketId, status: ResaleListingStatus.ACTIVE },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'This ticket already has an active resale listing',
      );
    }
  }

  /** Translates the active-listing partial-index violation into a 409. */
  private throwOnResaleConflict(err: unknown): void {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const target = (err.meta as { target?: unknown } | undefined)?.target;
      const targets = Array.isArray(target)
        ? target.join(',')
        : typeof target === 'string'
          ? target
          : '';
      if (targets.includes('ResaleListing_ticketId_active')) {
        throw new ConflictException(
          'This ticket already has an active resale listing',
        );
      }
    }
  }

  private assertSaleWindow(startsAt: Date | null, endsAt: Date | null) {
    const now = new Date();
    if (startsAt && now < startsAt)
      throw new BadRequestException('Ticket sales have not started');
    if (endsAt && now > endsAt)
      throw new BadRequestException('Ticket sales have ended');
  }

  private assertRecipientPublicKey(
    userPublicKey: string | null | undefined,
    providedPublicKey: string,
  ) {
    if (userPublicKey !== providedPublicKey) {
      throw new BadRequestException(
        'Recipient public key does not match target user',
      );
    }
  }

  private encodeResaleCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
      'base64url',
    );
  }

  private resaleCursorWhere(cursor: string) {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const [dateStr, id] = decoded.split('|');
      if (!dateStr || !id) {
        throw new BadRequestException('Invalid cursor');
      }
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        throw new BadRequestException('Invalid cursor');
      }
      return {
        OR: [{ createdAt: { lt: date } }, { createdAt: date, id: { lt: id } }],
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Invalid cursor');
    }
  }
}
