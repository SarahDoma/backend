import { Networks } from '@stellar/stellar-sdk';

export const STELLAR_NETWORKS = ['testnet', 'futurenet', 'mainnet'] as const;
export type StellarNetwork = (typeof STELLAR_NETWORKS)[number];

/**
 * Passphrase every transaction is signed against for each supported
 * `STELLAR_NETWORK`. The backend never takes a passphrase from config — it is
 * always derived from the network name, so the RPC endpoint is the only other
 * half of the pairing that can drift.
 */
export const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
  mainnet: Networks.PUBLIC,
};

/** Host/path tokens that identify which network an RPC endpoint serves. */
const NETWORK_URL_TOKENS: Record<string, StellarNetwork> = {
  testnet: 'testnet',
  futurenet: 'futurenet',
  mainnet: 'mainnet',
  pubnet: 'mainnet',
};

/**
 * Infers the network a Soroban RPC URL serves from well-known naming, e.g.
 * `soroban-testnet.stellar.org`, `rpc-futurenet.stellar.org` or
 * `mainnet.sorobanrpc.com`. Returns `undefined` when the URL names no network
 * (a self-hosted or local node) or names more than one, so only an
 * unambiguous mismatch is ever reported.
 */
export function inferNetworkFromRpcUrl(
  rpcUrl: string,
): StellarNetwork | undefined {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    return undefined;
  }
  const tokens = `${url.hostname}${url.pathname}`
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const found = new Set<StellarNetwork>();
  for (const token of tokens) {
    const network = NETWORK_URL_TOKENS[token];
    if (network) found.add(network);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * Problems with the `SOROBAN_RPC_URL` / `STELLAR_NETWORK` pairing. A mismatch
 * means transactions would be built and signed with one network's passphrase
 * but simulated and submitted against another, so it must fail boot.
 */
export function getRpcNetworkProblems(
  rpcUrl: string,
  network: string,
): string[] {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    return [`SOROBAN_RPC_URL "${rpcUrl}" is not a valid URL`];
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return [`SOROBAN_RPC_URL must use http or https, got "${url.protocol}"`];
  }
  const inferred = inferNetworkFromRpcUrl(rpcUrl);
  if (inferred && inferred !== network) {
    return [
      `SOROBAN_RPC_URL "${rpcUrl}" serves ${inferred} but STELLAR_NETWORK is ` +
        `"${network}"; transactions would be signed with the wrong network passphrase`,
    ];
  }
  return [];
}
