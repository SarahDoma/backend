import { validate } from 'class-validator';
import { IsBigIntString } from './is-bigint-string.decorator';

class TestDto {
  @IsBigIntString()
  price!: string;
}

describe('IsBigIntString', () => {
  it('accepts zero', async () => {
    const dto = new TestDto();
    dto.price = '0';
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a positive integer string', async () => {
    const dto = new TestDto();
    dto.price = '1200';
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts the maximum 39-digit i128 magnitude', async () => {
    const dto = new TestDto();
    dto.price = '1' + '0'.repeat(38);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a leading-zero number', async () => {
    const dto = new TestDto();
    dto.price = '01';
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isBigIntString');
  });

  it('rejects a negative string', async () => {
    const dto = new TestDto();
    dto.price = '-1';
    expect(await validate(dto)).toHaveLength(1);
  });

  it('rejects a non-digit string', async () => {
    const dto = new TestDto();
    dto.price = '12.5';
    expect(await validate(dto)).toHaveLength(1);
  });

  it('rejects a 40-digit string as out of i128 bounds', async () => {
    const dto = new TestDto();
    dto.price = '1' + '0'.repeat(39);
    expect(await validate(dto)).toHaveLength(1);
  });

  it('rejects a non-string', async () => {
    const dto = new TestDto();
    // @ts-expect-error intentional
    dto.price = 1200;
    expect(await validate(dto)).toHaveLength(1);
  });
});
