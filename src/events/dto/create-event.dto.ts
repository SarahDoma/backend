import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinDate,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Industry } from '@prisma/client';
import { CreateEventTicketTypeDto } from './create-ticket-type.dto';

/**
 * How far in the past `startsAt` may be before it's rejected. Absorbs client
 * clock skew and the time between a form being filled and submitted, so an
 * event starting "now" isn't bounced.
 */
export const STARTS_AT_PAST_TOLERANCE_MS = 60_000;

export class CreateEventDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(256)
  name!: string;

  @IsEnum(Industry, {
    message: `category must be one of: ${Object.values(Industry).join(', ')}`,
  })
  category!: Industry;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  venue!: string;

  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(Date.now() - STARTS_AT_PAST_TOLERANCE_MS), {
    message: 'startsAt must not be in the past',
  })
  startsAt!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  /** Basis points cap on resale price relative to face value (10000 = 100%). */
  @IsOptional()
  @IsInt()
  @Min(10_000)
  @Max(50_000)
  maxResaleMultiplierBps?: number;

  /** Basis points of every resale paid to the organizer as royalty. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000)
  royaltyBps?: number;

  /** Ticket types to create alongside the event, in the same transaction. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventTicketTypeDto)
  ticketTypes?: CreateEventTicketTypeDto[];
}
