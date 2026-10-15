import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

/**
 * Payload embedded in a ticket's offline-verifiable QR code.
 *
 * Kept intentionally small: a gate scanner with no network round-trips this
 * straight off the QR code, so every extra field is bytes the attendee's
 * phone has to render and the scanner has to decode.
 */
export interface OfflineTicketPayload {
  ticketId: string;
  chainTicketId: string;
  eventId: string;
  status: string;
  /** Unix seconds after which the token must be treated as stale and re-verified online. */
  exp: number;
}

export interface SignedOfflineToken {
  payload: OfflineTicketPayload;
  /** Key id of the key that produced `signature`, so a scanner can pick the right public key during rotation. */
  kid: string;
  /** base64url Ed25519 signature over the JSON-encoded payload. */
  signature: string;
}

/**
 * Signs and verifies offline ticket payloads with Ed25519.
 *
 * Gate scanners have no network at the door, so verification can't be a
 * server round trip. Instead, the backend signs a small payload when a
 * ticket is issued or reconciled, the scanner app caches the current public
 * key(s) while it *does* have network (see `getPublicKeys`), and checks the
 * signature locally against a QR code that embeds `{ payload, kid,
 * signature }` alongside the existing online `qrSecret`.
 *
 * Key rotation: `OFFLINE_SIGNING_KEY_ID` / `OFFLINE_SIGNING_PRIVATE_KEY`
 * identify the key currently used to sign new tokens.
 * `OFFLINE_SIGNING_PUBLIC_KEYS` is a JSON map of every key id a scanner
 * should still accept, including retired ones, so tokens signed before a
 * rotation keep verifying until they naturally expire (`exp`). See
 * docs/OFFLINE_VERIFICATION.md for the rotation runbook.
 */
@Injectable()
export class OfflineTokenService implements OnModuleInit {
  private currentKid!: string;
  private privateKey!: ReturnType<typeof createPrivateKey>;
  private publicKeys!: Map<string, ReturnType<typeof createPublicKey>>;
  private publicKeysPem!: Record<string, string>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.currentKid = this.config.getOrThrow<string>('OFFLINE_SIGNING_KEY_ID');
    this.privateKey = createPrivateKey(
      this.config.getOrThrow<string>('OFFLINE_SIGNING_PRIVATE_KEY'),
    );

    this.publicKeysPem = JSON.parse(
      this.config.getOrThrow<string>('OFFLINE_SIGNING_PUBLIC_KEYS'),
    ) as Record<string, string>;
    this.publicKeys = new Map(
      Object.entries(this.publicKeysPem).map(([kid, pem]) => [
        kid,
        createPublicKey(pem),
      ]),
    );

    if (!this.publicKeys.has(this.currentKid)) {
      throw new Error(
        `OFFLINE_SIGNING_PUBLIC_KEYS is missing the current key id "${this.currentKid}" — every key that can sign must also be listed there so scanners can verify it.`,
      );
    }
  }

  /** PEM-encoded public keys, by key id, for scanner apps to fetch and cache while online. */
  getPublicKeys(): Record<string, string> {
    return this.publicKeysPem;
  }

  sign(payload: OfflineTicketPayload): SignedOfflineToken {
    const message = Buffer.from(JSON.stringify(payload));
    const signature = sign(null, message, this.privateKey);
    return {
      payload,
      kid: this.currentKid,
      signature: signature.toString('base64url'),
    };
  }

  /**
   * Verifies a token entirely offline given the payload, its claimed key id,
   * and the cached public keys. Static so a gate app (or a test) can lift
   * this verification logic without depending on server-side config.
   */
  static verify(
    token: SignedOfflineToken,
    publicKeysPem: Record<string, string>,
  ): boolean {
    const pem = publicKeysPem[token.kid];
    if (!pem) return false;
    if (token.payload.exp < Math.floor(Date.now() / 1000)) return false;

    try {
      const publicKey = createPublicKey(pem);
      const message = Buffer.from(JSON.stringify(token.payload));
      return verify(
        null,
        message,
        publicKey,
        Buffer.from(token.signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }

  verify(token: SignedOfflineToken): boolean {
    return OfflineTokenService.verify(token, this.publicKeysPem);
  }
}
