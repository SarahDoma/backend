import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmSignedTxDto } from './confirm-signed-tx.dto';

const TX_HASH = 'a'.repeat(64);

describe('ConfirmSignedTxDto', () => {
  it('accepts a string signedXdr', async () => {
    const dto = plainToInstance(ConfirmSignedTxDto, {
      signedXdr: 'AAAAAgAAAAA=',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a well-formed optional txHash', async () => {
    const dto = plainToInstance(ConfirmSignedTxDto, {
      signedXdr: 'AAAAAgAAAAA=',
      txHash: TX_HASH,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing signedXdr', async () => {
    const dto = plainToInstance(ConfirmSignedTxDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'signedXdr')).toBe(true);
  });

  it('rejects a malformed txHash', async () => {
    const dto = plainToInstance(ConfirmSignedTxDto, {
      signedXdr: 'AAAAAgAAAAA=',
      txHash: 'not-a-hash',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'txHash')).toBe(true);
  });

  it('rejects a txHash that is not 64 hex chars', async () => {
    const dto = plainToInstance(ConfirmSignedTxDto, {
      signedXdr: 'AAAAAgAAAAA=',
      txHash: 'abcd',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'txHash')).toBe(true);
  });
});
