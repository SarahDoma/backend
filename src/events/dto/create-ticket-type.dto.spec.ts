import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTicketTypeDto } from './create-ticket-type.dto';

function build(overrides: Record<string, unknown> = {}) {
  return plainToInstance(CreateTicketTypeDto, {
    name: 'GA',
    price: '1000',
    quantityTotal: 100,
    ...overrides,
  });
}

describe('CreateTicketTypeDto', () => {
  it('accepts a well-formed payload', async () => {
    expect(await validate(build())).toHaveLength(0);
  });

  it('rejects a zero quantityTotal', async () => {
    const errors = await validate(build({ quantityTotal: 0 }));
    expect(errors.some((e) => e.property === 'quantityTotal')).toBe(true);
  });

  it('rejects a negative quantityTotal', async () => {
    const errors = await validate(build({ quantityTotal: -5 }));
    expect(errors.some((e) => e.property === 'quantityTotal')).toBe(true);
  });

  it('rejects a non-integer quantityTotal', async () => {
    const errors = await validate(build({ quantityTotal: 1.5 }));
    expect(errors.some((e) => e.property === 'quantityTotal')).toBe(true);
  });

  it('rejects an empty name', async () => {
    const errors = await validate(build({ name: '' }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a non-numeric price string', async () => {
    const errors = await validate(build({ price: 'abc' }));
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });
});
