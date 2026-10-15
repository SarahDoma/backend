import { IsUUID } from 'class-validator';
import { IsStellarPublicKey } from '../../common/decorators/is-stellar-public-key.decorator';

export class TransferTicketDto {
  @IsUUID()
  toUserId!: string;

  /** Recipient wallet; checked before the build-tx call. */
  @IsStellarPublicKey()
  toPublicKey!: string;
}
