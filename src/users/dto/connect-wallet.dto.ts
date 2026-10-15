import { IsStellarPublicKey } from '../../common/decorators/is-stellar-public-key.decorator';

export class ConnectWalletDto {
  @IsStellarPublicKey()
  stellarPublicKey!: string;
}
