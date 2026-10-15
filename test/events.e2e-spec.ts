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
import { createOrganization, createUser } from './factories';

// Requires a real DATABASE_URL — same constraint as app.e2e-spec.ts. Covers
// the organizer-facing event lifecycle: create draft -> add ticket type ->
// publish (build + confirm), asserting the event's status transitions along
// the way (#222).
describe('Event lifecycle (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let currentUser: CurrentUserPayload;

  const mockStellarService = {
    buildCreateEventTx: jest.fn().mockResolvedValue('unsigned-xdr'),
    submitSignedTransaction: jest
      .fn()
      .mockResolvedValue({ txHash: 'a'.repeat(64) }),
    getEvent: jest.fn(),
  };

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

  it('creates a draft event, adds a ticket type, then publishes it', async () => {
    const organizer = await prisma.user.create({
      data: createUser({
        id: randomUUID(),
        email: `organizer-${randomUUID()}@example.com`,
        stellarPublicKey: `G${randomUUID().replace(/-/g, '').toUpperCase().padEnd(55, 'A')}`,
      }),
    });
    const organization = await prisma.organization.create({
      data: createOrganization({
        id: randomUUID(),
        slug: `org-${randomUUID()}`,
      }),
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: organizer.id,
        role: 'OWNER',
      },
    });
    currentUser = {
      userId: organizer.id,
      email: organizer.email,
      role: organizer.role,
    };

    // Step 1: create the event as a DRAFT.
    const createRes = await request(app.getHttpServer())
      .post(`/v1/organizations/${organization.id}/events`)
      .send({
        name: 'Test Concert',
        category: 'CONCERTS',
        venue: 'Test Arena',
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .expect(201);

    expect(createRes.body.status).toBe('DRAFT');
    const eventId = createRes.body.id as string;

    // Step 2: add a ticket type — required before the event can be published.
    const ticketTypeRes = await request(app.getHttpServer())
      .post(`/v1/events/${eventId}/ticket-types`)
      .send({
        name: 'General Admission',
        price: '1000',
        quantityTotal: 100,
      })
      .expect(201);

    expect(ticketTypeRes.body.eventId).toBe(eventId);
    expect(ticketTypeRes.body.name).toBe('General Admission');

    // Step 3: build the publish transaction — event stays DRAFT with a
    // reserved chainEventId until the signed XDR is confirmed.
    const buildPublishRes = await request(app.getHttpServer())
      .post(`/v1/events/${eventId}/publish`)
      .expect(201);

    expect(buildPublishRes.body.unsignedXdr).toBe('unsigned-xdr');

    const eventAfterBuild = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(eventAfterBuild.status).toBe('DRAFT');
    expect(eventAfterBuild.chainEventId).not.toBeNull();

    mockStellarService.getEvent.mockResolvedValue({
      eventId: eventAfterBuild.chainEventId!,
      organizer: organization.stellarAccount,
    });

    // Step 4: confirm publish — event flips to PUBLISHED.
    const confirmPublishRes = await request(app.getHttpServer())
      .post(`/v1/events/${eventId}/confirm-publish`)
      .send({ signedXdr: 'signed-xdr' })
      .expect(201);

    expect(confirmPublishRes.body.status).toBe('PUBLISHED');

    // Follow-up GET reflects the same, persisted state.
    const getRes = await request(app.getHttpServer())
      .get(`/v1/events/${eventId}`)
      .expect(200);
    expect(getRes.body.status).toBe('PUBLISHED');
  });
});
