import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

function build(overrides: Record<string, unknown> = {}) {
  return plainToInstance(RegisterDto, {
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    name: 'Ada Lovelace',
    ...overrides,
  });
}

describe('RegisterDto', () => {
  it('accepts a well-formed payload', async () => {
    const errors = await validate(build());
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const errors = await validate(build({ email: 'not-an-email' }));
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a password shorter than 10 characters', async () => {
    const errors = await validate(build({ password: 'short1' }));
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects an empty name', async () => {
    const errors = await validate(build({ name: '' }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims and lowercases the email so it stays valid', async () => {
    const dto = build({ email: '  Ada@Example.com  ' });
    expect(dto.email).toBe('ada@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('leaves a non-string email untouched for @IsEmail to reject', async () => {
    const dto = build({ email: undefined });
    expect(dto.email).toBeUndefined();
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
