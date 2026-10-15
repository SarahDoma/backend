import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class LookupQuery {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;
}
