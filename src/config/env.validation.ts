import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';
import { API_PREFIX_PATTERN } from './api-prefix';
import { getJwtSecretProblems, JWT_SECRET_MIN_LENGTH } from './jwt-secret';
import { SECRET_PROVIDER_KINDS } from './secrets/secret-provider';
import { getRpcNetworkProblems, STELLAR_NETWORKS } from './stellar-networks';
import { parseTrustProxy } from './trust-proxy';

class EnvironmentVariables {
  /// Which NestJS environment the app runs in. Drives logging verbosity and
  /// whether development-only behaviour is enabled.
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: string;

  /// Opt in to HTTP/NestJS OpenTelemetry spans. Off unless literally 'true'.
  /// See docs/TRACING.md.
  @IsIn(['true', 'false'])
  @IsOptional()
  OTEL_TRACING_ENABLED?: string;

  /// Service name attached to exported spans; defaults to stellar-tickets-backend.
  @IsString()
  @IsOptional()
  OTEL_SERVICE_NAME?: string;

  /// OTLP HTTP trace collector URL. Defaults to http://localhost:4318/v1/traces.
  @IsString()
  @IsOptional()
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;

  /// TCP port the HTTP server binds. Match it to the `port` in docker-compose.yml
  /// when running the API in a container.
  @IsInt()
  PORT!: number;

  /// Optional path every route is mounted under (e.g. `api/v1`), for hosting
  /// behind a reverse-proxy path. Health routes stay at the root.
  @IsOptional()
  @Matches(API_PREFIX_PATTERN, {
    message: 'API_PREFIX must be URL path segments such as "api" or "api/v1"',
  })
  API_PREFIX?: string;

  /// Soft cap on how many `ACTIVE` resale listings one seller may hold at
  /// once. Listing beyond it is rejected, not queued. See docs/RESALE_EXPIRY.md.
  @IsInt()
  @IsOptional()
  MAX_ACTIVE_RESALE_LISTINGS_PER_USER?: number;

  /// PostgreSQL connection string for the Prisma client. This is the single
  /// system of record; see docs/DATABASE.md.
  @IsString()
  DATABASE_URL!: string;

  /// Where rate-limit counters live. `memory` (default) is per-process;
  /// `redis` shares them across instances. See docs/RATE_LIMITING.md.
  @IsIn(['memory', 'redis'])
  @IsOptional()
  RATE_LIMIT_STORE?: string;

  /// Where cached entries live. `memory` (default) is per-process; `redis`
  /// shares them across instances. See docs/CACHING.md.
  @IsIn(['memory', 'redis'])
  @IsOptional()
  CACHE_DRIVER?: string;

  /// Default time-to-live, in seconds, for entries written by the response
  /// cache interceptor on public event listings. Default 60. See
  /// docs/CACHING.md.
  @IsInt()
  @IsOptional()
  CACHE_TTL_SECONDS?: number;

  /// Enables the BullMQ-backed outbound webhook queue. Kept as the literal
  /// strings 'true'/'false' (like the feature flags) because implicit
  /// conversion would turn the string 'false' into boolean true. Off unless
  /// 'true'. See docs/WEBHOOKS.md.
  @IsIn(['true', 'false'])
  @IsOptional()
  WEBHOOK_QUEUE_ENABLED?: string;

  /// Total delivery attempts per webhook, the first included. Default 5.
  @IsInt()
  @IsOptional()
  WEBHOOK_QUEUE_ATTEMPTS?: number;

  /// Delay before the first webhook retry, doubling on each further retry.
  /// Default 5000.
  @IsInt()
  @IsOptional()
  WEBHOOK_QUEUE_BACKOFF_MS?: number;

  /// Set to 'false' to switch off every cron job registered through
  /// SchedulerModule. On unless 'false'. See docs/SCHEDULER.md.
  @IsIn(['true', 'false'])
  @IsOptional()
  SCHEDULER_ENABLED?: string;

