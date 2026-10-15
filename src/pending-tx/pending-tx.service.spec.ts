import { PendingTxService } from './pending-tx.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';

type CreateArgs = {
  data: { type: string; userId: string; payload: unknown; expiresAt: Date };
};

describe('PendingTxService', () => {
  let service: PendingTxService;
  let prisma: {
    pendingTx: { create: jest.Mock; deleteMany: jest.Mock };
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      pendingTx: {
        create: jest.fn().mockResolvedValue({ id: 'pt-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    config = { get: jest.fn().mockReturnValue(undefined) };

    service = new PendingTxService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('records a pending tx with an expiry derived from the default retention window', async () => {
    const before = Date.now();
    await service.record('purchase', 'user-1', { ticketTypeId: 'tt-1' });

    expect(prisma.pendingTx.create).toHaveBeenCalledTimes(1);
    const { data } = (prisma.pendingTx.create.mock.calls[0] as [CreateArgs])[0];
    expect(data.type).toBe('purchase');
    expect(data.userId).toBe('user-1');
    expect(data.payload).toEqual({ ticketTypeId: 'tt-1' });
    expect(data.expiresAt.getTime()).toBeGreaterThan(before + 59 * 60_000);
  });

  it('honors a configured retention window', async () => {
    config.get.mockReturnValue(5);
    const before = Date.now();
    await service.record('issue', 'user-1', {});

    const { data } = (prisma.pendingTx.create.mock.calls[0] as [CreateArgs])[0];
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(
      before + 5 * 60_000 + 1_000,
    );
  });

  it('deletes expired rows and returns the count removed', async () => {
    const count = await service.deleteExpired();

    expect(prisma.pendingTx.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) as Date } },
    });
    expect(count).toBe(3);
  });
});
