import { IsDateString, IsOptional } from 'class-validator';
import { IsBigIntString } from '../../common/decorators/is-bigint-string.decorator';

export class ListForResaleDto {
  /** Asking price in the settlement token's smallest unit, as a string to preserve i128 precision. */
  @IsBigIntString()
  price!: string;

  /** Optional expiration date for the resale listing. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
