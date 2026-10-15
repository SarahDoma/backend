import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { IsSeat } from '../../common/decorators/is-seat.decorator';

export class PurchasePrimaryDto {
  @IsUUID()
  ticketTypeId!: string;

  @IsOptional()
  @IsSeat()
  seat?: string;

  @IsOptional()
  @IsString()
  @Length(3, 32)
  promoCode?: string;
}
