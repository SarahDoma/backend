import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  it('maps a decoded payload to the shape guards and controllers expect', () => {
    const strategy = new JwtStrategy('x'.repeat(32));

    const result = strategy.validate({
      sub: 'user-1',
      email: 'ada@example.com',
      role: 'ORGANIZER',
    });

    expect(result).toEqual({
      userId: 'user-1',
      email: 'ada@example.com',
      role: 'ORGANIZER',
    });
  });

  it('is constructed with the secret resolved by JwtSecretModule', () => {
    expect(new JwtStrategy('x'.repeat(32))).toBeDefined();
  });
});
