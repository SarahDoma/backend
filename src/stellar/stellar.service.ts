import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  rpc,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';
import { CircuitBreaker } from './circuit-breaker';
import {
  NETWORK_PASSPHRASES,
  StellarNetwork,
} from '../config/stellar-networks';

export interface OnChainTicket {
  eventId: bigint;
  owner: string;
  tier: string;
  seat: string;
  status: 'Valid' | 'Used' | 'Revoked' | 'Resale';
  originalPrice: bigint;
  resalePrice: bigint;
}

export interface OnChainEvent {
  eventId: bigint;
  organizer: string;
  name: string;
  category: string;
  maxResaleMultiplierBps: number;
  royaltyBps: number;
  ticketsIssued: bigint;
}

/**
 * Wrapper around the `ticketing` Soroban contract. This service never holds
 * a user's Stellar secret key — the platform is non-custodial by design.
 * Every write is a two-step "build then submit" flow:
 *
 *   1. `build*Tx(...)` simulates the call against the user's own public key
 *      as the source account and returns an unsigned, fee-prepared XDR
 *      envelope for the caller's wallet (Freighter, etc.) to sign.
 *   2. `submitSignedTransaction(signedXdr)` relays the wallet-signed
 *      envelope to the network and polls it through to completion.
 *
 * `PLATFORM_SIGNER` is used only as a disposable source account for
 * read-only simulations (`verifyTicket`, `getEvent`) — those contract
 * functions never call `require_auth`, so no signature from it is ever
 * required or requested.
 */
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly networkPassphrase: string;
  private readonly platformSigner: Keypair;
  private readonly rpcCircuitBreaker = new CircuitBreaker();

  constructor(private readonly config: ConfigService) {
    const rpcUrl = this.config.getOrThrow<string>('SOROBAN_RPC_URL');
    const network = this.config.getOrThrow<StellarNetwork>('STELLAR_NETWORK');
    this.server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith('http://'),
    });
    this.contract = new Contract(
      this.config.getOrThrow<string>('TICKETING_CONTRACT_ID'),
    );
    this.networkPassphrase = NETWORK_PASSPHRASES[network];
    this.platformSigner = Keypair.fromSecret(
      this.config.getOrThrow<string>('PLATFORM_SIGNER_SECRET'),
    );
  }

  getCircuitBreakerMetrics() {
    return this.rpcCircuitBreaker.metrics();
  }

  /** Read-only simulation — no signature, no ledger write, no fee. */
  async verifyTicket(chainTicketId: bigint): Promise<OnChainTicket> {
    const result = await this.simulateRead('verify_ticket', [
      nativeToScVal(chainTicketId, { type: 'u64' }),
    ]);
    return this.decodeTicket(result);
  }

  async getEvent(chainEventId: bigint): Promise<OnChainEvent> {
    const result = await this.simulateRead('get_event', [
      nativeToScVal(chainEventId, { type: 'u64' }),
    ]);
    return { eventId: chainEventId, ...this.decodeEvent(result) };
  }

  buildCreateEventTx(params: {
    organizerPublicKey: string;
    chainEventId: bigint;
    name: string;
    category: string;
    maxResaleMultiplierBps: number;
    royaltyBps: number;
  }): Promise<string> {
    return this.buildTx(params.organizerPublicKey, 'create_event', [
      new Address(params.organizerPublicKey).toScVal(),
      nativeToScVal(params.chainEventId, { type: 'u64' }),
      nativeToScVal(params.name, { type: 'string' }),
      nativeToScVal(params.category, { type: 'string' }),
      nativeToScVal(params.maxResaleMultiplierBps, { type: 'u32' }),
      nativeToScVal(params.royaltyBps, { type: 'u32' }),
    ]);
  }

  buildIssueTicketTx(params: {
    organizerPublicKey: string;
    chainEventId: bigint;
    toPublicKey: string;
    tier: string;
    seat: string;
    price: bigint;
  }): Promise<string> {
    return this.buildTx(params.organizerPublicKey, 'issue_ticket', [
      new Address(params.organizerPublicKey).toScVal(),
      nativeToScVal(params.chainEventId, { type: 'u64' }),
      new Address(params.toPublicKey).toScVal(),
      nativeToScVal(params.tier, { type: 'string' }),
      nativeToScVal(params.seat, { type: 'string' }),
      nativeToScVal(params.price, { type: 'i128' }),
    ]);
  }

  buildPurchasePrimaryTx(params: {
    buyerPublicKey: string;
    chainEventId: bigint;
    tier: string;
    seat: string;
    price: bigint;
  }): Promise<string> {
    return this.buildTx(params.buyerPublicKey, 'purchase_primary', [
      new Address(params.buyerPublicKey).toScVal(),
      nativeToScVal(params.chainEventId, { type: 'u64' }),
      nativeToScVal(params.tier, { type: 'string' }),
      nativeToScVal(params.seat, { type: 'string' }),
      nativeToScVal(params.price, { type: 'i128' }),
    ]);
  }

  buildTransferTicketTx(params: {
    fromPublicKey: string;
    chainTicketId: bigint;
    toPublicKey: string;
  }): Promise<string> {
    return this.buildTx(params.fromPublicKey, 'transfer_ticket', [
      new Address(params.fromPublicKey).toScVal(),
      nativeToScVal(params.chainTicketId, { type: 'u64' }),
      new Address(params.toPublicKey).toScVal(),
    ]);
  }

  buildCheckInTx(params: {
    organizerPublicKey: string;
    chainTicketId: bigint;
  }): Promise<string> {
    return this.buildTx(params.organizerPublicKey, 'check_in', [
      new Address(params.organizerPublicKey).toScVal(),
      nativeToScVal(params.chainTicketId, { type: 'u64' }),
    ]);
  }

  buildRevokeTicketTx(params: {
    organizerPublicKey: string;
    chainTicketId: bigint;
  }): Promise<string> {
    return this.buildTx(params.organizerPublicKey, 'revoke_ticket', [
      new Address(params.organizerPublicKey).toScVal(),
      nativeToScVal(params.chainTicketId, { type: 'u64' }),
    ]);
  }

  buildListForResaleTx(params: {
    ownerPublicKey: string;
    chainTicketId: bigint;
    price: bigint;
  }): Promise<string> {
    return this.buildTx(params.ownerPublicKey, 'list_for_resale', [
      new Address(params.ownerPublicKey).toScVal(),
      nativeToScVal(params.chainTicketId, { type: 'u64' }),
      nativeToScVal(params.price, { type: 'i128' }),
    ]);
  }

  buildCancelResaleTx(params: {
    ownerPublicKey: string;
    chainTicketId: bigint;
  }): Promise<string> {
    return this.buildTx(params.ownerPublicKey, 'cancel_resale', [
      new Address(params.ownerPublicKey).toScVal(),
      nativeToScVal(params.chainTicketId, { type: 'u64' }),
    ]);
  }

  buildBuyResaleTx(params: {
    buyerPublicKey: string;
    chainTicketId: bigint;
  }): Promise<string> {
    return this.buildTx(params.buyerPublicKey, 'buy_resale', [
      new Address(params.buyerPublicKey).toScVal(),
      nativeToScVal(params.chainTicketId, { type: 'u64' }),
    ]);
  }

  /**
   * Submits a wallet-signed XDR envelope (produced from one of the `build*Tx`
   * methods above and signed client-side) and polls it through to a result.
   */
  async submitSignedTransaction(
    signedXdr: string,
  ): Promise<{ result: unknown; txHash: string }> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const sendResult = await this.rpcCall(() =>
      this.server.sendTransaction(tx),
    );
    if (sendResult.status === 'ERROR') {
      throw new Error(
        `Soroban submission failed: ${JSON.stringify(sendResult.errorResult)}`,
      );
    }

    const txHash = sendResult.hash;
    const returnValue = await this.pollTransaction(txHash);
    return { result: scValToNative(returnValue), txHash };
  }

  private async simulateRead(fn: string, args: xdr.ScVal[]) {
    const account = await this.rpcCall(() =>
      this.server.getAccount(this.platformSigner.publicKey()),
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(fn, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.rpcCall(() => this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`Soroban simulation failed for ${fn}: ${sim.error}`);
    }
    if (!sim.result) {
      throw new Error(`Soroban simulation for ${fn} returned no result`);
    }
    return sim.result.retval;
  }

  /** Simulates + assigns fees/footprint for `fn`, returning an unsigned XDR envelope. */
  private async buildTx(
    sourcePublicKey: string,
    fn: string,
    args: xdr.ScVal[],
  ): Promise<string> {
    const account = await this.rpcCall(() =>
      this.server.getAccount(sourcePublicKey),
    );
    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(fn, ...args))
      .setTimeout(300)
      .build();

    const prepared = await this.rpcCall(() =>
      this.server.prepareTransaction(built),
    );
    return prepared.toXDR();
  }

  private async pollTransaction(
    hash: string,
    attempts = 15,
  ): Promise<xdr.ScVal> {
    for (let i = 0; i < attempts; i++) {
      const tx = await this.rpcCall(() => this.server.getTransaction(hash));
      if (tx.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        if (!tx.returnValue) {
          throw new Error(
            `Transaction ${hash} succeeded without a return value`,
          );
        }
        return tx.returnValue;
      }
      if (tx.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction ${hash} failed on-chain`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Timed out waiting for transaction ${hash} to land`);
  }

  private rpcCall<T>(operation: () => Promise<T>): Promise<T> {
    return this.rpcCircuitBreaker.execute(operation);
  }

  private decodeTicket(scVal: xdr.ScVal): OnChainTicket {
    const native = scValToNative(scVal) as Record<string, unknown>;
    return {
      eventId: native.event_id as bigint,
      owner: native.owner as string,
      tier: native.tier as string,
      seat: native.seat as string,
      status: this.decodeStatus(native.status),
      originalPrice: native.original_price as bigint,
      resalePrice: native.resale_price as bigint,
    };
  }

  private decodeEvent(scVal: xdr.ScVal): Omit<OnChainEvent, 'eventId'> {
    const native = scValToNative(scVal) as Record<string, unknown>;
    return {
      organizer: native.organizer as string,
      name: native.name as string,
      category: native.category as string,
      maxResaleMultiplierBps: native.max_resale_multiplier_bps as number,
      royaltyBps: native.royalty_bps as number,
      ticketsIssued: native.tickets_issued as bigint,
    };
  }

  private decodeStatus(raw: unknown): OnChainTicket['status'] {
    // soroban_sdk unit-variant enums decode as either a bare tag string or
    // `{ tag: string }` depending on SDK version — handle both.
    const tag = typeof raw === 'string' ? raw : (raw as { tag: string })?.tag;
    if (
      tag === 'Valid' ||
      tag === 'Used' ||
      tag === 'Revoked' ||
      tag === 'Resale'
    ) {
      return tag;
    }
    this.logger.warn(
      `Unrecognized on-chain ticket status: ${JSON.stringify(raw)}`,
    );
    return 'Valid';
  }
}
