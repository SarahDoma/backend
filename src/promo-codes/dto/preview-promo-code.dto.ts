import { IsString, IsUUID, Length } from 'class-validator';

export class PreviewPromoCodeDto {
  @IsUUID()
  ticketTypeId!: string;

  @IsString()
  @Length(3, 32)
  code!: string;
}
