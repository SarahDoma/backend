import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmPurchasePrimaryDto } from './confirm-purchase-primary.dto';

const UUID = '11111111-1111-4111-8111-111111111111';
const SIGNED_XDR = 'AAAAAgAAAAA=';
const TX_HASH = 'a'.repeat(64);

/** Mirrors the global ValidationPipe, so unknown keys count as invalid here too. */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function build(overrides: Record<string, unknown> = {}) {
  return plainToInstance(ConfirmPurchasePrimaryDto, {
    ticketTypeId: UUID,
    signedXdr: SIGNED_XDR,
    ...overrides,
  });
}

async function invalidProperties(dto: object) {
  return (await validate(dto, PIPE_OPTIONS)).map((e) => e.property);
}

describe('ConfirmPurchasePrimaryDto', () => {
  describe('valid payloads', () => {
    it('accepts a ticket type plus the signed envelope', async () => {
      expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts seat, promoCode and txHash together', async () => {
      expect(
        await validate(
          build({ seat: 'A-12', promoCode: 'EARLYBIRD', txHash: TX_HASH }),
          PIPE_OPTIONS,
        ),
      ).toHaveLength(0);
    });

    it.each([
      ['a row and number', 'A-12'],
      ['spaces and a slash', 'Row 3 / Seat 7'],
      ['a dotted label', '12.4'],
      ['the 64-character ceiling', 'A'.repeat(64)],
    ])('accepts a seat with %s', async (_label, seat) => {
      expect(await validate(build({ seat }), PIPE_OPTIONS)).toHaveLength(0);
    });

    it.each([
      ['the 3-character floor', 'ABC'],
      ['the 32-character ceiling', 'P'.repeat(32)],
    ])('accepts a promoCode at %s', async (_label, promoCode) => {
      expect(await validate(build({ promoCode }), PIPE_OPTIONS)).toHaveLength(
        0,
      );
    });
  });

  describe('invalid payloads', () => {
    it.each([
      ['missing', undefined],
      ['not a UUID', 'tt-1'],
      ['a number', 42],
    ])('rejects a ticketTypeId that is %s', async (_label, ticketTypeId) => {
      expect(await invalidProperties(build({ ticketTypeId }))).toContain(
        'ticketTypeId',
      );
    });

    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
      ['65 characters', 'A'.repeat(65)],
      ['carrying a forbidden character', 'A#1'],
      ['a number', 12],
    ])('rejects a seat that is %s', async (_label, seat) => {
      expect(await invalidProperties(build({ seat }))).toContain('seat');
    });

    it.each([
      ['shorter than 3 characters', 'AB'],
      ['longer than 32 characters', 'P'.repeat(33)],
      ['a number', 100],
    ])('rejects a promoCode that is %s', async (_label, promoCode) => {
      expect(await invalidProperties(build({ promoCode }))).toContain(
        'promoCode',
      );
    });

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
      ['not hex', 'g'.repeat(64)],
    ])('rejects a txHash that is %s', async (_label, txHash) => {
      expect(await invalidProperties(build({ txHash }))).toContain('txHash');
    });

    it('rejects unknown properties, like the global ValidationPipe does', async () => {
      expect(await invalidProperties(build({ price: '1' }))).toContain('price');
    });

    it('reports every invalid field at once', async () => {
      const properties = await invalidProperties(
        build({ ticketTypeId: 'x', seat: '', promoCode: 'A', signedXdr: 1 }),
      );
      expect(properties).toEqual(
        expect.arrayContaining([
          'ticketTypeId',
          'seat',
          'promoCode',
          'signedXdr',
        ]),
      );
    });
  });
});
