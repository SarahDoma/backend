import { IsInt, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateTicketTypeDto {
  @IsString()
  @MinLength(1)
  name: string;

  /** Face-value price in the settlement token's smallest unit, as a string to preserve i128 precision over JSON. */
  @IsString()
  price: string;

  @IsInt()
  @IsPositive()
  quantityTotal: number;
}

/** Same shape as `CreateTicketTypeDto`, nested under `CreateEventDto.ticketTypes` (no `eventId` — the parent event doesn't exist yet). */
export class CreateEventTicketTypeDto extends CreateTicketTypeDto {}
