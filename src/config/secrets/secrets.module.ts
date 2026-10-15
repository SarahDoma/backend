import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvSecretProvider } from './env-secret.provider';
import { FileSecretProvider } from './file-secret.provider';
import {
  SECRET_PROVIDER,
  SecretProvider,
  SecretProviderKind,
} from './secret-provider';

export interface SecretsModuleOptions {
  /**
   * Custom provider class, e.g. a Vault or AWS Secrets Manager client. It is
   * instantiated by Nest, so it may inject `ConfigService` or anything else
   * that is globally available. Requires `SECRETS_PROVIDER=custom`.
   */
  provider?: Type<SecretProvider>;
}

/**
 * Exposes the active {@link SecretProvider} under {@link SECRET_PROVIDER},
 * selected by `SECRETS_PROVIDER` (`env` by default, or `file`). Pass
 * `provider` to plug in a secrets manager with `SECRETS_PROVIDER=custom`.
 */
@Global()
@Module({})
export class SecretsModule {
  static forRoot(options: SecretsModuleOptions = {}): DynamicModule {
    const custom = options.provider;
    const providers: Provider[] = [EnvSecretProvider, FileSecretProvider];
    const inject: Type<unknown>[] = [
      ConfigService,
      EnvSecretProvider,
      FileSecretProvider,
    ];
    if (custom) {
      providers.push(custom);
      inject.push(custom);
    }

    providers.push({
      provide: SECRET_PROVIDER,
      inject,
      useFactory: (
        config: ConfigService,
        env: EnvSecretProvider,
        file: FileSecretProvider,
        customInstance?: SecretProvider,
      ): SecretProvider => {
        const kind =
          config.get<SecretProviderKind>('SECRETS_PROVIDER') ?? 'env';
        if (kind === 'file') return file;
        if (kind === 'custom') {
          if (!customInstance) {
            throw new Error(
              'SECRETS_PROVIDER=custom requires SecretsModule.forRoot({ provider })',
            );
          }
          return customInstance;
        }
        return env;
      },
    });

    return {
      module: SecretsModule,
      providers,
      exports: [SECRET_PROVIDER],
    };
  }
}
