import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEventDto } from './create-event.dto';

function build(overrides: Record<string, unknown> = {}) {
  return plainToInstance(CreateEventDto, {
    name: 'Radiohead Live',
    category: 'CONCERTS',
    venue: 'Amphitheater',
    startsAt: '2026-09-14T20:00:00.000Z',
    ...overrides,
  });
}

describe('CreateEventDto', () => {
  it('accepts a well-formed payload with only required fields', async () => {
    const errors = await validate(build());
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid maxResaleMultiplierBps and royaltyBps', async () => {
    const errors = await validate(
      build({ maxResaleMultiplierBps: 12_000, royaltyBps: 500 }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a maxResaleMultiplierBps below 100% (would be a discount, not a cap)', async () => {
    const errors = await validate(build({ maxResaleMultiplierBps: 9_000 }));
    expect(errors.some((e) => e.property === 'maxResaleMultiplierBps')).toBe(
      true,
    );
  });

  it('rejects a royaltyBps above 20%', async () => {
    const errors = await validate(build({ royaltyBps: 2_500 }));
    expect(errors.some((e) => e.property === 'royaltyBps')).toBe(true);
  });

  it('rejects a non-date startsAt', async () => {
    const errors = await validate(build({ startsAt: 'not-a-date' }));
    expect(errors.some((e) => e.property === 'startsAt')).toBe(true);
  });

  it('rejects an unrecognized category', async () => {
    const errors = await validate(build({ category: 'SPACE_TRAVEL' }));
    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('accepts a payload with ticket types', async () => {
    const errors = await validate(
      build({
        ticketTypes: [{ name: 'General', price: '1000', quantityTotal: 100 }],
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a ticket type missing a required field', async () => {
    const errors = await validate(
      build({ ticketTypes: [{ price: '1000', quantityTotal: 100 }] }),
    );
    expect(errors.some((e) => e.property === 'ticketTypes')).toBe(true);
  });
});
