import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class OfferNextDto {
  @IsInt()
  @Min(1)
  @Max(500)
  count!: number;

  /** Offer validity window in milliseconds. Defaults to 24h in the service. */
  @IsOptional()
  @IsInt()
  @Min(60_000)
  windowMs?: number;
}
