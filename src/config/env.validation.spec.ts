import 'reflect-metadata';
import { validate } from './env.validation';

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    CORS_ORIGINS: 'http://localhost:3001,https://staging.example.com',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    STELLAR_NETWORK: 'testnet',
    TICKETING_CONTRACT_ID: 'C'.repeat(56),
    PLATFORM_SIGNER_SECRET: 'S'.repeat(56),
    OFFLINE_SIGNING_KEY_ID: '2026-01',
    OFFLINE_SIGNING_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
    OFFLINE_SIGNING_PUBLIC_KEYS:
      '{"2026-01":"-----BEGIN PUBLIC KEY-----\\nfake\\n-----END PUBLIC KEY-----\\n"}',
    ...overrides,
  };
}

describe('env.validate', () => {
  it('accepts a fully populated, well-formed config', () => {
    expect(() => validate(validConfig())).not.toThrow();
  });

  it('rejects an unrecognized NODE_ENV', () => {
    expect(() => validate(validConfig({ NODE_ENV: 'staging' }))).toThrow();
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => validate(validConfig({ JWT_SECRET: 'too-short' }))).toThrow();
  });

  it('rejects an unrecognized STELLAR_NETWORK', () => {
    expect(() =>
      validate(validConfig({ STELLAR_NETWORK: 'devnet' })),
    ).toThrow();
  });

  it('accepts a valid TRUST_PROXY and treats it as optional', () => {
    expect(() => validate(validConfig({ TRUST_PROXY: '1' }))).not.toThrow();
    expect(() =>
      validate(validConfig({ TRUST_PROXY: 'loopback,10.0.0.0/8' })),
    ).not.toThrow();
  });

  it('rejects a malformed TRUST_PROXY at boot', () => {
    expect(() => validate(validConfig({ TRUST_PROXY: 'on' }))).toThrow(
      /Invalid environment configuration: Invalid TRUST_PROXY entry "on"/,
    );
  });

  it('defaults to the in-memory rate-limit store without a REDIS_URL', () => {
    expect(() =>
      validate(validConfig({ RATE_LIMIT_STORE: 'memory' })),
    ).not.toThrow();
  });

  it('accepts the redis rate-limit store when REDIS_URL is set', () => {
    expect(() =>
      validate(
        validConfig({
          RATE_LIMIT_STORE: 'redis',
          REDIS_URL: 'redis://localhost:6379',
        }),
      ),
    ).not.toThrow();
  });

  it('requires REDIS_URL when the rate-limit store is redis', () => {
    expect(() =>
      validate(validConfig({ RATE_LIMIT_STORE: 'redis' })),
    ).toThrow();
  });

  it('rejects an unrecognized RATE_LIMIT_STORE', () => {
    expect(() =>
      validate(validConfig({ RATE_LIMIT_STORE: 'memcached' })),
    ).toThrow();
  });

  it('defaults to the in-memory cache without a REDIS_URL', () => {
    expect(() =>
      validate(validConfig({ CACHE_DRIVER: 'memory' })),
    ).not.toThrow();
  });

  it('accepts the redis cache driver when REDIS_URL is set', () => {
    expect(() =>
      validate(
        validConfig({
          CACHE_DRIVER: 'redis',
          REDIS_URL: 'redis://localhost:6379',
        }),
      ),
    ).not.toThrow();
  });

  it('requires REDIS_URL when the cache driver is redis', () => {
    expect(() => validate(validConfig({ CACHE_DRIVER: 'redis' }))).toThrow();
  });

  it('rejects an unrecognized CACHE_DRIVER', () => {
    expect(() =>
      validate(validConfig({ CACHE_DRIVER: 'memcached' })),
    ).toThrow();
  });

  it('leaves the webhook queue off, and Redis optional, by default', () => {
    expect(() => validate(validConfig())).not.toThrow();
    expect(() =>
      validate(validConfig({ WEBHOOK_QUEUE_ENABLED: 'false' })),
    ).not.toThrow();
  });

  it('requires REDIS_URL when the webhook queue is enabled', () => {
    expect(() =>
      validate(validConfig({ WEBHOOK_QUEUE_ENABLED: 'true' })),
    ).toThrow();
  });

  it('accepts an enabled webhook queue with a REDIS_URL and retry tuning', () => {
    expect(() =>
      validate(
        validConfig({
          WEBHOOK_QUEUE_ENABLED: 'true',
          REDIS_URL: 'redis://localhost:6379',
          WEBHOOK_QUEUE_ATTEMPTS: '8',
          WEBHOOK_QUEUE_BACKOFF_MS: '250',
        }),
      ),
    ).not.toThrow();
  });

  it('keeps WEBHOOK_QUEUE_ENABLED=false as the string "false"', () => {
    const validated = validate(validConfig({ WEBHOOK_QUEUE_ENABLED: 'false' }));

    expect(validated.WEBHOOK_QUEUE_ENABLED).toBe('false');
  });

  it('rejects a non-boolean WEBHOOK_QUEUE_ENABLED', () => {
    expect(() =>
      validate(validConfig({ WEBHOOK_QUEUE_ENABLED: 'yes' })),
    ).toThrow();
  });

  it('rejects a non-integer WEBHOOK_QUEUE_ATTEMPTS', () => {
    expect(() =>
      validate(validConfig({ WEBHOOK_QUEUE_ATTEMPTS: 'many' })),
    ).toThrow();
  });

  it.each(['true', 'false'])('accepts SCHEDULER_ENABLED=%s', (value) => {
    expect(() =>
      validate(validConfig({ SCHEDULER_ENABLED: value })),
    ).not.toThrow();
  });

  it('rejects a non-boolean SCHEDULER_ENABLED', () => {
    expect(() => validate(validConfig({ SCHEDULER_ENABLED: 'off' }))).toThrow();
  });

  it('accepts optional tracing configuration and rejects invalid flags', () => {
    expect(() =>
      validate(validConfig({ OTEL_TRACING_ENABLED: 'true' })),
    ).not.toThrow();
    expect(() =>
      validate(validConfig({ OTEL_TRACING_ENABLED: 'false' })),
    ).not.toThrow();
    expect(() =>
      validate(validConfig({ OTEL_TRACING_ENABLED: 'yes' })),
    ).toThrow();
  });

  it('rejects a missing required field', () => {
    const config = validConfig();
    delete (config as Record<string, unknown>).DATABASE_URL;
    expect(() => validate(config)).toThrow();
  });

  describe('API_PREFIX (#250)', () => {
    it.each(['api', '/api/v1/', 'v1.0', ''])('accepts %p', (API_PREFIX) => {
      expect(() => validate(validConfig({ API_PREFIX }))).not.toThrow();
    });

    it.each(['api v1', 'api//v1', 'api?x=1', '../api', 'api/./v1'])(
      'rejects %p',
      (API_PREFIX) => {
        expect(() => validate(validConfig({ API_PREFIX }))).toThrow(
          /API_PREFIX/,
        );
      },
    );
  });

  describe('JWT_SECRET strength (#251)', () => {
    const strongSecret = 'k3Jq9vX2pL7mN4bR8tY1wZ6cF0hG5dSa';

    it('accepts a random secret in production', () => {
      expect(() =>
        validate(
          validConfig({ NODE_ENV: 'production', JWT_SECRET: strongSecret }),
        ),
      ).not.toThrow();
    });

    it('rejects a short secret in production', () => {
      expect(() =>
        validate(validConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })),
      ).toThrow();
    });

    it.each([
      'changeme-changeme-changeme-changeme',
      'your-jwt-secret-goes-here-1234567890',
      'CHANGE_ME_TO_A_RANDOM_32_CHARACTER_VALUE',
      'super-secret-key-for-example-app-2026',
    ])('rejects the placeholder %p in production', (JWT_SECRET) => {
      expect(() =>
        validate(validConfig({ NODE_ENV: 'production', JWT_SECRET })),
      ).toThrow(/placeholder/);
    });

    it('rejects a low-variety secret in production', () => {
      expect(() =>
        validate(
          validConfig({ NODE_ENV: 'production', JWT_SECRET: 'ab'.repeat(20) }),
        ),
      ).toThrow(/distinct characters/);
    });

    it('allows placeholder-style secrets outside production', () => {
      expect(() =>
        validate(
          validConfig({
            NODE_ENV: 'development',
            JWT_SECRET: 'changeme-changeme-changeme-changeme',
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('SOROBAN_RPC_URL / STELLAR_NETWORK pairing (#252)', () => {
    it.each([
      ['https://soroban-testnet.stellar.org', 'testnet'],
      ['https://rpc-futurenet.stellar.org', 'futurenet'],
      ['https://mainnet.sorobanrpc.com', 'mainnet'],
      ['http://localhost:8000/soroban/rpc', 'testnet'],
      ['https://rpc.internal.example.net', 'mainnet'],
    ])('accepts %s on %s', (SOROBAN_RPC_URL, STELLAR_NETWORK) => {
      expect(() =>
        validate(validConfig({ SOROBAN_RPC_URL, STELLAR_NETWORK })),
      ).not.toThrow();
    });

    it.each([
      ['https://soroban-testnet.stellar.org', 'mainnet'],
      ['https://soroban-testnet.stellar.org', 'futurenet'],
      ['https://rpc-futurenet.stellar.org', 'testnet'],
      ['https://mainnet.sorobanrpc.com', 'testnet'],
    ])('rejects %s on %s', (SOROBAN_RPC_URL, STELLAR_NETWORK) => {
      expect(() =>
        validate(validConfig({ SOROBAN_RPC_URL, STELLAR_NETWORK })),
      ).toThrow(/wrong network passphrase/);
    });

    it('rejects an RPC URL that is not http(s)', () => {
      expect(() =>
        validate(validConfig({ SOROBAN_RPC_URL: 'ftp://rpc.example.com' })),
      ).toThrow(/http or https/);
    });

    it('rejects an RPC URL that does not parse', () => {
      expect(() =>
        validate(validConfig({ SOROBAN_RPC_URL: 'not a url' })),
      ).toThrow(/not a valid URL/);
    });
  });

  describe('SECRETS_PROVIDER (#253)', () => {
    it('defaults to env and requires JWT_SECRET', () => {
      const config = validConfig();
      delete (config as Record<string, unknown>).JWT_SECRET;
      expect(() => validate(config)).toThrow(/JWT_SECRET/);
    });

    it('with file, requires JWT_SECRET_FILE instead of JWT_SECRET', () => {
      const config = validConfig({ SECRETS_PROVIDER: 'file' });
      delete (config as Record<string, unknown>).JWT_SECRET;
      expect(() => validate(config)).toThrow(/JWT_SECRET_FILE/);
      expect(() =>
        validate({ ...config, JWT_SECRET_FILE: '/run/secrets/jwt' }),
      ).not.toThrow();
    });

    it('with file, ignores a leftover empty JWT_SECRET', () => {
      expect(() =>
        validate(
          validConfig({
            NODE_ENV: 'production',
            SECRETS_PROVIDER: 'file',
            JWT_SECRET: '',
            JWT_SECRET_FILE: '/run/secrets/jwt',
          }),
        ),
      ).not.toThrow();
    });

    it('with custom, requires neither', () => {
      const config = validConfig({ SECRETS_PROVIDER: 'custom' });
      delete (config as Record<string, unknown>).JWT_SECRET;
      expect(() => validate(config)).not.toThrow();
    });

    it('rejects an unknown provider', () => {
      expect(() =>
        validate(validConfig({ SECRETS_PROVIDER: 'vault' })),
      ).toThrow();
    });
  });

  describe('CORS_ORIGINS', () => {
    it('accepts comma-separated origins', () => {
      expect(() =>
        validate(
          validConfig({
            CORS_ORIGINS: 'https://app.example.com,https://staging.example.com',
          }),
        ),
      ).not.toThrow();
    });

    it('accepts single origin', () => {
      expect(() =>
        validate(validConfig({ CORS_ORIGINS: 'https://app.example.com' })),
      ).not.toThrow();
    });

    it('rejects wildcard in production', () => {
      expect(() =>
        validate(
          validConfig({
            NODE_ENV: 'production',
            JWT_SECRET: 'k3Jq9vX2pL7mN4bR8tY1wZ6cF0hG5dSa',
            CORS_ORIGINS: '*',
          }),
        ),
      ).toThrow('wildcard (*) is not allowed in production');
    });

    it('accepts wildcard in development', () => {
      expect(() =>
        validate(
          validConfig({
            NODE_ENV: 'development',
            CORS_ORIGINS: '*',
          }),
        ),
      ).not.toThrow();
    });

    it('accepts wildcard in test', () => {
      expect(() =>
        validate(
          validConfig({
            NODE_ENV: 'test',
            CORS_ORIGINS: '*',
          }),
        ),
      ).not.toThrow();
    });
  });
});
