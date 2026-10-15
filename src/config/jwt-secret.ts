export const JWT_SECRET_MIN_LENGTH = 32;

/** Minimum number of distinct characters a production secret must contain. */
const MIN_DISTINCT_CHARS = 10;

/**
 * Fragments of well-known placeholder / sample secrets. Matched against the
 * secret lower-cased with non-alphanumerics stripped, so `change-me`,
 * `CHANGE_ME` and `changeme` are all caught.
 */
const PLACEHOLDER_FRAGMENTS = [
  'changeme',
  'replaceme',
  'yoursecret',
  'yourjwtsecret',
  'jwtsecret',
  'secretkey',
  'mysecret',
  'placeholder',
  'example',
  'default',
  'insecure',
  'donotuse',
  'password',
];

/**
 * Problems with a JWT signing secret. Every environment enforces the minimum
 * length; production additionally rejects placeholder values and
 * low-variety strings (e.g. `x` repeated 32 times) that pass a length check
 * but are trivially guessable.
 */
export function getJwtSecretProblems(
  secret: string,
  nodeEnv: string,
): string[] {
  const problems: string[] = [];
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    problems.push(
      `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
    );
  }
  if (nodeEnv !== 'production') return problems;

  const normalized = secret.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fragment = PLACEHOLDER_FRAGMENTS.find((f) => normalized.includes(f));
  if (fragment) {
    problems.push(
      `JWT_SECRET looks like a placeholder (contains "${fragment}"); generate a random secret`,
    );
  }
  if (new Set(secret).size < MIN_DISTINCT_CHARS) {
    problems.push(
      `JWT_SECRET must contain at least ${MIN_DISTINCT_CHARS} distinct characters in production`,
    );
  }
  return problems;
}

/** Throws if `secret` fails {@link getJwtSecretProblems}. */
export function assertStrongJwtSecret(secret: string, nodeEnv: string): void {
  const problems = getJwtSecretProblems(secret, nodeEnv);
  if (problems.length > 0) {
    throw new Error(`Weak JWT secret: ${problems.join('; ')}`);
  }
}
