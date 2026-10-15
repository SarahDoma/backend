import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/**
 * Page-number pagination for list endpoints. Extend it to add filters:
 * `class FooQueryDto extends PaginationQueryDto { ... }`.
 */
export class PaginationQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional({ minimum: 1, maximum: 100_000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Keeps `skip` (page - 1) * limit well inside a 32-bit int.
  @Max(100_000)
  page?: number = 1;

  /** Items per page. */
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number = DEFAULT_PAGE_LIMIT;
}
