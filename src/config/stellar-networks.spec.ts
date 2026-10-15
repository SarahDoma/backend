import {
  getRpcNetworkProblems,
  inferNetworkFromRpcUrl,
} from './stellar-networks';

describe('inferNetworkFromRpcUrl', () => {
  it.each([
    ['https://soroban-testnet.stellar.org', 'testnet'],
    ['https://soroban-testnet.stellar.org:443/', 'testnet'],
    ['https://rpc-futurenet.stellar.org', 'futurenet'],
    ['https://mainnet.sorobanrpc.com', 'mainnet'],
    ['https://soroban-rpc.pubnet.example.io', 'mainnet'],
    ['https://rpc.ankr.com/stellar_testnet_soroban', 'testnet'],
  ])('infers %s as %s', (url, network) => {
    expect(inferNetworkFromRpcUrl(url)).toBe(network);
  });

  it.each([
    'http://localhost:8000/soroban/rpc',
    'https://rpc.internal.example.net',
    'https://testnet-to-mainnet-bridge.example.com',
    'not a url',
  ])('returns undefined for %s', (url) => {
    expect(inferNetworkFromRpcUrl(url)).toBeUndefined();
  });

  it('does not match network names embedded in longer words', () => {
    expect(inferNetworkFromRpcUrl('https://mytestnetwork.example.com')).toBe(
      undefined,
    );
  });
});

describe('getRpcNetworkProblems', () => {
  it('reports nothing for a matching pair', () => {
    expect(
      getRpcNetworkProblems('https://soroban-testnet.stellar.org', 'testnet'),
    ).toEqual([]);
  });

  it('reports the mismatch for a bad pair', () => {
    const [problem] = getRpcNetworkProblems(
      'https://soroban-testnet.stellar.org',
      'mainnet',
    );
    expect(problem).toContain('serves testnet');
    expect(problem).toContain('"mainnet"');
  });
});
