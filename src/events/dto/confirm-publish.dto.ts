import { IsOptional, IsString, Matches } from 'class-validator';

export class ConfirmPublishDto {
  /** Wallet-signed XDR envelope returned from POST /events/:id/publish, unmodified. */
  @IsString()
  signedXdr!: string;

  /** Optional 64-char hex transaction hash when the client already knows it. */
  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/i, {
    message: 'txHash must be a 64-character hex string',
  })
  txHash?: string;
}
