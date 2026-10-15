import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '  ', 'false', 'FALSE'])(
    'treats %p as not trusting any proxy',
    (value) => {
      expect(parseTrustProxy(value)).toBe(false);
    },
  );

  it('trusts every hop for "true"', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });

  it('parses a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('accepts IPs, CIDR ranges, netmasks and presets', () => {
    expect(
      parseTrustProxy(
        'loopback, 10.0.0.0/8, 192.168.1.10, fd00::/8, 172.16.0.0/255.240.0.0, uniquelocal',
      ),
    ).toBe(
      'loopback,10.0.0.0/8,192.168.1.10,fd00::/8,172.16.0.0/255.240.0.0,uniquelocal',
    );
  });

  it.each([
    'yes',
    '10.0.0.0/33',
    'fd00::/129',
    '10.0.0.0/',
    '10.0.0.0/8/1',
    '300.1.1.1',
    'loopback,',
    '10.0.0.0/ffff::',
  ])('rejects %p', (value) => {
    expect(() => parseTrustProxy(value)).toThrow(/Invalid TRUST_PROXY entry/);
  });
});
