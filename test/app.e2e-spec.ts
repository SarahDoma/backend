import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Requires a real DATABASE_URL (and the rest of .env.example) — PrismaService
// connects on module init, so this is a genuine end-to-end check. Runs in CI
// via the `e2e-test` job, which provisions a Postgres service container (see
// .github/workflows/ci.yml).
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();
  });

  it('/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({ status: 'ok', service: 'stellar-tickets-backend' });
  });

  afterEach(async () => {
    await app.close();
  });
});
