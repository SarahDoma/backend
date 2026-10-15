import { IsBigIntString } from '../../common/decorators/is-bigint-string.decorator';

export class UpdateResalePriceDto {
  /** Updated asking price in settlement token smallest units. */
  @IsBigIntString()
  price!: string;
}
