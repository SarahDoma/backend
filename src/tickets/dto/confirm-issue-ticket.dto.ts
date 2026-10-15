import { IsOptional, IsUUID } from 'class-validator';
import { IsStellarPublicKey } from '../../common/decorators/is-stellar-public-key.decorator';
import { IsSeat } from '../../common/decorators/is-seat.decorator';
import { ConfirmSignedTxDto } from './confirm-signed-tx.dto';

export class ConfirmIssueTicketDto extends ConfirmSignedTxDto {
  @IsUUID()
  ticketTypeId!: string;

  @IsUUID()
  toUserId!: string;

  @IsStellarPublicKey()
  toPublicKey!: string;

  @IsOptional()
  @IsSeat()
  seat?: string;
}
