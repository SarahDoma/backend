import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TransferTicketDto } from './transfer-ticket.dto';

const UUID = '11111111-1111-4111-8111-111111111111';
const PUBKEY = 'GBAHZWO3UI3GAHPQCPSW6IR5N7HJ4UBRZNAFMSYB6DAKVNHQDOZIV2YJ';

describe('TransferTicketDto', () => {
  it('accepts a valid UUID and public key', async () => {
    const dto = plainToInstance(TransferTicketDto, {
      toUserId: UUID,
      toPublicKey: PUBKEY,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-UUID toUserId', async () => {
    const dto = plainToInstance(TransferTicketDto, {
      toUserId: 'nope',
      toPublicKey: PUBKEY,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'toUserId')).toBe(true);
  });

  it('rejects a missing toUserId', async () => {
    const dto = plainToInstance(TransferTicketDto, { toPublicKey: PUBKEY });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'toUserId')).toBe(true);
  });

  it('rejects a bad recipient public key', async () => {
    const dto = plainToInstance(TransferTicketDto, {
      toUserId: UUID,
      toPublicKey: 'G' + 'A'.repeat(55),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'toPublicKey')).toBe(true);
  });
});
