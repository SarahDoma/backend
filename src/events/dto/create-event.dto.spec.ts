import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Industry } from '@prisma/client';
import {
  CreateEventDto,
  STARTS_AT_PAST_TOLERANCE_MS,
} from './create-event.dto';

const inMs = (offset: number) => new Date(Date.now() + offset).toISOString();

function build(overrides: Record<string, unknown> = {}) {
  return plainToInstance(CreateEventDto, {
    name: 'Radiohead Live',
    category: 'CONCERTS',
    venue: 'Amphitheater',
    startsAt: inMs(24 * 60 * 60 * 1000),
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

  it('rejects a startsAt that has already elapsed', async () => {
    const errors = await validate(
      build({ startsAt: inMs(-24 * 60 * 60 * 1000) }),
    );
    const startsAtError = errors.find((e) => e.property === 'startsAt');

    expect(startsAtError).toBeDefined();
    expect(Object.values(startsAtError?.constraints ?? {})).toContain(
      'startsAt must not be in the past',
    );
  });

  it('tolerates a startsAt slightly in the past to absorb clock skew', async () => {
    const errors = await validate(
      build({ startsAt: inMs(-STARTS_AT_PAST_TOLERANCE_MS / 2) }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a startsAt just beyond the clock tolerance', async () => {
    const errors = await validate(
      build({ startsAt: inMs(-STARTS_AT_PAST_TOLERANCE_MS * 2) }),
    );
    expect(errors.some((e) => e.property === 'startsAt')).toBe(true);
  });

  it('rejects an unrecognized category and lists the allowed values', async () => {
    const errors = await validate(build({ category: 'SPACE_TRAVEL' }));
    const categoryError = errors.find((e) => e.property === 'category');

    expect(categoryError).toBeDefined();
    const message = Object.values(categoryError?.constraints ?? {})[0];
    expect(message).toContain('category must be one of');
    for (const value of Object.values(Industry)) {
      expect(message).toContain(value);
    }
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
