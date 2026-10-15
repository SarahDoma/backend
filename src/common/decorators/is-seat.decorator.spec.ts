import { validate } from 'class-validator';
import { IsSeat } from './is-seat.decorator';

class TestDto {
  @IsSeat()
  seat!: string;
}

describe('IsSeat decorator', () => {
  it('accepts valid seats', async () => {
    const dto = new TestDto();
    dto.seat = 'A1';
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts seats with spaces', async () => {
    const dto = new TestDto();
    dto.seat = 'Row A Seat 1';
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts seats with hyphens and slashes', async () => {
    const dto = new TestDto();
    dto.seat = 'A-1/Floor-2';
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts seats with periods', async () => {
    const dto = new TestDto();
    dto.seat = 'A.1.Floor.2';
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects empty strings', async () => {
    const dto = new TestDto();
    dto.seat = '';
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints?.isSeat).toContain('1-64 characters');
  });

  it('rejects whitespace-only values', async () => {
    const dto = new TestDto();
    dto.seat = '   ';
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });

  it('rejects seats longer than 64 characters', async () => {
    const dto = new TestDto();
    dto.seat = 'A'.repeat(65);
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });

  it('rejects seats with special characters', async () => {
    const dto = new TestDto();
    dto.seat = 'A1@Special!';
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });

  it('rejects non-string values', async () => {
    const dto = new TestDto();
    (dto.seat as unknown) = 123;
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
