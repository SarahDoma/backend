import { IsEnum, IsOptional } from 'class-validator';
import { EventStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Filters and pagination for `GET /organizations/:organizationId/events`. */
export class ListOrganizationEventsQueryDto extends PaginationQueryDto {
  /** Only return events in this status, e.g. `DRAFT` to see unpublished ones. */
  @IsOptional()
  @IsEnum(EventStatus, {
    message: `status must be one of: ${Object.values(EventStatus).join(', ')}`,
  })
  status?: EventStatus;
}
