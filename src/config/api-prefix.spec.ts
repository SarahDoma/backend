import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';
import { applyApiPrefix, normalizeApiPrefix } from './api-prefix';

@Controller('events')
class EventsStubController {
  @Get()
  list() {
    return [];
  }

  @Post()
  create() {
    return { id: 'evt-1' };
  }
}

async function createApp(prefix?: string): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AppController, EventsStubController],
    providers: [AppService],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  applyApiPrefix(app, prefix);
  await app.init();
  return app;
}

describe('normalizeApiPrefix', () => {
  it.each([
    ['api', 'api'],
    ['/api/v1/', 'api/v1'],
    ['  /v2 ', 'v2'],
    ['', undefined],
    ['/', undefined],
    [undefined, undefined],
  ])('normalizes %p to %p', (raw, expected) => {
    expect(normalizeApiPrefix(raw)).toBe(expected);
  });
});

describe('applyApiPrefix', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  it('mounts routes under the prefix', async () => {
    app = await createApp('/api/v1/');
    const server = app.getHttpServer();

    await request(server).get('/api/v1/events').expect(200);
    await request(server).post('/api/v1/events').expect(201);
    await request(server).get('/events').expect(404);
  });

  it('keeps the health route at the root', async () => {
    app = await createApp('api');
    const server = app.getHttpServer();

    await request(server)
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', service: 'stellar-tickets-backend' });
    await request(server).get('/api/health').expect(404);
  });

  it('leaves routes unprefixed when API_PREFIX is unset', async () => {
    app = await createApp(undefined);
    const server = app.getHttpServer();

    await request(server).get('/events').expect(200);
    await request(server).get('/health').expect(200);
  });
});
