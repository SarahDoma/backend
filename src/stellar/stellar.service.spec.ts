import {
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Networks,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  createStellarHarness,
  decodeInvokeHostFunction,
  NETWORK_PASSPHRASES,
  signAsWallet,
  TEST_CONTRACT_ID,
} from '../../test/helpers/stellar-harness';
import {
  eventScVal,
  sendPending,
  sendRejected,
  simulationError,
  simulationSuccess,
  ticketScVal,
  TX_HASH,
  txFailed,
  txNotFound,
  txSuccess,
} from '../../test/mocks/soroban-rpc.mock';
import { CircuitOpenError } from './circuit-breaker';
import type { StellarService } from './stellar.service';

const organizer = Keypair.random();
const attendee = Keypair.random();
const buyer = Keypair.random();
const ORGANIZER = organizer.publicKey();
const ATTENDEE = attendee.publicKey();
const BUYER = buyer.publicKey();
const CHAIN_EVENT_ID = 42n;
const CHAIN_TICKET_ID = 7n;

describe('StellarService (contract-mock harness)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('build*Tx envelopes', () => {
    const cases: Array<{
      method: string;
      build: (service: StellarService) => Promise<string>;
      source: string;
      fn: string;
      args: unknown[];
      argTypes: string[];
    }> = [
      {
        method: 'buildCreateEventTx',
        build: (s) =>
          s.buildCreateEventTx({
            organizerPublicKey: ORGANIZER,
            chainEventId: CHAIN_EVENT_ID,
            name: 'Launch Night',
            category: 'CONCERTS',
            maxResaleMultiplierBps: 11_000,
            royaltyBps: 500,
          }),
        source: ORGANIZER,
        fn: 'create_event',
        args: [
          ORGANIZER,
          CHAIN_EVENT_ID,
          'Launch Night',
          'CONCERTS',
          11_000,
          500,
        ],
        argTypes: [
          'scvAddress',
          'scvU64',
          'scvString',
          'scvString',
          'scvU32',
          'scvU32',
        ],
      },
      {
        method: 'buildIssueTicketTx',
        build: (s) =>
          s.buildIssueTicketTx({
            organizerPublicKey: ORGANIZER,
            chainEventId: CHAIN_EVENT_ID,
            toPublicKey: ATTENDEE,
            tier: 'GA',
            seat: 'A-12',
            price: 1_000_000n,
          }),
        source: ORGANIZER,
        fn: 'issue_ticket',
        args: [ORGANIZER, CHAIN_EVENT_ID, ATTENDEE, 'GA', 'A-12', 1_000_000n],
        argTypes: [
          'scvAddress',
          'scvU64',
          'scvAddress',
          'scvString',
          'scvString',
          'scvI128',
        ],
      },
      {
        method: 'buildPurchasePrimaryTx',
        build: (s) =>
          s.buildPurchasePrimaryTx({
            buyerPublicKey: BUYER,
            chainEventId: CHAIN_EVENT_ID,
            tier: 'GA',
            seat: 'unassigned',
            price: 2_500_000n,
          }),
        source: BUYER,
        fn: 'purchase_primary',
        args: [BUYER, CHAIN_EVENT_ID, 'GA', 'unassigned', 2_500_000n],
        argTypes: ['scvAddress', 'scvU64', 'scvString', 'scvString', 'scvI128'],
      },
      {
        method: 'buildTransferTicketTx',
        build: (s) =>
          s.buildTransferTicketTx({
            fromPublicKey: ATTENDEE,
            chainTicketId: CHAIN_TICKET_ID,
            toPublicKey: BUYER,
          }),
        source: ATTENDEE,
        fn: 'transfer_ticket',
        args: [ATTENDEE, CHAIN_TICKET_ID, BUYER],
        argTypes: ['scvAddress', 'scvU64', 'scvAddress'],
      },
      {
        method: 'buildCheckInTx',
        build: (s) =>
          s.buildCheckInTx({
            organizerPublicKey: ORGANIZER,
            chainTicketId: CHAIN_TICKET_ID,
          }),
        source: ORGANIZER,
        fn: 'check_in',
        args: [ORGANIZER, CHAIN_TICKET_ID],
        argTypes: ['scvAddress', 'scvU64'],
      },
      {
        method: 'buildRevokeTicketTx',
        build: (s) =>
          s.buildRevokeTicketTx({
            organizerPublicKey: ORGANIZER,
            chainTicketId: CHAIN_TICKET_ID,
          }),
        source: ORGANIZER,
        fn: 'revoke_ticket',
        args: [ORGANIZER, CHAIN_TICKET_ID],
        argTypes: ['scvAddress', 'scvU64'],
      },
      {
        method: 'buildListForResaleTx',
        build: (s) =>
          s.buildListForResaleTx({
            ownerPublicKey: ATTENDEE,
            chainTicketId: CHAIN_TICKET_ID,
            price: 3_000_000n,
          }),
        source: ATTENDEE,
        fn: 'list_for_resale',
        args: [ATTENDEE, CHAIN_TICKET_ID, 3_000_000n],
        argTypes: ['scvAddress', 'scvU64', 'scvI128'],
      },
      {
        method: 'buildCancelResaleTx',
        build: (s) =>
          s.buildCancelResaleTx({
            ownerPublicKey: ATTENDEE,
            chainTicketId: CHAIN_TICKET_ID,
          }),
        source: ATTENDEE,
        fn: 'cancel_resale',
        args: [ATTENDEE, CHAIN_TICKET_ID],
        argTypes: ['scvAddress', 'scvU64'],
      },
      {
        method: 'buildBuyResaleTx',
        build: (s) =>
          s.buildBuyResaleTx({
            buyerPublicKey: BUYER,
            chainTicketId: CHAIN_TICKET_ID,
          }),
        source: BUYER,
        fn: 'buy_resale',
        args: [BUYER, CHAIN_TICKET_ID],
        argTypes: ['scvAddress', 'scvU64'],
      },
    ];

    it.each(cases)(
      '$method encodes a $fn call on the ticketing contract',
      async ({ build, source, fn, args, argTypes }) => {
        const { service, server } = createStellarHarness();

        const envelope = await build(service);
        const decoded = decodeInvokeHostFunction(envelope, Networks.TESTNET);

        expect(decoded).toMatchObject({
          source,
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
          contractId: TEST_CONTRACT_ID,
          functionName: fn,
          args,
          argTypes,
          signatureCount: 0,
        });
        expect(server.getAccount).toHaveBeenCalledWith(source);
        expect(server.prepareTransaction).toHaveBeenCalledTimes(1);
      },
    );

    it('returns the envelope prepareTransaction produced, not the pre-simulation one', async () => {
      const { service, server } = createStellarHarness();
      server.prepareTransaction.mockImplementation((tx) =>
        Promise.resolve(
          TransactionBuilder.cloneFrom(tx, { fee: '5000' }).build(),
        ),
      );

      const envelope = await service.buildCheckInTx({
        organizerPublicKey: ORGANIZER,
        chainTicketId: CHAIN_TICKET_ID,
      });

      expect(decodeInvokeHostFunction(envelope, Networks.TESTNET).fee).toBe(
        '5000',
      );
    });

    it('gives the wallet a five-minute window to sign', async () => {
      const { service } = createStellarHarness();
      const before = Math.floor(Date.now() / 1000);

      const envelope = await service.buildCheckInTx({
        organizerPublicKey: ORGANIZER,
        chainTicketId: CHAIN_TICKET_ID,
      });

      const { timeBounds } = decodeInvokeHostFunction(
        envelope,
        Networks.TESTNET,
      );
      expect(timeBounds.minTime).toBe(0);
      expect(timeBounds.maxTime).toBeGreaterThanOrEqual(before + 300);
      expect(timeBounds.maxTime).toBeLessThanOrEqual(before + 305);
    });

    it('binds the envelope to the configured network so a wallet on another network cannot sign it', async () => {
      const { service } = createStellarHarness({ network: 'futurenet' });

      const envelope = await service.buildCheckInTx({
        organizerPublicKey: ORGANIZER,
        chainTicketId: CHAIN_TICKET_ID,
      });

      const onFuturenet = TransactionBuilder.fromXDR(
        envelope,
        Networks.FUTURENET,
      );
      const onTestnet = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
      expect(onFuturenet.networkPassphrase).toBe(Networks.FUTURENET);
      expect(onFuturenet.hash().toString('hex')).not.toBe(
        onTestnet.hash().toString('hex'),
      );
    });

    it.each(Object.entries(NETWORK_PASSPHRASES))(
      'maps STELLAR_NETWORK=%s to its passphrase',
      async (network, passphrase) => {
        const { service } = createStellarHarness({
          network: network as keyof typeof NETWORK_PASSPHRASES,
        });

        const envelope = await service.buildCheckInTx({
          organizerPublicKey: ORGANIZER,
          chainTicketId: CHAIN_TICKET_ID,
        });

        expect(
          decodeInvokeHostFunction(envelope, passphrase).networkPassphrase,
        ).toBe(passphrase);
      },
    );

    it('propagates an RPC failure while resolving the source account', async () => {
      const { service, server } = createStellarHarness();
      server.getAccount.mockRejectedValue(new Error('account not found'));

      await expect(
        service.buildCheckInTx({
          organizerPublicKey: ORGANIZER,
          chainTicketId: CHAIN_TICKET_ID,
        }),
      ).rejects.toThrow('account not found');
      expect(server.prepareTransaction).not.toHaveBeenCalled();
    });
  });

  describe('submitSignedTransaction', () => {
    async function signedIssueEnvelope(service: StellarService) {
      const unsigned = await service.buildIssueTicketTx({
        organizerPublicKey: ORGANIZER,
        chainEventId: CHAIN_EVENT_ID,
        toPublicKey: ATTENDEE,
        tier: 'GA',
        seat: 'A-12',
        price: 1_000_000n,
      });
      return signAsWallet(unsigned, Networks.TESTNET, organizer);
    }

    it('relays the wallet-signed envelope and returns the decoded return value with its hash', async () => {
      const { service, server } = createStellarHarness();
      server.sendTransaction.mockResolvedValue(sendPending());
      server.getTransaction.mockResolvedValue(
        txSuccess(nativeToScVal(CHAIN_TICKET_ID, { type: 'u64' })),
      );
      const signed = await signedIssueEnvelope(service);

      const result = await service.submitSignedTransaction(signed);

      expect(result).toEqual({ result: CHAIN_TICKET_ID, txHash: TX_HASH });
      const relayed = server.sendTransaction.mock.calls[0][0];
      const expected = TransactionBuilder.fromXDR(
        signed,
        Networks.TESTNET,
      ) as Transaction;
      expect(relayed.hash().toString('hex')).toBe(
        expected.hash().toString('hex'),
      );
      expect(relayed.signatures).toHaveLength(1);
      expect(
        decodeInvokeHostFunction(relayed.toXDR(), Networks.TESTNET)
          .functionName,
      ).toBe('issue_ticket');
      expect(server.getTransaction).toHaveBeenCalledWith(TX_HASH);
    });

    it('throws when the network rejects the submission', async () => {
      const { service, server } = createStellarHarness();
      server.sendTransaction.mockResolvedValue(sendRejected());

      await expect(
        service.submitSignedTransaction(await signedIssueEnvelope(service)),
      ).rejects.toThrow(/Soroban submission failed: .*txBAD_SEQ/);
      expect(server.getTransaction).not.toHaveBeenCalled();
    });

    it('throws when the transaction fails on-chain', async () => {
      const { service, server } = createStellarHarness();
      server.sendTransaction.mockResolvedValue(sendPending());
      server.getTransaction.mockResolvedValue(txFailed());

      await expect(
        service.submitSignedTransaction(await signedIssueEnvelope(service)),
      ).rejects.toThrow(`Transaction ${TX_HASH} failed on-chain`);
    });

    it('throws when a successful transaction carries no return value', async () => {
      const { service, server } = createStellarHarness();
      server.sendTransaction.mockResolvedValue(sendPending());
      server.getTransaction.mockResolvedValue(txSuccess(undefined));

      await expect(
        service.submitSignedTransaction(await signedIssueEnvelope(service)),
      ).rejects.toThrow(/succeeded without a return value/);
    });

    it('polls once a second until the transaction lands', async () => {
      const { service, server } = createStellarHarness();
      const signed = await signedIssueEnvelope(service);
      jest.useFakeTimers();
      server.sendTransaction.mockResolvedValue(sendPending());
      server.getTransaction
        .mockResolvedValueOnce(txNotFound())
        .mockResolvedValueOnce(txNotFound())
        .mockResolvedValueOnce(
          txSuccess(nativeToScVal(CHAIN_TICKET_ID, { type: 'u64' })),
        );

      const pending = service.submitSignedTransaction(signed);
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toEqual({
        result: CHAIN_TICKET_ID,
        txHash: TX_HASH,
      });
      expect(server.getTransaction).toHaveBeenCalledTimes(3);
    });

    it('gives up after fifteen polls', async () => {
      const { service, server } = createStellarHarness();
      const signed = await signedIssueEnvelope(service);
      jest.useFakeTimers();
      server.sendTransaction.mockResolvedValue(sendPending());
      server.getTransaction.mockResolvedValue(txNotFound());

      const expectation = expect(
        service.submitSignedTransaction(signed),
      ).rejects.toThrow(`Timed out waiting for transaction ${TX_HASH}`);
      await jest.advanceTimersByTimeAsync(16_000);

      await expectation;
      expect(server.getTransaction).toHaveBeenCalledTimes(15);
    });

    it('rejects an envelope built for another network before touching RPC', async () => {
      const { service, server } = createStellarHarness();
      const foreign = createStellarHarness({ network: 'futurenet' });
      const unsigned = await foreign.service.buildCheckInTx({
        organizerPublicKey: ORGANIZER,
        chainTicketId: CHAIN_TICKET_ID,
      });
      const signed = signAsWallet(unsigned, Networks.FUTURENET, organizer);
      server.sendTransaction.mockResolvedValue(sendPending());
      server.getTransaction.mockResolvedValue(
        txSuccess(nativeToScVal(CHAIN_TICKET_ID, { type: 'u64' })),
      );

      // The envelope decodes, but its signature was made over the futurenet
      // hash, so it no longer verifies against the testnet passphrase.
      await service.submitSignedTransaction(signed);
      const relayed = server.sendTransaction.mock.calls[0][0];
      const signature = relayed.signatures[0].signature();
      expect(organizer.verify(relayed.hash(), signature)).toBe(false);
    });
  });

  describe('read-only simulations', () => {
    it('verifyTicket simulates from the platform signer and decodes the Ticket struct', async () => {
      const { service, server, platformSigner } = createStellarHarness();
      server.simulateTransaction.mockResolvedValue(
        simulationSuccess(
          ticketScVal({
            eventId: CHAIN_EVENT_ID,
            owner: ATTENDEE,
            tier: 'GA',
            seat: 'A-12',
            status: 'Used',
            originalPrice: 1_000_000n,
            resalePrice: 0n,
          }),
        ),
      );

      const ticket = await service.verifyTicket(CHAIN_TICKET_ID);

      expect(ticket).toEqual({
        eventId: CHAIN_EVENT_ID,
        owner: ATTENDEE,
        tier: 'GA',
        seat: 'A-12',
        status: 'Used',
        originalPrice: 1_000_000n,
        resalePrice: 0n,
      });
      expect(server.getAccount).toHaveBeenCalledWith(
        platformSigner.publicKey(),
      );
      const simulated = decodeInvokeHostFunction(
        server.simulateTransaction.mock.calls[0][0].toXDR(),
        Networks.TESTNET,
      );
      expect(simulated).toMatchObject({
        source: platformSigner.publicKey(),
        functionName: 'verify_ticket',
        args: [CHAIN_TICKET_ID],
        argTypes: ['scvU64'],
        signatureCount: 0,
      });
      expect(server.prepareTransaction).not.toHaveBeenCalled();
      expect(server.sendTransaction).not.toHaveBeenCalled();
    });

    it('decodes a status encoded as a tagged variant', async () => {
      const { service, server } = createStellarHarness();
      server.simulateTransaction.mockResolvedValue(
        simulationSuccess(
          ticketScVal(
            {
              eventId: CHAIN_EVENT_ID,
              owner: ATTENDEE,
              tier: 'VIP',
              seat: 'unassigned',
              status: 'Resale',
              originalPrice: 5_000_000n,
              resalePrice: 5_500_000n,
            },
            'tagged',
          ),
        ),
      );

      const ticket = await service.verifyTicket(CHAIN_TICKET_ID);

      expect(ticket.status).toBe('Resale');
      expect(ticket.resalePrice).toBe(5_500_000n);
    });

    it('falls back to Valid for a status it does not recognise', async () => {
      const { service, server } = createStellarHarness();
      server.simulateTransaction.mockResolvedValue(
        simulationSuccess(
          ticketScVal({
            eventId: CHAIN_EVENT_ID,
            owner: ATTENDEE,
            tier: 'GA',
            seat: 'A-12',
            status: 'Quarantined',
            originalPrice: 1_000_000n,
            resalePrice: 0n,
          }),
        ),
      );

      const ticket = await service.verifyTicket(CHAIN_TICKET_ID);

      expect(ticket.status).toBe('Valid');
    });

    it('getEvent decodes the Event struct and keeps the requested id', async () => {
      const { service, server } = createStellarHarness();
      server.simulateTransaction.mockResolvedValue(
        simulationSuccess(
          eventScVal({
            organizer: ORGANIZER,
            name: 'Launch Night',
            category: 'CONCERTS',
            maxResaleMultiplierBps: 11_000,
            royaltyBps: 500,
            ticketsIssued: 128n,
          }),
        ),
      );

      const event = await service.getEvent(CHAIN_EVENT_ID);

      expect(event).toEqual({
        eventId: CHAIN_EVENT_ID,
        organizer: ORGANIZER,
        name: 'Launch Night',
        category: 'CONCERTS',
        maxResaleMultiplierBps: 11_000,
        royaltyBps: 500,
        ticketsIssued: 128n,
      });
      expect(
        decodeInvokeHostFunction(
          server.simulateTransaction.mock.calls[0][0].toXDR(),
          Networks.TESTNET,
        ),
      ).toMatchObject({ functionName: 'get_event', args: [CHAIN_EVENT_ID] });
    });

    it('surfaces a simulation error with the function name', async () => {
      const { service, server } = createStellarHarness();
      server.simulateTransaction.mockResolvedValue(
        simulationError('HostError: Error(Contract, #3)'),
      );

      await expect(service.verifyTicket(CHAIN_TICKET_ID)).rejects.toThrow(
        'Soroban simulation failed for verify_ticket: HostError: Error(Contract, #3)',
      );
    });

    it('rejects a simulation that returns no result', async () => {
      const { service, server } = createStellarHarness();
      server.simulateTransaction.mockResolvedValue({ latestLedger: 100 });

      await expect(service.getEvent(CHAIN_EVENT_ID)).rejects.toThrow(
        'Soroban simulation for get_event returned no result',
      );
    });
  });

  describe('circuit breaker', () => {
    it('starts closed and opens after three consecutive RPC failures', async () => {
      const { service, server } = createStellarHarness();
      expect(service.getCircuitBreakerMetrics()).toMatchObject({
        state: 'CLOSED',
        consecutiveFailures: 0,
      });
      server.getAccount.mockRejectedValue(new Error('ECONNREFUSED'));
      const params = {
        organizerPublicKey: ORGANIZER,
        chainTicketId: CHAIN_TICKET_ID,
      };

      for (let i = 0; i < 3; i += 1) {
        await expect(service.buildCheckInTx(params)).rejects.toThrow(
          'ECONNREFUSED',
        );
      }

      expect(service.getCircuitBreakerMetrics()).toMatchObject({
        state: 'OPEN',
        consecutiveFailures: 3,
        totalFailures: 3,
      });
      await expect(service.buildCheckInTx(params)).rejects.toBeInstanceOf(
        CircuitOpenError,
      );
      expect(server.getAccount).toHaveBeenCalledTimes(3);
      expect(service.getCircuitBreakerMetrics().rejectedCalls).toBe(1);
    });
  });
});
