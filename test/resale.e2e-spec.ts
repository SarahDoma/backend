import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StellarService } from '../src/stellar/stellar.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import type { CurrentUserPayload } from '../src/auth/decorators/current-user.decorator';
import {
  createEvent,
  createOrganization,
  createTicket,
  createTicketType,
  createUser,
} from './factories';

// Requires a real DATABASE_URL — same constraint as app.e2e-spec.ts. Covers
// the resale marketplace: list -> cancel, and list -> buy, asserting the
// ticket and resale listing status transitions between each step (#223).
describe('Resale flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let currentUser: CurrentUserPayload;

  const mockStellarService = {
    buildListForResaleTx: jest.fn().mockResolvedValue('unsigned-list-xdr'),
    buildCancelResaleTx: jest.fn().mockResolvedValue('unsigned-cancel-xdr'),
    buildBuyResaleTx: jest.fn().mockResolvedValue('unsigned-buy-xdr'),
    submitSignedTransaction: jest
      .fn()
      .mockResolvedValue({ txHash: 'b'.repeat(64) }),
  };

  async function seedTicket(
    overrides: {
      price?: bigint;
      maxResaleMultiplierBps?: number;
    } = {},
  ) {
    const seller = await prisma.user.create({
      data: createUser({
        id: randomUUID(),
        email: `seller-${randomUUID()}@example.com`,
        stellarPublicKey: `G${randomUUID().replace(/-/g, '').toUpperCase().padEnd(55, 'A')}`,
      }),
    });
    const organization = await prisma.organization.create({
      data: createOrganization({
        id: randomUUID(),
        slug: `org-${randomUUID()}`,
      }),
    });
    const event = await prisma.event.create({
      data: createEvent({
        id: randomUUID(),
        organizationId: organization.id,
        status: 'PUBLISHED',
        maxResaleMultiplierBps: overrides.maxResaleMultiplierBps ?? 15_000,
      }),
    });
    const ticketType = await prisma.ticketType.create({
      data: createTicketType({
        id: randomUUID(),
        eventId: event.id,
        price: overrides.price ?? 1_000n,
      }),
    });
    const ticket = await prisma.ticket.create({
      data: createTicket({
        id: randomUUID(),
        eventId: event.id,
        ticketTypeId: ticketType.id,
        ownerId: seller.id,
        chainTicketId: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
        status: 'VALID',
      }),
    });
    return { seller, organization, event, ticketType, ticket };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StellarService)
      .useValue(mockStellarService)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: import('@nestjs/common').ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists a ticket for resale then cancels the listing', async () => {
    const { seller, ticket } = await seedTicket();
    currentUser = { userId: seller.id, email: seller.email, role: seller.role };

    // Step 1: build the list-resale transaction.
    await request(app.getHttpServer())
      .post(`/v1/tickets/${ticket.id}/list-resale`)
      .send({ price: '1100' })
      .expect(201)
      .expect((res) => {
        expect(res.body.unsignedXdr).toBe('unsigned-list-xdr');
      });

    // Step 2: confirm the list-resale — ticket -> RESALE, listing -> ACTIVE.
    const confirmListRes = await request(app.getHttpServer())
      .post(`/v1/tickets/${ticket.id}/confirm-list-resale`)
      .send({ price: '1100', signedXdr: 'signed-xdr' })
      .expect(201);

    expect(confirmListRes.body.status).toBe('ACTIVE');
    const listingId = confirmListRes.body.id as string;

    const ticketAfterList = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(ticketAfterList.status).toBe('RESALE');

    // Sanity check: the listing shows up in the active resale feed.
    const listRes = await request(app.getHttpServer())
      .get('/v1/tickets/resale')
      .expect(200);
    expect(
      listRes.body.items.some((item: { id: string }) => item.id === listingId),
    ).toBe(true);

    // Step 3: build + confirm cancel-resale — ticket -> VALID, listing -> CANCELLED.
    await request(app.getHttpServer())
      .post(`/v1/tickets/${ticket.id}/cancel-resale`)
      .expect(201)
      .expect((res) => {
        expect(res.body.unsignedXdr).toBe('unsigned-cancel-xdr');
      });

    await request(app.getHttpServer())
      .post(`/v1/tickets/${ticket.id}/confirm-cancel-resale`)
      .send({ signedXdr: 'signed-xdr' })
      .expect(201);

    const ticketAfterCancel = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(ticketAfterCancel.status).toBe('VALID');

    const listingAfterCancel = await prisma.resaleListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    expect(listingAfterCancel.status).toBe('CANCELLED');
  });

  it('lists a ticket for resale then a different buyer purchases it', async () => {
    const { seller, ticket } = await seedTicket();
    const buyer = await prisma.user.create({
      data: createUser({
        id: randomUUID(),
        email: `buyer-${randomUUID()}@example.com`,
        stellarPublicKey: `G${randomUUID().replace(/-/g, '').toUpperCase().padEnd(55, 'A')}`,
      }),
    });

    // List as the seller.
    currentUser = { userId: seller.id, email: seller.email, role: seller.role };
    const confirmListRes = await request(app.getHttpServer())
      .post(`/v1/tickets/${ticket.id}/confirm-list-resale`)
      .send({ price: '1100', signedXdr: 'signed-xdr' })
      .expect(201);
    const listingId = confirmListRes.body.id as string;
    expect(confirmListRes.body.status).toBe('ACTIVE');

    // Buy as the buyer.
    currentUser = { userId: buyer.id, email: buyer.email, role: buyer.role };
    await request(app.getHttpServer())
      .post(`/v1/tickets/${ticket.id}/buy-resale`)
      .expect(201)
      .expect((res) => {
        expect(res.body.unsignedXdr).toBe('unsigned-buy-xdr');
      });

    const confirmBuyRes = await request(app.getHttpServer())
      .post(`/v1/tickets/${ticket.id}/confirm-buy-resale`)
      .send({ signedXdr: 'signed-xdr' })
      .expect(201);

    expect(confirmBuyRes.body.ownerId).toBe(buyer.id);
    expect(confirmBuyRes.body.status).toBe('VALID');

    const listingAfterBuy = await prisma.resaleListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    expect(listingAfterBuy.status).toBe('SOLD');

    const ticketAfterBuy = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(ticketAfterBuy.ownerId).toBe(buyer.id);
    expect(ticketAfterBuy.status).toBe('VALID');
  });

  it('does not allow two ACTIVE resale listings for the same ticket (#216)', async () => {
    const { seller, ticket } = await seedTicket();
    currentUser = { userId: seller.id, email: seller.email, role: seller.role };

    // Two concurrent confirm-list-resale calls race the application-level
    // pre-check; the DB partial unique index must let exactly one win.
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post(`/v1/tickets/${ticket.id}/confirm-list-resale`)
          .send({ price: '1100', signedXdr: 'signed-xdr' }),
      ),
    );

    const succeeded = responses.filter((res) => res.status === 201);
    const conflicted = responses.filter((res) => res.status === 409);

    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0].body.message).toMatch(/active resale listing/i);

    const activeListings = await prisma.resaleListing.count({
      where: { ticketId: ticket.id, status: 'ACTIVE' },
    });
    expect(activeListings).toBe(1);
  });
});
