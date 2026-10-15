import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IssueTicketDto } from './issue-ticket.dto';

const UUID = '11111111-1111-4111-8111-111111111111';
const PUBKEY = 'GBAHZWO3UI3GAHPQCPSW6IR5N7HJ4UBRZNAFMSYB6DAKVNHQDOZIV2YJ';

describe('IssueTicketDto', () => {
  it('accepts a payload without a seat', async () => {
    const dto = plainToInstance(IssueTicketDto, {
      ticketTypeId: UUID,
      toUserId: UUID,
      toPublicKey: PUBKEY,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a payload with a seat', async () => {
    const dto = plainToInstance(IssueTicketDto, {
      ticketTypeId: UUID,
      toUserId: UUID,
      toPublicKey: PUBKEY,
      seat: 'A1',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-UUID ticketTypeId', async () => {
    const dto = plainToInstance(IssueTicketDto, {
      ticketTypeId: 'not-a-uuid',
      toUserId: UUID,
      toPublicKey: PUBKEY,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'ticketTypeId')).toBe(true);
  });

  it('rejects a non-UUID toUserId', async () => {
    const dto = plainToInstance(IssueTicketDto, {
      ticketTypeId: UUID,
      toUserId: 'nope',
      toPublicKey: PUBKEY,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'toUserId')).toBe(true);
  });

  it('rejects a bad recipient public key', async () => {
    const dto = plainToInstance(IssueTicketDto, {
      ticketTypeId: UUID,
      toUserId: UUID,
      toPublicKey: 'not-a-real-address',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'toPublicKey')).toBe(true);
  });
});
