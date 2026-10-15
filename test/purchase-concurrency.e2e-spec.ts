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
import { NotificationService } from '../src/notifications/notifications.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import type { CurrentUserPayload } from '../src/auth/decorators/current-user.decorator';
import type { User } from '@prisma/client';
import {
  createEvent,
  createOrganization,
  createTicketType,
  createUser,
} from './factories';

// Requires a real DATABASE_URL — same constraint as app.e2e-spec.ts.
//
// #217 — proves concurrent confirmPurchase calls cannot oversell
// quantityTotal: the interactive transaction takes a row-level lock on the
// TicketType row and re-checks quantityIssued < quantityTotal under the
// lock, so losing transactions abort with TICKET_TYPE_SOLD_OUT (409) and
// quantityIssued never exceeds quantityTotal.
describe('Ticket purchase concurrency (e2e, #217)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let currentUser: CurrentUserPayload;
  let userIndex: Map<string, User>;

  const mockStellarService = {
    buildPurchasePrimaryTx: jest
      .fn()
      .mockResolvedValue('unsigned-purchase-xdr'),
    submitSignedTransaction: jest.fn().mockImplementation(() =>
      Promise.resolve({
        result: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
        txHash: 'c'.repeat(64),
      }),
    ),
  };

  const mockNotificationService = {
    sendTicketReceipt: jest.fn().mockResolvedValue(undefined),
  };

  async function seedSellableTier(overrides: { quantityTotal?: number } = {}) {
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
        chainEventId: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      }),
    });
    const ticketType = await prisma.ticketType.create({
      data: createTicketType({
        id: randomUUID(),
        eventId: event.id,
        price: 1_000n,
        quantityIssued: 0,
        quantityTotal: overrides.quantityTotal ?? 2,
      }),
    });
    return { organization, event, ticketType };
  }

  beforeAll(async () => {
    userIndex = new Map<string, User>();
    currentUser = {
      userId: '',
      email: '',
      role: 'ATTENDEE',
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StellarService)
      .useValue(mockStellarService)
      .overrideProvider(NotificationService)
      .useValue(mockNotificationService)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: import('@nestjs/common').ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          // Concurrency-safe test identity: each in-flight request carries
          // its own buyer id via the x-test-user-id header.
          const userId = req.headers['x-test-user-id'] as string | undefined;
          const user = (userId && userIndex.get(userId)) || null;
          req.user = user
            ? { userId: user.id, email: user.email, role: user.role }
            : currentUser;
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

  it('never oversells quantityTotal under concurrent purchases', async () => {
    const quantityTotal = 3;
    const buyerCount = 8;
    const { ticketType } = await seedSellableTier({ quantityTotal });

    const purchasers: User[] = [];
    for (let i = 0; i < buyerCount; i++) {
      const buyer = await prisma.user.create({
        data: createUser({
          id: randomUUID(),
          email: `buyer-${randomUUID()}@example.com`,
          stellarPublicKey: `G${randomUUID()
            .replace(/-/g, '')
            .toUpperCase()
            .padEnd(55, 'A')}`,
        }),
      });
      purchasers.push(buyer);
      userIndex.set(buyer.id, buyer);
    }

    // Build every purchase request first (each carrying its own buyer id),
    // then execute them concurrently so the capacity race actually happens.
    const purchases = purchasers.map((buyer, index) =>
      request(app.getHttpServer())
        .post('/v1/tickets/confirm-purchase')
        .set('x-test-user-id', buyer.id)
        .send({
          ticketTypeId: ticketType.id,
          signedXdr: `signed-xdr-${index}`,
        }),
    );
    const responses = await Promise.all(purchases);

    const succeeded = responses.filter((res) => res.status === 201);
    const soldOut = responses.filter((res) => res.status === 409);

    // Exactly quantityTotal purchases succeed; every other buyer gets the
    // domain 409 (TICKET_TYPE_SOLD_OUT) instead of an oversold ticket.
    expect(succeeded).toHaveLength(quantityTotal);
    expect(soldOut).toHaveLength(buyerCount - quantityTotal);
    for (const res of soldOut) {
      expect(res.body.code).toBe('TICKET_TYPE_SOLD_OUT');
    }

    const tier = await prisma.ticketType.findUniqueOrThrow({
      where: { id: ticketType.id },
    });
    expect(Number(tier.quantityIssued)).toBe(quantityTotal);

    const ticketCount = await prisma.ticket.count({
      where: { ticketTypeId: ticketType.id },
    });
    expect(ticketCount).toBe(quantityTotal);
  });
});
