import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListForResaleDto } from './list-for-resale.dto';

describe('ListForResaleDto', () => {
  it('accepts a numeric string price', async () => {
    const dto = plainToInstance(ListForResaleDto, { price: '1200' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-string price', async () => {
    const dto = plainToInstance(ListForResaleDto, { price: 1200 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });

  it('rejects a non-numeric price string', async () => {
    const dto = plainToInstance(ListForResaleDto, { price: '12.5' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });
});
