import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_PAGE_LIMIT, PaginationQueryDto } from './pagination-query.dto';

async function errorsFor(query: Record<string, unknown>) {
  const dto = plainToInstance(PaginationQueryDto, query);
  return (await validate(dto)).map((e) => e.property);
}

describe('PaginationQueryDto', () => {
  it('defaults to the first page of 20 when no query is given', async () => {
    const dto = plainToInstance(PaginationQueryDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('coerces numeric query strings', async () => {
    const dto = plainToInstance(PaginationQueryDto, {
      page: '3',
      limit: '50',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
  });

  it('accepts the largest allowed page size', async () => {
    expect(await errorsFor({ limit: String(MAX_PAGE_LIMIT) })).toEqual([]);
  });

  it('rejects a limit above the maximum page size', async () => {
    expect(await errorsFor({ limit: String(MAX_PAGE_LIMIT + 1) })).toEqual([
      'limit',
    ]);
  });

  it.each(['0', '-1'])('rejects limit=%s', async (limit) => {
    expect(await errorsFor({ limit })).toEqual(['limit']);
  });

  it.each(['0', '-1'])('rejects page=%s', async (page) => {
    expect(await errorsFor({ page })).toEqual(['page']);
  });

  it('rejects a page number large enough to overflow skip', async () => {
    expect(await errorsFor({ page: '100001' })).toEqual(['page']);
  });

  it.each(['abc', '1.5'])('rejects a non-integer limit (%s)', async (limit) => {
    expect(await errorsFor({ limit })).toEqual(['limit']);
  });
});
