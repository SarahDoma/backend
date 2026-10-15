import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretProvider } from './secret-provider';

/** Default provider: reads the secret from the validated environment. */
@Injectable()
export class EnvSecretProvider implements SecretProvider {
  readonly name = 'env';

  constructor(private readonly config: ConfigService) {}

  getSecret(key: string): Promise<string | undefined> {
    return Promise.resolve(this.config.get<string>(key));
  }
}
