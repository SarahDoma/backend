import { validate } from 'class-validator';
import { IsStellarPublicKey } from './is-stellar-public-key.decorator';

class TestDto {
  @IsStellarPublicKey()
  stellarAccount!: string;
}

describe('IsStellarPublicKey', () => {
  it('accepts a valid ed25519 Stellar public key', async () => {
    const dto = new TestDto();
    dto.stellarAccount =
      'GBAHZWO3UI3GAHPQCPSW6IR5N7HJ4UBRZNAFMSYB6DAKVNHQDOZIV2YJ';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a string that is not a valid public key', async () => {
    const dto = new TestDto();
    dto.stellarAccount = 'not-a-real-address';

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isStellarPublicKey');
  });

  it('rejects a secret key (S...) passed where a public key belongs', async () => {
    const dto = new TestDto();
    dto.stellarAccount =
      'SA4IGCSRIDQ3L4274BRKUGPMVCDB4A6IHFKRGMHLLZ7TPOIC4TEEI6QX';

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
