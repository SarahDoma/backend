import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Cursor pagination for `GET /tickets/resale`. */
export class ResaleListingsQueryDto {
  /** Opaque cursor from a previous response's `nextCursor`. */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
