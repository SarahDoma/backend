import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmListForResaleDto } from './confirm-list-for-resale.dto';

const PRICE = '2500000';
const SIGNED_XDR = 'AAAAAgAAAAA=';
const TX_HASH = 'a'.repeat(64);
const EXPIRES_AT = '2030-01-01T18:00:00.000Z';

/** Mirrors the global ValidationPipe, so unknown keys count as invalid here too. */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function build(overrides: Record<string, unknown> = {}) {
  return plainToInstance(ConfirmListForResaleDto, {
    price: PRICE,
    signedXdr: SIGNED_XDR,
    ...overrides,
  });
}

async function invalidProperties(dto: object) {
  return (await validate(dto, PIPE_OPTIONS)).map((e) => e.property);
}

describe('ConfirmListForResaleDto', () => {
  describe('valid payloads', () => {
    it('accepts a price plus the signed envelope', async () => {
      expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts an ISO-8601 expiresAt and a hex txHash', async () => {
      expect(
        await validate(
          build({ expiresAt: EXPIRES_AT, txHash: TX_HASH }),
          PIPE_OPTIONS,
        ),
      ).toHaveLength(0);
    });

    it.each([
      ['zero', '0'],
      ['a single digit', '7'],
      ['the 39-digit i128 ceiling', '9'.repeat(39)],
    ])('accepts a price of %s', async (_label, price) => {
      expect(await validate(build({ price }), PIPE_OPTIONS)).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it.each([
      ['missing', undefined],
      ['negative', '-1'],
      ['a decimal', '1.5'],
      ['zero-padded', '01'],
      ['not numeric', 'ten'],
      ['padded with whitespace', ' 25 '],
      ['40 digits, past the i128 ceiling', '1'.repeat(40)],
      ['a number rather than a string', 2500000],
    ])('rejects a price that is %s', async (_label, price) => {
      expect(await invalidProperties(build({ price }))).toContain('price');
    });

    it.each([
      ['not a date', 'tomorrow'],
      ['an impossible calendar date', '2030-13-45T00:00:00.000Z'],
      ['a unix timestamp number', 1_900_000_000],
    ])('rejects an expiresAt that is %s', async (_label, expiresAt) => {
      expect(await invalidProperties(build({ expiresAt }))).toContain(
        'expiresAt',
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
      expect(await invalidProperties(build({ sellerId: 'me' }))).toContain(
        'sellerId',
      );
    });

    it('reports every invalid field at once', async () => {
      const properties = await invalidProperties(
        build({ price: '-5', expiresAt: 'never', signedXdr: undefined }),
      );
      expect(properties).toEqual(
        expect.arrayContaining(['price', 'expiresAt', 'signedXdr']),
      );
    });
  });
});
