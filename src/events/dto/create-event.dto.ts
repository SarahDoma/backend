import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Industry } from '@prisma/client';
import { CreateEventTicketTypeDto } from './create-ticket-type.dto';

export class CreateEventDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEnum(Industry)
  category: Industry;

  @IsString()
  @MinLength(1)
  venue: string;

  @Type(() => Date)
  @IsDate()
  startsAt: Date;

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
