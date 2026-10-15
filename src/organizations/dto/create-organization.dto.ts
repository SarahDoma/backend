import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Industry } from '@prisma/client';
import { IsStellarPublicKey } from '../../common/decorators/is-stellar-public-key.decorator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  name: string;

  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, and hyphen-separated',
  })
  slug: string;

  @IsEnum(Industry)
  industry: Industry;

  @IsStellarPublicKey()
  stellarAccount: string;

  /** Default basis-point resale cap applied to this org's events when their DTO omits it. */
  @IsOptional()
  @IsInt()
  @Min(10_000)
  @Max(50_000)
  defaultMaxResaleMultiplierBps?: number;

  /** Default basis-point resale royalty applied to this org's events when their DTO omits it. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000)
  defaultRoyaltyBps?: number;
}
