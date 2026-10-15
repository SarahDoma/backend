import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RevokeBatchDto } from './revoke-batch.dto';

describe('RevokeBatchDto', () => {
  it('should validate a valid batch of ticket IDs', async () => {
    const dto = plainToInstance(RevokeBatchDto, {
      ticketIds: ['id1', 'id2', 'id3'],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject non-array ticketIds', async () => {
    const dto = plainToInstance(RevokeBatchDto, {
      ticketIds: 'not-an-array',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-string ticket IDs', async () => {
    const dto = plainToInstance(RevokeBatchDto, {
      ticketIds: [123, 456],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject ticket IDs exceeding length limit', async () => {
    const longId = 'a'.repeat(101);
    const dto = plainToInstance(RevokeBatchDto, {
      ticketIds: [longId],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept empty array', async () => {
    const dto = plainToInstance(RevokeBatchDto, {
      ticketIds: [],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
