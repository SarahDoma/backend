import { INestApplication, RequestMethod } from '@nestjs/common';

/**
 * Routes that stay at the root when `API_PREFIX` is set, so load balancer and
 * orchestrator probes keep working regardless of the public path.
 */
export const API_PREFIX_EXCLUDED_ROUTES = [
  { path: 'health', method: RequestMethod.ALL },
];

/**
 * Matches `api`, `/api/v1/`, `v1.0`, … — URL-safe path segments only, and
 * never a `.` or `..` segment.
 */
export const API_PREFIX_PATTERN =
  /^(\/?(?!\.\.?(?:\/|$))[A-Za-z0-9._~-]+(\/(?!\.\.?(?:\/|$))[A-Za-z0-9._~-]+)*\/?)?$/;

/** Strips surrounding slashes; returns `undefined` for an empty prefix. */
export function normalizeApiPrefix(raw?: string): string | undefined {
  const prefix = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  return prefix.length > 0 ? prefix : undefined;
}

/**
 * Mounts every route under `API_PREFIX` (e.g. `API_PREFIX=api/v1` serves
 * `POST /auth/login` as `POST /api/v1/auth/login`), except the health routes.
 * Must run before `app.init()` / `app.listen()`. No-op when unset.
 */
export function applyApiPrefix(app: INestApplication, raw?: string): void {
  const prefix = normalizeApiPrefix(raw);
  if (prefix) {
    app.setGlobalPrefix(prefix, { exclude: API_PREFIX_EXCLUDED_ROUTES });
  }
}
