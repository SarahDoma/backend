import 'reflect-metadata';
import { Controller, Get, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';

// See tickets.service.spec.ts for why StellarService is mocked at the
// module level rather than imported for real.
jest.mock('./stellar/stellar.service', () => ({ StellarService: jest.fn() }));

import { configureApp } from './app.setup';
import { CACHE_STORE } from './common/cache/cache-store';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';

@Controller('test')
class IpEchoController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

function ipOf(res: request.Response): string | undefined {
  return (res.body as { ip?: string }).ip;
}

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

async function createApp(
  env: Record<string, string> = {},
): Promise<{ app: NestExpressApplication; findPublished: jest.Mock }> {
  const findPublished = jest.fn();
  const moduleRef = await Test.createTestingModule({
    controllers: [EventsController, IpEchoController],
    providers: [
      { provide: EventsService, useValue: { findPublished } },
      // The listing's response cache always misses, so every request reaches
      // the mocked service.
      {
        provide: CACHE_STORE,
        useValue: {
          get: jest.fn().mockResolvedValue(undefined),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((_key: string, fallback: unknown) => fallback),
        },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(
    app,
    configWith({ CORS_ORIGINS: 'http://localhost:3001', ...env }),
  );
  await app.init();
  return { app, findPublished };
}

describe('configureApp', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /events pagination', () => {
    it('returns a Paginated body built from the requested page', async () => {
      const created = await createApp();
      app = created.app;
      created.findPublished.mockResolvedValue([[{ id: 'event-3' }], 3]);

      const res = await request(app.getHttpServer())
        .get('/v1/events?page=3&limit=1')
        .expect(200);

      expect(created.findPublished).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, limit: 1 }),
      );
      expect(res.body).toEqual({
        items: [{ id: 'event-3' }],
        total: 3,
        page: 3,
        limit: 1,
      });
    });

    it('defaults to page 1 of 20', async () => {
      const created = await createApp();
      app = created.app;
      created.findPublished.mockResolvedValue([[], 0]);

      const res = await request(app.getHttpServer())
        .get('/v1/events')
        .expect(200);

      expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    });

    it('rejects a limit above the maximum with 400', async () => {
      const created = await createApp();
      app = created.app;

      await request(app.getHttpServer())
        .get('/v1/events?limit=101')
        .expect(400);
      expect(created.findPublished).not.toHaveBeenCalled();
    });
  });

  describe('ETags', () => {
    it('sends a weak ETag and answers a matching If-None-Match with 304', async () => {
      const created = await createApp();
      app = created.app;
      created.findPublished.mockResolvedValue([[{ id: 'event-1' }], 1]);

      const first = await request(app.getHttpServer())
        .get('/v1/events')
        .expect(200);
      const etag = first.headers['etag'];
      expect(etag).toMatch(/^W\/".+"$/);

      const second = await request(app.getHttpServer())
        .get('/v1/events')
        .set('If-None-Match', etag)
        .expect(304);
      expect(second.text).toBe('');
    });

    it('returns 200 with a new ETag once the listing changes', async () => {
      const created = await createApp();
      app = created.app;
      created.findPublished.mockResolvedValue([[{ id: 'event-1' }], 1]);

      const first = await request(app.getHttpServer()).get('/v1/events');

      created.findPublished.mockResolvedValue([
        [{ id: 'event-1' }, { id: 'event-2' }],
        2,
      ]);
      const second = await request(app.getHttpServer())
        .get('/v1/events')
        .set('If-None-Match', first.headers['etag'])
        .expect(200);

      expect(second.headers['etag']).toMatch(/^W\//);
      expect(second.headers['etag']).not.toBe(first.headers['etag']);
      expect((second.body as { total: number }).total).toBe(2);
    });
  });

  describe('trust proxy', () => {
    it('ignores X-Forwarded-For by default', async () => {
      ({ app } = await createApp());

      const res = await request(app.getHttpServer())
        .get('/v1/test/ip')
        .set('X-Forwarded-For', '203.0.113.7');

      expect(ipOf(res)).not.toBe('203.0.113.7');
    });

    it('uses the client IP from X-Forwarded-For when TRUST_PROXY trusts the hop', async () => {
      ({ app } = await createApp({ TRUST_PROXY: '1' }));

      const res = await request(app.getHttpServer())
        .get('/v1/test/ip')
        .set('X-Forwarded-For', '203.0.113.7');

      expect(ipOf(res)).toBe('203.0.113.7');
    });

    it('only trusts the listed proxy addresses', async () => {
      ({ app } = await createApp({ TRUST_PROXY: '10.0.0.0/8' }));

      const res = await request(app.getHttpServer())
        .get('/v1/test/ip')
        .set('X-Forwarded-For', '203.0.113.7');

      // supertest connects over loopback, which is not in 10.0.0.0/8.
      expect(ipOf(res)).not.toBe('203.0.113.7');
    });

    it('applies the parsed setting to Express', async () => {
      ({ app } = await createApp({ TRUST_PROXY: 'loopback' }));
      expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(
        'loopback',
      );

      const res = await request(app.getHttpServer())
        .get('/v1/test/ip')
        .set('X-Forwarded-For', '203.0.113.7');
      expect(ipOf(res)).toBe('203.0.113.7');
    });
  });
});
