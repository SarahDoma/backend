import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { SecretProvider } from '../config/secrets/secret-provider';
import { SecretsModule } from '../config/secrets/secrets.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from './auth.module';
import { JWT_SIGNING_SECRET, resolveJwtSecret } from './jwt-secret.module';
import { JwtStrategy } from './strategies/jwt.strategy';

function providerReturning(secret: string | undefined): SecretProvider {
  return { name: 'stub', getSecret: () => Promise.resolve(secret) };
}

describe('resolveJwtSecret', () => {
  const strongSecret = 'k3Jq9vX2pL7mN4bR8tY1wZ6cF0hG5dSa';

  it('returns the secret from the active provider', async () => {
    await expect(
      resolveJwtSecret(providerReturning(strongSecret), 'production'),
    ).resolves.toBe(strongSecret);
  });

  it('fails when the provider has no JWT_SECRET', async () => {
    await expect(
      resolveJwtSecret(providerReturning(undefined), 'development'),
    ).rejects.toThrow(/not found via the "stub" secret provider/);
  });

  it('applies the production strength rules to provider secrets', async () => {
    await expect(
      resolveJwtSecret(
        providerReturning('changeme-changeme-changeme-changeme'),
        'production',
      ),
    ).rejects.toThrow(/placeholder/);
  });

  it('enforces the minimum length in every environment', async () => {
    await expect(
      resolveJwtSecret(providerReturning('short'), 'development'),
    ).rejects.toThrow(/at least 32 characters/);
  });
});

@Injectable()
class VaultStubProvider implements SecretProvider {
  readonly name = 'vault-stub';

  getSecret(key: string): Promise<string | undefined> {
    return Promise.resolve(
      key === 'JWT_SECRET' ? 'v4ULt-9xQ2mZ7pK3rT8wB1nC6yH0dF5j' : undefined,
    );
  }
}

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class PrismaStubModule {}

describe('AuthModule secret wiring', () => {
  it('signs and verifies tokens with the secret from the active provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({ NODE_ENV: 'production', SECRETS_PROVIDER: 'custom' }),
          ],
        }),
        SecretsModule.forRoot({ provider: VaultStubProvider }),
        PrismaStubModule,
        AuthModule,
      ],
    }).compile();

    const secret = 'v4ULt-9xQ2mZ7pK3rT8wB1nC6yH0dF5j';
    expect(moduleRef.get(JWT_SIGNING_SECRET)).toBe(secret);

    const token = moduleRef.get(JwtService).sign({ sub: 'user-1' });
    expect(new JwtService().verify(token, { secret })).toMatchObject({
      sub: 'user-1',
    });
    expect(moduleRef.get(JwtStrategy)).toBeDefined();
  });
});