  /// Redis connection URL (e.g. redis://localhost:6379). Required when
  /// RATE_LIMIT_STORE=redis, CACHE_DRIVER=redis or WEBHOOK_QUEUE_ENABLED=true.
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.RATE_LIMIT_STORE === 'redis' ||
      env.CACHE_DRIVER === 'redis' ||
      env.WEBHOOK_QUEUE_ENABLED === 'true',
  )
  @IsString()
  REDIS_URL?: string;

  /// Where secrets such as JWT_SECRET are read from: `env` (default),
  /// `file` (`<KEY>_FILE` paths) or `custom` (a provider passed to
  /// `SecretsModule.forRoot`). See docs/CONFIGURATION.md.
  @IsOptional()
  @IsIn(SECRET_PROVIDER_KINDS)
  SECRETS_PROVIDER?: string;

  /// Required when SECRETS_PROVIDER is `env` (the default).
  @ValidateIf((o: EnvironmentVariables) => secretsProvider(o) === 'env')
  @IsString()
  @MinLength(JWT_SECRET_MIN_LENGTH)
  JWT_SECRET?: string;

  /// Path of the file holding JWT_SECRET; required when SECRETS_PROVIDER=file.
  @ValidateIf((o: EnvironmentVariables) => secretsProvider(o) === 'file')
  @IsString()
  JWT_SECRET_FILE?: string;

  /// Comma-separated list of allowed CORS origins (e.g. "https://app.example.com,https://staging.example.com").
  /// Wildcard (*) is NOT allowed in production. Used as the CORS allow-list
  /// and to build links in outbound email/webhooks.
  @IsString()
  CORS_ORIGINS!: string;

  /// Maximum accepted JSON request body, as an Express size string such as
  /// 100kb or 1mb. Larger payloads are rejected with 413. Default 100kb.
  @IsString()
  @IsOptional()
  JSON_BODY_LIMIT?: string;

  /// Helmet Content-Security-Policy directives as a JSON object string, e.g.
  /// {"defaultSrc":["'self'"]}. Leave unset to keep helmet's defaults.
  @IsString()
  @IsOptional()
  CSP_DIRECTIVES?: string;

  /// Express `trust proxy` setting: `true`, `false`, a hop count, or a
  /// comma-separated list of proxy IPs / CIDR ranges. Unset means `false`.
  /// See docs/DEPLOYMENT.md.
  @IsString()
  @IsOptional()
  TRUST_PROXY?: string;

  /// Soroban RPC endpoint the StellarService submits contract calls through.
  @IsString()
  SOROBAN_RPC_URL!: string;

  /// Which Stellar network every contract call targets. Must match the network
  /// the `ticketing` contract is deployed on and the one user wallets are set
  @IsIn(STELLAR_NETWORKS)
  STELLAR_NETWORK!: string;

  /// Deployed `ticketing` contract's C... address.
  @IsString()
  TICKETING_CONTRACT_ID!: string;

  /// Platform signer used for contract calls submitted on behalf of the
  /// backend itself (e.g. relaying an organizer's already-authorized op).
  @IsString()
  PLATFORM_SIGNER_SECRET!: string;

  /// Key id of the Ed25519 key currently used to sign offline verification
  /// tokens. Must have a matching entry in OFFLINE_SIGNING_PUBLIC_KEYS.
  @IsString()
  OFFLINE_SIGNING_KEY_ID!: string;

  /// PEM-encoded Ed25519 private key used to sign offline verification
  /// tokens. See docs/OFFLINE_VERIFICATION.md for generation and rotation.
  @IsString()
  OFFLINE_SIGNING_PRIVATE_KEY!: string;

  /// JSON map of key id -> PEM-encoded Ed25519 public key. Every key a
  /// scanner should still accept, current and retired, so tokens signed
  /// before a rotation keep verifying until they expire.
  @IsString()
  OFFLINE_SIGNING_PUBLIC_KEYS!: string;

  /// How long a PendingTx row (build-transaction intent) stays valid before
  /// it's considered expired and eligible for cleanup.
  @IsInt()
  @IsOptional()
  PENDING_TX_RETENTION_MINUTES?: number;

  /// How often the PendingTx cleanup job runs, in minutes.
  @IsInt()
  @IsOptional()
  PENDING_TX_CLEANUP_INTERVAL_MINUTES?: number;

  /// How long a cached response for an Idempotency-Key stays valid, in
  /// minutes, before a repeated key is treated as a new request.
  @IsInt()
  @IsOptional()
  IDEMPOTENCY_KEY_TTL_MINUTES?: number;
}

function secretsProvider(env: EnvironmentVariables): string {
  return env.SECRETS_PROVIDER ?? 'env';
}

/** Checks that span several variables, run once each field is well-formed. */
function crossFieldProblems(env: EnvironmentVariables): string[] {
  const problems = getRpcNetworkProblems(
    env.SOROBAN_RPC_URL,
    env.STELLAR_NETWORK,
  );
  // Secrets resolved through another provider are checked when the provider
  // resolves them (see src/auth/jwt-secret.module.ts).
  if (secretsProvider(env) === 'env' && env.JWT_SECRET !== undefined) {
    problems.push(...getJwtSecretProblems(env.JWT_SECRET, env.NODE_ENV));
  }
  return problems;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }

  const problems = crossFieldProblems(validated);
  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration: ${problems.join('; ')}`,
    );
  }

  const corsOrigins = validated.CORS_ORIGINS.split(',').map((o) => o.trim());
  if (validated.NODE_ENV === 'production' && corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGINS wildcard (*) is not allowed in production');
  }

  try {
    parseTrustProxy(validated.TRUST_PROXY);
  } catch (error) {
    throw new Error(
      `Invalid environment configuration: ${(error as Error).message}`,
    );
  }

  return validated;
}
