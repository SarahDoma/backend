import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { RATE_LIMIT_STORE } from '../rate-limit/rate-limit-store';
import type { RateLimitStore } from '../rate-limit/rate-limit-store';

/**
 * Fixed-window velocity limit on ticket verification scans, keyed
 * independently by requester IP and by the `qrSecret` being scanned.
 *
 * A gate scanner is normally slow and human-paced, so either axis spiking —
 * one IP hammering many secrets, or one secret being replayed rapidly —
 * indicates brute forcing or a photographed/replayed QR code rather than
 * legitimate gate traffic. Either axis tripping the limit rejects the
 * request; a request only has to fail one check to be abuse.
 *
 * Counters live in the injected `RateLimitStore`: in-process memory by
 * default (single instance), or Redis (`RATE_LIMIT_STORE=redis`) so limits
 * hold across instances. See docs/RATE_LIMITING.md.
 */
@Injectable()
export class ScanRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ScanRateLimitGuard.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const max = this.config.get<number>('SCAN_RATE_LIMIT_MAX', 10);
    const windowMs = this.config.get<number>(
      'SCAN_RATE_LIMIT_WINDOW_MS',
      60_000,
    );

    const ip = request.ip ?? 'unknown';
    const qrSecret = String(request.params['qrSecret'] ?? 'unknown');

    await this.assertWithinLimit(`scan:ip:${ip}`, max, windowMs, 'this IP');
    // Hashed so a shared store never holds a usable ticket secret as a key.
    await this.assertWithinLimit(
      `scan:secret:${createHash('sha256').update(qrSecret).digest('hex')}`,
      max,
      windowMs,
      'this ticket',
    );

    return true;
  }

  private async assertWithinLimit(
    key: string,
    max: number,
    windowMs: number,
    subject: string,
  ): Promise<void> {
    let count: number;
    try {
      ({ count } = await this.store.hit(key, windowMs));
    } catch (err) {
      // Fail open: a store outage must not lock every gate scanner out.
      this.logger.warn(
        `Rate-limit store unavailable, allowing request: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (count > max) {
      throw new HttpException(
        `Too many verification attempts for ${subject}. Try again shortly.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
