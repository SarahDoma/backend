import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { OfflineTokenService } from './offline-token.service';

function pem(key: KeyObject, type: 'pkcs8' | 'spki') {
  return key.export({ type, format: 'pem' }) as string;
}

function buildKeyset(kid = 'test-key') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = pem(privateKey, 'pkcs8');
  const publicPem = pem(publicKey, 'spki');
  return { kid, privatePem, publicPem };
}

function buildService(
  kid: string,
  privatePem: string,
  publicKeys: Record<string, string>,
): OfflineTokenService {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'OFFLINE_SIGNING_KEY_ID') return kid;
      if (key === 'OFFLINE_SIGNING_PRIVATE_KEY') return privatePem;
      if (key === 'OFFLINE_SIGNING_PUBLIC_KEYS')
        return JSON.stringify(publicKeys);
      throw new Error(`unexpected key ${key}`);
    }),
  };
  const service = new OfflineTokenService(config as unknown as ConfigService);
  service.onModuleInit();
  return service;
}

describe('OfflineTokenService', () => {
  const future = Math.floor(Date.now() / 1000) + 3600;

  it('signs a payload and verifies it against the matching public key', () => {
    const { kid, privatePem, publicPem } = buildKeyset();
    const service = buildService(kid, privatePem, { [kid]: publicPem });

    const token = service.sign({
      ticketId: 't-1',
      chainTicketId: '1',
      eventId: 'e-1',
      status: 'VALID',
      exp: future,
    });

    expect(token.kid).toBe(kid);
    expect(service.verify(token)).toBe(true);
  });

  it('rejects a token whose signature does not match the payload', () => {
    const { kid, privatePem, publicPem } = buildKeyset();
    const service = buildService(kid, privatePem, { [kid]: publicPem });

    const token = service.sign({
      ticketId: 't-1',
      chainTicketId: '1',
      eventId: 'e-1',
      status: 'VALID',
      exp: future,
    });
    const tampered = {
      ...token,
      payload: { ...token.payload, status: 'USED' },
    };

    expect(service.verify(tampered)).toBe(false);
  });

  it('rejects an expired token even with a valid signature', () => {
    const { kid, privatePem, publicPem } = buildKeyset();
    const service = buildService(kid, privatePem, { [kid]: publicPem });

    const token = service.sign({
      ticketId: 't-1',
      chainTicketId: '1',
      eventId: 'e-1',
      status: 'VALID',
      exp: Math.floor(Date.now() / 1000) - 1,
    });

    expect(service.verify(token)).toBe(false);
  });

  it('rejects a token whose key id is not in the accepted key set', () => {
    const { kid, privatePem, publicPem } = buildKeyset();
    const service = buildService(kid, privatePem, { [kid]: publicPem });

    const token = service.sign({
      ticketId: 't-1',
      chainTicketId: '1',
      eventId: 'e-1',
      status: 'VALID',
      exp: future,
    });
    const relabelled = { ...token, kid: 'unknown-key' };

    expect(service.verify(relabelled)).toBe(false);
  });

  it('still verifies a token signed by a retired key during rotation', () => {
    const oldKey = buildKeyset('old-key');
    const newKey = buildKeyset('new-key');

    // Token was signed and handed out while "old-key" was current.
    const signer = buildService(oldKey.kid, oldKey.privatePem, {
      [oldKey.kid]: oldKey.publicPem,
    });
    const token = signer.sign({
      ticketId: 't-1',
      chainTicketId: '1',
      eventId: 'e-1',
      status: 'VALID',
      exp: future,
    });

    // After rotation, "new-key" signs, but "old-key" is still accepted.
    const rotated = buildService(newKey.kid, newKey.privatePem, {
      [oldKey.kid]: oldKey.publicPem,
      [newKey.kid]: newKey.publicPem,
    });

    expect(rotated.verify(token)).toBe(true);
  });

  it('exposes the public keys for scanners to cache', () => {
    const { kid, privatePem, publicPem } = buildKeyset();
    const service = buildService(kid, privatePem, { [kid]: publicPem });

    expect(service.getPublicKeys()).toEqual({ [kid]: publicPem });
  });

  it('throws on init if the current key id has no matching public key', () => {
    const { kid, privatePem } = buildKeyset();
    expect(() => buildService(kid, privatePem, {})).toThrow(
      /missing the current key id/,
    );
  });
});
