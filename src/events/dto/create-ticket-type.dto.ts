import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsBigIntString } from '../../common/decorators/is-bigint-string.decorator';

export class CreateTicketTypeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name!: string;

  /** Face-value price in the settlement token's smallest unit, as a string to preserve i128 precision over JSON. */
  @IsBigIntString()
  price!: string;

  @IsInt()
  @IsPositive()
  quantityTotal!: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  saleStartsAt?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  saleEndsAt?: Date;
  @IsOptional()
  isHidden?: boolean;
}

/** Same shape as `CreateTicketTypeDto`, nested under `CreateEventDto.ticketTypes` (no `eventId` — the parent event doesn't exist yet). */
export class CreateEventTicketTypeDto extends CreateTicketTypeDto {}
