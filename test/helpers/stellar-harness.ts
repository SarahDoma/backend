import type { ConfigService } from '@nestjs/config';
import {
  Address,
  Keypair,
  Networks,
  scValToNative,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { StellarService } from '../../src/stellar/stellar.service';
import { createMockRpcServer, MockRpcServer } from '../mocks/soroban-rpc.mock';

export type StellarNetwork = 'testnet' | 'futurenet' | 'mainnet';

export const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
  mainnet: Networks.PUBLIC,
};

/** A syntactically valid contract id that never points at a deployed contract. */
export const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

export interface StellarHarnessOptions {
  network?: StellarNetwork;
  rpcUrl?: string;
  contractId?: string;
  server?: Partial<MockRpcServer>;
}

export interface StellarHarness {
  service: StellarService;
  /** The RPC double the service talks to; inspect or reprogram its mocks per test. */
  server: MockRpcServer;
  contractId: string;
  networkPassphrase: string;
  /** The disposable account read-only simulations run from. */
  platformSigner: Keypair;
}

/**
 * Boots a real `StellarService` from an in-memory config and swaps its
 * `rpc.Server` for {@link createMockRpcServer}, so transaction building,
 * XDR encoding and result decoding run for real while nothing touches the
 * network.
 */
export function createStellarHarness(
  options: StellarHarnessOptions = {},
): StellarHarness {
  const network = options.network ?? 'testnet';
  const platformSigner = Keypair.random();
  const env: Record<string, string> = {
    SOROBAN_RPC_URL: options.rpcUrl ?? 'http://soroban-rpc.test:8000',
    STELLAR_NETWORK: network,
    TICKETING_CONTRACT_ID: options.contractId ?? TEST_CONTRACT_ID,
    PLATFORM_SIGNER_SECRET: platformSigner.secret(),
  };
  const config = {
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      const value = env[key];
      if (value === undefined) {
        throw new Error(`Missing configuration key ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService;

  const service = new StellarService(config);
  const server = createMockRpcServer(options.server);
  // The constructor builds its own rpc.Server; replace it before any call.
  (service as unknown as { server: MockRpcServer }).server = server;

  return {
    service,
    server,
    contractId: env.TICKETING_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASES[network],
    platformSigner,
  };
}

export interface DecodedInvocation {
  /** Source account of the envelope, i.e. the wallet expected to sign it. */
  source: string;
  fee: string;
  networkPassphrase: string;
  contractId: string;
  functionName: string;
  /** Arguments decoded to native values (bigint, string, number). */
  args: unknown[];
  /** XDR discriminants of each argument, e.g. `scvAddress`, `scvU64`, `scvI128`. */
  argTypes: string[];
  timeBounds: { minTime: number; maxTime: number };
  signatureCount: number;
}

/**
 * Decodes an envelope from `build*Tx` (or a signed one on its way to
 * `submitSignedTransaction`) down to the single contract call it carries.
 * Throws when the envelope is not a one-operation `invokeHostFunction`
 * transaction, which is the only shape this service ever produces.
 */
export function decodeInvokeHostFunction(
  envelopeXdr: string,
  networkPassphrase: string,
): DecodedInvocation {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  if (!(tx instanceof Transaction)) {
    throw new Error('Expected a plain transaction, got a fee-bump envelope');
  }
  if (tx.operations.length !== 1) {
    throw new Error(`Expected one operation, got ${tx.operations.length}`);
  }
  const [operation] = tx.operations;
  if (operation.type !== 'invokeHostFunction') {
    throw new Error(`Expected invokeHostFunction, got ${operation.type}`);
  }
  const hostFunction = operation.func;
  if (
    hostFunction.switch() !==
    xdr.HostFunctionType.hostFunctionTypeInvokeContract()
  ) {
    throw new Error(
      `Expected a contract invocation, got ${hostFunction.switch().name}`,
    );
  }
  const invocation = hostFunction.invokeContract();
  const args = invocation.args();
  return {
    source: tx.source,
    fee: tx.fee,
    networkPassphrase: tx.networkPassphrase,
    contractId: Address.fromScAddress(invocation.contractAddress()).toString(),
    functionName: invocation.functionName().toString(),
    args: args.map((arg) => scValToNative(arg) as unknown),
    argTypes: args.map((arg) => arg.switch().name),
    timeBounds: {
      minTime: Number(tx.timeBounds?.minTime ?? 0),
      maxTime: Number(tx.timeBounds?.maxTime ?? 0),
    },
    signatureCount: tx.signatures.length,
  };
}

/** Signs an unsigned envelope the way a wallet would and returns the signed XDR. */
export function signAsWallet(
  envelopeXdr: string,
  networkPassphrase: string,
  wallet: Keypair,
): string {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  tx.sign(wallet);
  return tx.toXDR();
}
