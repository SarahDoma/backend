import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateResalePriceDto } from './update-resale-price.dto';

describe('UpdateResalePriceDto', () => {
  it('accepts a valid non-negative integer string', async () => {
    const dto = plainToInstance(UpdateResalePriceDto, { price: '1500' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts zero', async () => {
    const dto = plainToInstance(UpdateResalePriceDto, { price: '0' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a numeric (non-string) price', async () => {
    const dto = plainToInstance(UpdateResalePriceDto, { price: 1500 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });

  it('rejects a decimal string', async () => {
    const dto = plainToInstance(UpdateResalePriceDto, { price: '15.50' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });

  it('rejects a negative string', async () => {
    const dto = plainToInstance(UpdateResalePriceDto, { price: '-100' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });

  it('rejects a missing price', async () => {
    const dto = plainToInstance(UpdateResalePriceDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });
});
