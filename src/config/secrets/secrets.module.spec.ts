import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SECRET_PROVIDER, SecretProvider } from './secret-provider';
import { SecretsModule, SecretsModuleOptions } from './secrets.module';

@Injectable()
class InMemorySecretProvider implements SecretProvider {
  readonly name = 'in-memory';

  getSecret(key: string): Promise<string | undefined> {
    return Promise.resolve(key === 'JWT_SECRET' ? 'from-vault' : undefined);
  }
}

async function resolveProvider(
  env: Record<string, string>,
  options?: SecretsModuleOptions,
): Promise<SecretProvider> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => env],
      }),
      SecretsModule.forRoot(options),
    ],
  }).compile();
  return moduleRef.get<SecretProvider>(SECRET_PROVIDER);
}

describe('SecretsModule', () => {
  it('defaults to the env provider', async () => {
    const provider = await resolveProvider({ JWT_SECRET: 'from-env' });

    expect(provider.name).toBe('env');
    await expect(provider.getSecret('JWT_SECRET')).resolves.toBe('from-env');
    await expect(provider.getSecret('MISSING')).resolves.toBeUndefined();
  });

  describe('file provider', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('reads <KEY>_FILE and trims the trailing newline', async () => {
      const path = join(dir, 'jwt');
      writeFileSync(path, 'from-file\n');
      const provider = await resolveProvider({
        SECRETS_PROVIDER: 'file',
        JWT_SECRET: 'ignored-env-value',
        JWT_SECRET_FILE: path,
      });

      expect(provider.name).toBe('file');
      await expect(provider.getSecret('JWT_SECRET')).resolves.toBe('from-file');
    });

    it('returns undefined when <KEY>_FILE is unset', async () => {
      const provider = await resolveProvider({ SECRETS_PROVIDER: 'file' });
      await expect(provider.getSecret('JWT_SECRET')).resolves.toBeUndefined();
    });

    it('fails clearly when the file cannot be read', async () => {
      const provider = await resolveProvider({
        SECRETS_PROVIDER: 'file',
        JWT_SECRET_FILE: join(dir, 'missing'),
      });
      await expect(provider.getSecret('JWT_SECRET')).rejects.toThrow(
        /Could not read JWT_SECRET from JWT_SECRET_FILE/,
      );
    });
  });

  it('uses a custom provider when SECRETS_PROVIDER=custom', async () => {
    const provider = await resolveProvider(
      { SECRETS_PROVIDER: 'custom' },
      { provider: InMemorySecretProvider },
    );

    expect(provider.name).toBe('in-memory');
    await expect(provider.getSecret('JWT_SECRET')).resolves.toBe('from-vault');
  });

  it('ignores a registered custom provider unless selected', async () => {
    const provider = await resolveProvider(
      { JWT_SECRET: 'from-env' },
      { provider: InMemorySecretProvider },
    );
    expect(provider.name).toBe('env');
  });

  it('fails boot when SECRETS_PROVIDER=custom has no provider', async () => {
    await expect(
      resolveProvider({ SECRETS_PROVIDER: 'custom' }),
    ).rejects.toThrow(/requires SecretsModule.forRoot/);
  });
});
