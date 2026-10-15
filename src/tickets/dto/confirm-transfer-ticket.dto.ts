import { IsUUID } from 'class-validator';
import { IsStellarPublicKey } from '../../common/decorators/is-stellar-public-key.decorator';
import { ConfirmSignedTxDto } from './confirm-signed-tx.dto';

export class ConfirmTransferTicketDto extends ConfirmSignedTxDto {
  @IsUUID()
  toUserId!: string;

  @IsStellarPublicKey()
  toPublicKey!: string;
}
