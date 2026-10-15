import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmTransferTicketDto } from './confirm-transfer-ticket.dto';

const UUID = '11111111-1111-4111-8111-111111111111';
const PUBKEY = 'GBAHZWO3UI3GAHPQCPSW6IR5N7HJ4UBRZNAFMSYB6DAKVNHQDOZIV2YJ';
const SIGNED_XDR = 'AAAAAgAAAAA=';
const TX_HASH = 'a'.repeat(64);

/** Mirrors the global ValidationPipe, so unknown keys count as invalid here too. */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function build(overrides: Record<string, unknown> = {}) {
  return plainToInstance(ConfirmTransferTicketDto, {
    toUserId: UUID,
    toPublicKey: PUBKEY,
    signedXdr: SIGNED_XDR,
    ...overrides,
  });
}

async function invalidProperties(dto: object) {
  return (await validate(dto, PIPE_OPTIONS)).map((e) => e.property);
}

describe('ConfirmTransferTicketDto', () => {
  describe('valid payloads', () => {
    it('accepts the recipient plus the signed envelope', async () => {
      expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts an optional 64-character hex txHash in either case', async () => {
      expect(
        await validate(build({ txHash: TX_HASH }), PIPE_OPTIONS),
      ).toHaveLength(0);
      expect(
        await validate(
          build({ txHash: 'ABCDEF0123456789'.repeat(4) }),
          PIPE_OPTIONS,
        ),
      ).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it.each([
      ['missing', undefined],
      ['not a string', 12345],
    ])('rejects a signedXdr that is %s', async (_label, signedXdr) => {
      expect(await invalidProperties(build({ signedXdr }))).toContain(
        'signedXdr',
      );
    });

    it.each([
      ['too short', 'a'.repeat(63)],
      ['too long', 'a'.repeat(65)],
      ['not hex', 'g'.repeat(64)],
    ])('rejects a txHash that is %s', async (_label, txHash) => {
      expect(await invalidProperties(build({ txHash }))).toContain('txHash');
    });

    it.each([
      ['missing', undefined],
      ['not a UUID', 'user-1'],
      ['a number', 42],
    ])('rejects a toUserId that is %s', async (_label, toUserId) => {
      expect(await invalidProperties(build({ toUserId }))).toContain(
        'toUserId',
      );
    });

    it.each([
      ['missing', undefined],
      ['not a key at all', 'not-a-key'],
      ['the right length with a bad checksum', PUBKEY.slice(0, -1) + 'A'],
      ['a secret seed rather than a public key', 'S' + PUBKEY.slice(1)],
    ])('rejects a toPublicKey that is %s', async (_label, toPublicKey) => {
      expect(await invalidProperties(build({ toPublicKey }))).toContain(
        'toPublicKey',
      );
    });

    it('rejects unknown properties, like the global ValidationPipe does', async () => {
      expect(await invalidProperties(build({ ticketId: UUID }))).toContain(
        'ticketId',
      );
    });

    it('reports every invalid field at once', async () => {
      const properties = await invalidProperties(
        build({ toUserId: 'x', toPublicKey: 'y', signedXdr: undefined }),
      );
      expect(properties).toEqual(
        expect.arrayContaining(['toUserId', 'toPublicKey', 'signedXdr']),
      );
    });
  });
});
