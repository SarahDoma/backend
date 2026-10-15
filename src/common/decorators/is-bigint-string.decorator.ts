import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Accepts a non-negative integer string suitable for `BigInt(...)`.
 * Digits only, no sign, no leading zeros (except `0`), at most 39 digits
 * so the value fits in a signed i128.
 */
const BIGINT_STRING_PATTERN = /^(0|[1-9]\d{0,38})$/;

export function IsBigIntString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isBigIntString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && BIGINT_STRING_PATTERN.test(value);
        },
        defaultMessage(): string {
          return '$property must be a non-negative integer string (digits only, max 39 digits)';
        },
      },
    });
  };
}
