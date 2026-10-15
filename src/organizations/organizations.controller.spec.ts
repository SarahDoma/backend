import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import {
  AUTH,
  createControllerApp,
  server,
  TEST_USER,
} from '../../test/helpers/controller-app';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

const VALID_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

describe('OrganizationsController', () => {
  let app: INestApplication;
  const service = {
    create: jest.fn(),
    findMine: jest.fn(),
    findOne: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  };

  beforeAll(async () => {
    app = await createControllerApp({
      controller: OrganizationsController,
      service: { provide: OrganizationsService, useValue: service },
    });
  });
  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  const validBody = {
    name: 'Acme Events',
    slug: 'acme-events',
    industry: 'CONCERTS',
    stellarAccount: VALID_KEY,
  };

  it.each([
    ['post', '/organizations'],
    ['get', '/organizations/mine'],
    ['get', '/organizations/org-1'],
    ['delete', '/organizations/org-1'],
    ['post', '/organizations/org-1/restore'],
  ] as const)('rejects unauthenticated %s %s', async (method, url) => {
    await request(server(app))[method](url).expect(401);
  });

  it('POST / creates an organization for the current user', async () => {
    service.create.mockResolvedValue({ id: 'org-1' });
    const res = await request(server(app))
      .post('/organizations')
      .set(AUTH)
      .send(validBody)
      .expect(201);
    expect(res.body).toEqual({ id: 'org-1' });
    expect(service.create).toHaveBeenCalledWith(TEST_USER.userId, validBody);
  });

  it.each([
    ['a bad slug', { slug: 'Not A Slug' }],
    ['an unknown industry', { industry: 'NOPE' }],
    ['a short name', { name: 'A' }],
    ['an invalid Stellar key', { stellarAccount: 'nope' }],
    ['an unknown field', { extra: true }],
  ])('POST / rejects %s before reaching the service', async (_label, patch) => {
    await request(server(app))
      .post('/organizations')
      .set(AUTH)
      .send({ ...validBody, ...patch })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("GET /mine lists the current user's organizations", async () => {
    service.findMine.mockResolvedValue([{ id: 'org-1' }]);
    const res = await request(server(app))
      .get('/organizations/mine')
      .set(AUTH)
      .expect(200);
    expect(res.body).toEqual([{ id: 'org-1' }]);
    expect(service.findMine).toHaveBeenCalledWith(TEST_USER.userId);
  });

  it('GET /:id returns the organization and propagates not-found', async () => {
    service.findOne.mockResolvedValueOnce({ id: 'org-1' });
    await request(server(app))
      .get('/organizations/org-1')
      .set(AUTH)
      .expect(200);
    expect(service.findOne).toHaveBeenCalledWith('org-1');

    service.findOne.mockRejectedValueOnce(
      new NotFoundException('Organization not found'),
    );
    const res = await request(server(app))
      .get('/organizations/missing')
      .set(AUTH)
      .expect(404);
    expect((res.body as { message: string }).message).toBe(
      'Organization not found',
    );
  });

  it('DELETE /:id soft-deletes as the current user', async () => {
    service.softDelete.mockResolvedValue({ id: 'org-1' });
    await request(server(app))
      .delete('/organizations/org-1')
      .set(AUTH)
      .expect(200);
    expect(service.softDelete).toHaveBeenCalledWith(TEST_USER.userId, 'org-1');
  });

  it('POST /:id/restore restores as the current user and propagates errors', async () => {
    service.restore.mockResolvedValueOnce({ id: 'org-1' });
    await request(server(app))
      .post('/organizations/org-1/restore')
      .set(AUTH)
      .expect(201);
    expect(service.restore).toHaveBeenCalledWith(TEST_USER.userId, 'org-1');

    service.restore.mockRejectedValueOnce(new NotFoundException());
    await request(server(app))
      .post('/organizations/nope/restore')
      .set(AUTH)
      .expect(404);
  });
});
