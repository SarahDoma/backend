import 'reflect-metadata';
import { paginate, toSkipTake } from './paginated';

describe('toSkipTake', () => {
  it('maps a 1-based page to an offset', () => {
    expect(toSkipTake({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });
});

describe('paginate', () => {
  it('returns items, total, page and limit', () => {
    expect(paginate(['a', 'b'], 12, { page: 2, limit: 2 })).toEqual({
      items: ['a', 'b'],
      total: 12,
      page: 2,
      limit: 2,
    });
  });

  it('keeps an empty page past the end', () => {
    expect(paginate([], 3, { page: 5, limit: 20 })).toEqual({
      items: [],
      total: 3,
      page: 5,
      limit: 20,
    });
  });
});
