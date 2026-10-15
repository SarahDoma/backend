import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Industry } from '@prisma/client';
import { IsStellarPublicKey } from '../../common/decorators/is-stellar-public-key.decorator';

export class CreateOrganizationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(256)
  name!: string;

  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, and hyphen-separated',
  })
  @MaxLength(128)
  slug!: string;

  @IsEnum(Industry)
  industry!: Industry;

  @IsStellarPublicKey()
  stellarAccount!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  logoUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  websiteUrl?: string;

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
