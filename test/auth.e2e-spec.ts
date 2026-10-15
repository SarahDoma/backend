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

// Requires a real DATABASE_URL (point it at a throwaway test database, as the
// CI `e2e-test` job does) — same constraint as the other e2e specs. Exercises
// the real JwtAuthGuard end to end: register -> login -> GET /users/me. Every
// account is created under a per-run email domain and deleted afterwards, so
// the suite leaves the database as it found it.
describe('Auth flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = randomUUID();
  const emailDomain = `auth-e2e-${runId}.test`;
  const email = `ada@${emailDomain}`;
  const password = 'correct-horse-battery';
  const name = 'Ada Lovelace';

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Auth never touches the chain; don't require a real Soroban config.
      .overrideProvider(StellarService)
      .useValue({})
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

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({
      where: { email: { endsWith: `@${emailDomain}` } },
    });
    await app?.close();
  });

  interface AuthBody {
    accessToken: string;
    user: { id: string; email: string; name: string; role: string };
  }

  describe('POST /v1/auth/register', () => {
    it('creates an account and returns a token without leaking the password hash', async () => {
      const res = await request(server())
        .post('/v1/auth/register')
        .send({ email, password, name })
        .expect(201);

      const body = res.body as AuthBody;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.user.id).toEqual(expect.any(String));
      expect(body.user).toEqual({
        id: body.user.id,
        email,
        name,
        role: 'ATTENDEE',
      });
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|\$2[aby]\$/);

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored).not.toBeNull();
      expect(stored?.passwordHash).not.toBe(password);
    });

    it('rejects a duplicate email with 409', async () => {
      await request(server())
        .post('/v1/auth/register')
        .send({ email, password, name })
        .expect(409);
    });

    it.each([
      ['an invalid email', { email: 'not-an-email' }],
      ['a password shorter than 10 characters', { password: 'short' }],
      ['an empty name', { name: '' }],
      ['an unknown field', { role: 'ADMIN' }],
    ])('rejects %s with 400 and creates no account', async (_label, patch) => {
      const candidate = `invalid-${randomUUID()}@${emailDomain}`;
      await request(server())
        .post('/v1/auth/register')
        .send({ email: candidate, password, name, ...patch })
        .expect(400);

      expect(
        await prisma.user.findUnique({ where: { email: candidate } }),
      ).toBeNull();
    });
  });

  describe('POST /v1/auth/login', () => {
    it('returns a token for valid credentials', async () => {
      const res = await request(server())
        .post('/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const body = res.body as AuthBody;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.user.email).toBe(email);
    });

    it('rejects a wrong password with 401', async () => {
      await request(server())
        .post('/v1/auth/login')
        .send({ email, password: 'wrong-password-123' })
        .expect(401);
    });

    it('rejects an unknown email with the same 401 message as a wrong password', async () => {
      const unknown = await request(server())
        .post('/v1/auth/login')
        .send({ email: `nobody@${emailDomain}`, password })
        .expect(401);
      const wrong = await request(server())
        .post('/v1/auth/login')
        .send({ email, password: 'wrong-password-123' })
        .expect(401);

      expect(unknown.body).toEqual(wrong.body);
    });

    it('rejects a malformed body with 400', async () => {
      await request(server())
        .post('/v1/auth/login')
        .send({ email: 'nope', password })
        .expect(400);
    });
  });

  describe('GET /v1/users/me', () => {
    it('returns the profile of the token holder', async () => {
      const login = await request(server())
        .post('/v1/auth/login')
        .send({ email, password })
        .expect(200);
      const { accessToken, user } = login.body as AuthBody;

      const res = await request(server())
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: user.id,
        email,
        name,
        role: 'ATTENDEE',
        stellarPublicKey: null,
      });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('rejects a request without a token with 401', async () => {
      await request(server()).get('/v1/users/me').expect(401);
    });

    it('rejects a malformed or tampered token with 401', async () => {
      await request(server())
        .get('/v1/users/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);

      const login = await request(server())
        .post('/v1/auth/login')
        .send({ email, password })
        .expect(200);
      const { accessToken } = login.body as AuthBody;
      await request(server())
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}x`)
        .expect(401);
    });
  });
});
