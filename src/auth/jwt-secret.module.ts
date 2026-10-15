import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertStrongJwtSecret } from '../config/jwt-secret';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../config/secrets/secret-provider';

/** Injection token for the resolved JWT signing secret. */
export const JWT_SIGNING_SECRET = Symbol('JWT_SIGNING_SECRET');

/**
 * Resolves `JWT_SECRET` once at boot through the active secret provider and
 * applies the same strength rules as env validation, so a weak secret fails
 * startup whichever provider supplied it.
 */
export async function resolveJwtSecret(
  provider: SecretProvider,
  nodeEnv: string,
): Promise<string> {
  const secret = await provider.getSecret('JWT_SECRET');
  if (!secret) {
    throw new Error(
      `JWT_SECRET was not found via the "${provider.name}" secret provider`,
    );
  }
  assertStrongJwtSecret(secret, nodeEnv);
  return secret;
}

@Module({
  providers: [
    {
      provide: JWT_SIGNING_SECRET,
      inject: [SECRET_PROVIDER, ConfigService],
      useFactory: (provider: SecretProvider, config: ConfigService) =>
        resolveJwtSecret(provider, config.getOrThrow<string>('NODE_ENV')),
    },
  ],
  exports: [JWT_SIGNING_SECRET],
})
export class JwtSecretModule {}
