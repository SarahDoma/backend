import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LookupQuery } from './lookup-query.dto';

describe('LookupQuery', () => {
  it('accepts a well-formed email', async () => {
    const query = plainToInstance(LookupQuery, { email: 'ada@example.com' });
    expect(await validate(query)).toHaveLength(0);
  });

  it('trims and lowercases the email so lookups match the stored value', async () => {
    const query = plainToInstance(LookupQuery, {
      email: 'User@Example.com ',
    });
    expect(query.email).toBe('user@example.com');
    expect(await validate(query)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const query = plainToInstance(LookupQuery, { email: 'not-an-email' });
    const errors = await validate(query);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
