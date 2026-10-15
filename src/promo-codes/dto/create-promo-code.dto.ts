import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';
import { PromoCodeDiscountType } from '@prisma/client';

export class CreatePromoCodeDto {
  @Matches(/^[A-Z0-9_-]{3,32}$/, {
    message:
      'code must be 3-32 characters of uppercase letters, digits, underscore, or hyphen',
  })
  code!: string;

  @IsEnum(PromoCodeDiscountType)
  discountType!: PromoCodeDiscountType;

  /** Basis points (0-10000) for PERCENT, or a smallest-unit amount for FIXED. */
  @IsInt()
  @Min(1)
  discountValue!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
