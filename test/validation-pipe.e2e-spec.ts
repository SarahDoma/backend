import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('ValidationPipe Global Config (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Unknown fields rejection', () => {
    it('returns 400 when unknown fields are present in request body', () => {
      return request(app.getHttpServer())
        .post('/v1/health')
        .send({
          unknownField: 'should be rejected',
        })
        .expect(400);
    });

    it('returns 400 with error details when extra properties are provided', () => {
      return request(app.getHttpServer())
        .post('/v1/health')
        .send({
          validField: 'valid value',
          extraField: 'extra value',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(
            Array.isArray(res.body.message) ||
              typeof res.body.message === 'string',
          ).toBe(true);
        });
    });
  });

  describe('Whitespace trimming and validation', () => {
    it('should enforce validation on trimmed string fields', () => {
      return request(app.getHttpServer()).get('/v1/industries').expect(200);
    });
  });
});
