import { IsOptional, IsString, Matches } from 'class-validator';

/** Base shape for every "confirm" endpoint that relays a wallet-signed XDR envelope. */
export class ConfirmSignedTxDto {
  @IsString()
  signedXdr!: string;

  /** Optional 64-char hex transaction hash when the client already knows it. */
  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/i, {
    message: 'txHash must be a 64-character hex string',
  })
  txHash?: string;
}
