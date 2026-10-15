import type { ResaleListing, Ticket } from '@prisma/client';

let ticketCounter = 0;
let listingCounter = 0;

/** Returns a fully-valid `Ticket` row, with realistic defaults, merged with `overrides`. */
export function createTicket(overrides: Partial<Ticket> = {}): Ticket {
  const n = ++ticketCounter;
  return {
    id: `ticket-${n}`,
    eventId: `event-${n}`,
    ticketTypeId: `tt-${n}`,
    ownerId: `user-${n}`,
    chainTicketId: BigInt(n),
    seat: 'unassigned',
    status: 'VALID',
    qrSecret: `qr-secret-${n}`,
    issuedTxHash: null,
    checkedInAt: null,
    checkInReason: null,
    checkedInGateId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** Returns a fully-valid `ResaleListing` row, with realistic defaults, merged with `overrides`. */
export function createResaleListing(
  overrides: Partial<ResaleListing> = {},
): ResaleListing {
  const n = ++listingCounter;
  return {
    id: `listing-${n}`,
    ticketId: `ticket-${n}`,
    sellerId: `user-${n}`,
    price: 1_200n,
    status: 'ACTIVE',
    txHash: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
