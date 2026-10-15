/** Injection token for the active {@link SecretProvider}. */
export const SECRET_PROVIDER = Symbol('SECRET_PROVIDER');

export const SECRET_PROVIDER_KINDS = ['env', 'file', 'custom'] as const;
export type SecretProviderKind = (typeof SECRET_PROVIDER_KINDS)[number];

/**
 * Source of sensitive values such as `JWT_SECRET`. The default reads plain
 * environment variables; swap it for a secrets manager (Vault, AWS Secrets
 * Manager, GCP Secret Manager, …) by implementing this interface and passing
 * it to `SecretsModule.forRoot({ provider })`. See docs/CONFIGURATION.md.
 */
export interface SecretProvider {
  /** Short name used in error messages, e.g. `env`. */
  readonly name: string;
  /** Returns the secret stored under `key`, or `undefined` if absent. */
  getSecret(key: string): Promise<string | undefined>;
}
