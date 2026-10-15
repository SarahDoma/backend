import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResaleListingsQueryDto } from './resale-listings-query.dto';

describe('ResaleListingsQueryDto', () => {
  it('accepts an empty query and applies the default limit', async () => {
    const dto = plainToInstance(ResaleListingsQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(20);
  });

  it('accepts a cursor and limit', async () => {
    const dto = plainToInstance(ResaleListingsQueryDto, {
      cursor: 'abc',
      limit: '10',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(10);
  });

  it('rejects a limit above 100', async () => {
    const dto = plainToInstance(ResaleListingsQueryDto, { limit: '101' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects a non-positive limit', async () => {
    const dto = plainToInstance(ResaleListingsQueryDto, { limit: '0' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });
});
