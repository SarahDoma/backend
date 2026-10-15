import { isIP } from 'node:net';

/** Value accepted by Express's `app.set('trust proxy', ...)`. */
export type TrustProxySetting = boolean | number | string;

const PRESETS = ['loopback', 'linklocal', 'uniquelocal'];

function isValidEntry(entry: string): boolean {
  if (PRESETS.includes(entry)) return true;
  if (isIP(entry)) return true;

  const [address, range, ...rest] = entry.split('/');
  if (rest.length > 0 || !address || !range) return false;
  const family = isIP(address);
  if (!family) return false;
  // `ip/netmask` form, e.g. 10.0.0.0/255.0.0.0
  if (isIP(range) === family) return true;
  if (!/^\d+$/.test(range)) return false;
  return Number(range) <= (family === 4 ? 32 : 128);
}

/**
 * Parse `TRUST_PROXY` into Express's `trust proxy` setting:
 *
 * - unset / empty / `false` → `false` (default: ignore `X-Forwarded-*`)
 * - `true` → trust every hop (only safe when the app is unreachable except
 *   through the proxy — any client can otherwise spoof its IP)
 * - an integer `n` → trust the `n` nearest hops
 * - a comma-separated list of IPs, CIDR ranges and the presets
 *   `loopback`, `linklocal`, `uniquelocal`
 *
 * Throws on anything else so a typo fails at boot instead of silently
 * leaving every request keyed to the proxy's IP.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);

  const entries = value.split(',').map((entry) => entry.trim());
  const invalid = entries.find((entry) => !isValidEntry(entry));
  if (invalid !== undefined) {
    throw new Error(
      `Invalid TRUST_PROXY entry "${invalid}": expected true, false, a hop count, or a comma-separated list of IPs, CIDR ranges, loopback, linklocal, uniquelocal`,
    );
  }
  return entries.join(',');
}
