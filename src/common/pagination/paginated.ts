import {
  DEFAULT_PAGE_LIMIT,
  type PaginationQueryDto,
} from '../dto/pagination-query.dto';

/** Response body shared by every offset-paginated listing endpoint. */
export interface Paginated<T> {
  items: T[];
  /** Total matching rows across all pages. */
  total: number;
  /** 1-based page number this response holds. */
  page: number;
  /** Page size the response was computed with. */
  limit: number;
}

type PageParams = Pick<PaginationQueryDto, 'page' | 'limit'>;

/** Prisma `skip` / `take` for the requested page. */
export function toSkipTake({
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
}: PageParams): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * limit, take: limit };
}

export function paginate<T>(
  items: T[],
  total: number,
  { page = 1, limit = DEFAULT_PAGE_LIMIT }: PageParams,
): Paginated<T> {
  return { items, total, page, limit };
}
