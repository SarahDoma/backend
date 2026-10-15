import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmPublishDto } from './confirm-publish.dto';

const TX_HASH = 'b'.repeat(64);

describe('ConfirmPublishDto', () => {
  it('accepts a string signedXdr', async () => {
    const dto = plainToInstance(ConfirmPublishDto, {
      signedXdr: 'AAAAAgAAAAA=',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing signedXdr', async () => {
    const dto = plainToInstance(ConfirmPublishDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'signedXdr')).toBe(true);
  });

  it('rejects an invalid txHash with 400-bound validation errors', async () => {
    const dto = plainToInstance(ConfirmPublishDto, {
      signedXdr: 'AAAAAgAAAAA=',
      txHash: 'xyz',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'txHash')).toBe(true);
  });

  it('accepts a valid txHash', async () => {
    const dto = plainToInstance(ConfirmPublishDto, {
      signedXdr: 'AAAAAgAAAAA=',
      txHash: TX_HASH,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
