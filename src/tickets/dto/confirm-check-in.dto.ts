import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ConfirmSignedTxDto } from './confirm-signed-tx.dto';

export class ConfirmCheckInDto extends ConfirmSignedTxDto {
  /** Which gate scanned this ticket, if the venue tracks multiple entrances. */
  @IsOptional()
  @IsUUID()
  gateId?: string;

  /** Reason for check-in when scanner fails and staff override is used. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(512)
  reason?: string;
}
