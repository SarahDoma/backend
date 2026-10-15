import { ExecutionContext, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MemoryRateLimitStore } from '../rate-limit/memory-rate-limit.store';
import type { RateLimitStore } from '../rate-limit/rate-limit-store';
import { ScanRateLimitGuard } from './scan-rate-limit.guard';

function mockContext(ip: string, qrSecret: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, params: { qrSecret } }),
    }),
  } as unknown as ExecutionContext;
}

function guardWithLimits(
  max: number,
  windowMs: number,
  store: RateLimitStore = new MemoryRateLimitStore(),
): ScanRateLimitGuard {
  const config = {
    get: jest.fn((key: string) =>
      key === 'SCAN_RATE_LIMIT_MAX' ? max : windowMs,
    ),
  };
  return new ScanRateLimitGuard(config as unknown as ConfigService, store);
}

describe('ScanRateLimitGuard', () => {
  it('allows requests within the limit', async () => {
    const guard = guardWithLimits(3, 60_000);
    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-a')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-a')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-a')),
    ).resolves.toBe(true);
  });

  it('rejects once the same IP exceeds the limit, even across different secrets', async () => {
    const guard = guardWithLimits(2, 60_000);
    await guard.canActivate(mockContext('1.1.1.1', 'secret-a'));
    await guard.canActivate(mockContext('1.1.1.1', 'secret-b'));

    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-c')),
    ).rejects.toThrow(HttpException);
  });

  it('rejects once the same secret is scanned too many times, even from different IPs', async () => {
    const guard = guardWithLimits(2, 60_000);
    await guard.canActivate(mockContext('1.1.1.1', 'secret-a'));
    await guard.canActivate(mockContext('2.2.2.2', 'secret-a'));

    await expect(
      guard.canActivate(mockContext('3.3.3.3', 'secret-a')),
    ).rejects.toThrow(HttpException);
  });

  it('does not let one IP/secret pair affect another', async () => {
    const guard = guardWithLimits(1, 60_000);
    await guard.canActivate(mockContext('1.1.1.1', 'secret-a'));

    await expect(
      guard.canActivate(mockContext('2.2.2.2', 'secret-b')),
    ).resolves.toBe(true);
  });

  it('resets the count after the window elapses', async () => {
    const guard = guardWithLimits(1, 10);
    await guard.canActivate(mockContext('1.1.1.1', 'secret-a'));
    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-a')),
    ).rejects.toThrow(HttpException);

    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-a')),
    ).resolves.toBe(true);
  });

  it('falls back to defaults when config values are unset', async () => {
    const config = {
      get: jest.fn((_key: string, fallback: number) => fallback),
    };
    const guard = new ScanRateLimitGuard(
      config as unknown as ConfigService,
      new MemoryRateLimitStore(),
    );

    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-a')),
    ).resolves.toBe(true);
  });

  it('never hands the raw QR secret to the store', async () => {
    const hit = jest.fn().mockResolvedValue({ count: 1, resetsAt: 0 });
    const guard = guardWithLimits(3, 60_000, { hit });

    await guard.canActivate(mockContext('1.1.1.1', 'super-secret-qr'));

    const keys = hit.mock.calls.map(([key]) => key as string);
    expect(keys).toHaveLength(2);
    expect(keys.some((key) => key.includes('super-secret-qr'))).toBe(false);
  });

  it('allows the request when the store is unavailable rather than locking out scanners', async () => {
    const hit = jest.fn().mockRejectedValue(new Error('redis down'));
    const guard = guardWithLimits(1, 60_000, { hit });

    await expect(
      guard.canActivate(mockContext('1.1.1.1', 'secret-a')),
    ).resolves.toBe(true);
  });
});
