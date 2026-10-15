import { HEADERS_METADATA } from '@nestjs/common/constants';
import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import request from 'supertest';
import {
  AUTH,
  createControllerApp,
  server,
  TEST_USER,
} from '../../test/helpers/controller-app';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { ResponseCacheInterceptor } from '../common/interceptors/response-cache.interceptor';

describe('EventsController', () => {
  let app: INestApplication;
  const service = {
    findPublished: jest.fn(),
    getWithOrg: jest.fn(),
    findForOrganization: jest.fn(),
    create: jest.fn(),
    addTicketType: jest.fn(),
    buildPublishTx: jest.fn(),
    unpublish: jest.fn(),
    confirmPublish: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  };

  beforeAll(async () => {
    app = await createControllerApp({
      controller: EventsController,
      service: { provide: EventsService, useValue: service },
      passthrough: { interceptors: [ResponseCacheInterceptor] },
    });
  });
  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  const http = () => request(server(app));

  it('adds cache-control headers to public event listings', () => {
    const headers = Reflect.getMetadata(
      HEADERS_METADATA,
      Object.getOwnPropertyDescriptor(
        EventsController.prototype,
        'findPublished',
      )?.value as object,
    ) as Array<{ name: string; value: string }>;

    expect(headers).toContainEqual({
      name: 'Cache-Control',
      value: 'public, max-age=60, s-maxage=300',
    });
  });

  describe('public routes (no auth)', () => {
    it('GET /events lists published events', async () => {
      service.findPublished.mockResolvedValue([[{ id: 'e1' }], 1]);
      const res = await http().get('/events').expect(200);
      expect(res.body).toEqual({
        items: [{ id: 'e1' }],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(res.headers['cache-control']).toBe(
        'public, max-age=60, s-maxage=300',
      );
    });

    it('GET /events/:eventId returns one event and propagates not-found', async () => {
      service.getWithOrg.mockResolvedValueOnce({ id: 'e1' });
      await http().get('/events/e1').expect(200);
      expect(service.getWithOrg).toHaveBeenCalledWith('e1');

      service.getWithOrg.mockRejectedValueOnce(
        new NotFoundException('Event not found'),
      );
      const res = await http().get('/events/nope').expect(404);
      expect((res.body as { message: string }).message).toBe('Event not found');
    });
  });

  describe('authenticated routes', () => {
    it.each([
      ['get', '/organizations/o1/events'],
      ['post', '/organizations/o1/events'],
      ['post', '/events/e1/ticket-types'],
      ['post', '/events/e1/publish'],
      ['post', '/events/e1/unpublish'],
      ['post', '/events/e1/confirm-publish'],
      ['delete', '/events/e1'],
      ['post', '/events/e1/restore'],
    ] as const)('rejects unauthenticated %s %s', async (method, url) => {
      await http()[method](url).expect(401);
    });

    describe('GET /organizations/:organizationId/events', () => {
      it('passes the status filter and pagination through', async () => {
        const page = { items: [], total: 0, page: 2, limit: 5 };
        service.findForOrganization.mockResolvedValue(page);

        const res = await http()
          .get('/organizations/o1/events')
          .query({ status: 'DRAFT', page: 2, limit: 5 })
          .set(AUTH)
          .expect(200);

        expect(res.body).toEqual(page);
        expect(service.findForOrganization).toHaveBeenCalledWith(
          TEST_USER.userId,
          'o1',
          expect.objectContaining({ status: 'DRAFT', page: 2, limit: 5 }),
        );
      });

      it('rejects an unknown status and propagates forbidden', async () => {
        await http()
          .get('/organizations/o1/events')
          .query({ status: 'NOPE' })
          .set(AUTH)
          .expect(400);
        expect(service.findForOrganization).not.toHaveBeenCalled();

        service.findForOrganization.mockRejectedValue(new ForbiddenException());
        await http().get('/organizations/o1/events').set(AUTH).expect(403);
      });
    });

    describe('POST /organizations/:organizationId/events', () => {
      const body = {
        name: 'Concert',
        category: 'CONCERTS',
        venue: 'Main Hall',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      };

      it('creates an event for the caller', async () => {
        service.create.mockResolvedValue({ id: 'e1' });
        await http()
          .post('/organizations/o1/events')
          .set(AUTH)
          .send(body)
          .expect(201);
        expect(service.create).toHaveBeenCalledWith(
          TEST_USER.userId,
          'o1',
          expect.objectContaining({ name: 'Concert', venue: 'Main Hall' }),
        );
      });

      it.each([
        ['a short name', { name: 'x' }],
        ['an unknown category', { category: 'NOPE' }],
        ['a start date in the past', { startsAt: '2020-01-01T00:00:00.000Z' }],
        ['an out-of-range royalty', { royaltyBps: 5000 }],
        ['an unknown field', { bogus: true }],
      ])('rejects %s', async (_label, patch) => {
        await http()
          .post('/organizations/o1/events')
          .set(AUTH)
          .send({ ...body, ...patch })
          .expect(400);
        expect(service.create).not.toHaveBeenCalled();
      });

      it('propagates service errors', async () => {
        service.create.mockRejectedValue(new ForbiddenException());
        await http()
          .post('/organizations/o1/events')
          .set(AUTH)
          .send(body)
          .expect(403);
      });
    });

    describe('POST /events/:eventId/ticket-types', () => {
      const body = { name: 'GA', price: '1000', quantityTotal: 50 };

      it('adds a ticket type for the caller', async () => {
        service.addTicketType.mockResolvedValue({ id: 't1' });
        await http()
          .post('/events/e1/ticket-types')
          .set(AUTH)
          .send(body)
          .expect(201);
        expect(service.addTicketType).toHaveBeenCalledWith(
          TEST_USER.userId,
          'e1',
          expect.objectContaining(body),
        );
      });

      it.each([
        ['a non-numeric price', { price: 'free' }],
        ['a zero quantity', { quantityTotal: 0 }],
        ['a fractional quantity', { quantityTotal: 1.5 }],
        ['a missing name', { name: undefined }],
      ])('rejects %s', async (_label, patch) => {
        await http()
          .post('/events/e1/ticket-types')
          .set(AUTH)
          .send({ ...body, ...patch })
          .expect(400);
        expect(service.addTicketType).not.toHaveBeenCalled();
      });
    });

    it('POST /events/:eventId/publish builds the publish transaction', async () => {
      service.buildPublishTx.mockResolvedValue({ xdr: 'x' });
      const res = await http().post('/events/e1/publish').set(AUTH).expect(201);
      expect(res.body).toEqual({ xdr: 'x' });
      expect(service.buildPublishTx).toHaveBeenCalledWith(
        TEST_USER.userId,
        'e1',
      );
    });

    it('POST /events/:eventId/unpublish unpublishes and propagates errors', async () => {
      service.unpublish.mockResolvedValueOnce({ id: 'e1' });
      await http().post('/events/e1/unpublish').set(AUTH).expect(201);
      expect(service.unpublish).toHaveBeenCalledWith(TEST_USER.userId, 'e1');

      service.unpublish.mockRejectedValueOnce(new NotFoundException());
      await http().post('/events/nope/unpublish').set(AUTH).expect(404);
    });

    describe('POST /events/:eventId/confirm-publish', () => {
      it('forwards only the signed XDR to the service', async () => {
        service.confirmPublish.mockResolvedValue({ id: 'e1' });
        await http()
          .post('/events/e1/confirm-publish')
          .set(AUTH)
          .send({ signedXdr: 'signed', txHash: 'a'.repeat(64) })
          .expect(201);
        expect(service.confirmPublish).toHaveBeenCalledWith(
          TEST_USER.userId,
          'e1',
          'signed',
        );
      });

      it.each([
        ['a missing signedXdr', {}],
        ['a malformed txHash', { signedXdr: 's', txHash: 'zz' }],
      ])('rejects %s', async (_label, body) => {
        await http()
          .post('/events/e1/confirm-publish')
          .set(AUTH)
          .send(body)
          .expect(400);
        expect(service.confirmPublish).not.toHaveBeenCalled();
      });
    });

    it('DELETE /events/:eventId soft-deletes as the caller', async () => {
      service.softDelete.mockResolvedValue({ id: 'e1' });
      await http().delete('/events/e1').set(AUTH).expect(200);
      expect(service.softDelete).toHaveBeenCalledWith(TEST_USER.userId, 'e1');
    });

    it('POST /events/:eventId/restore restores as the caller and propagates errors', async () => {
      service.restore.mockResolvedValueOnce({ id: 'e1' });
      await http().post('/events/e1/restore').set(AUTH).expect(201);
      expect(service.restore).toHaveBeenCalledWith(TEST_USER.userId, 'e1');

      service.restore.mockRejectedValueOnce(new ForbiddenException());
      await http().post('/events/e1/restore').set(AUTH).expect(403);
    });
  });
});
