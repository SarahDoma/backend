import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Fallback retention window when PENDING_TX_RETENTION_MINUTES isn't set. */
const DEFAULT_RETENTION_MINUTES = 60;

@Injectable()
export class PendingTxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get retentionMinutes(): number {
    const configured = this.config.get<number>('PENDING_TX_RETENTION_MINUTES');
    return configured && configured > 0
      ? configured
      : DEFAULT_RETENTION_MINUTES;
  }

  /** Records intent for a build-transaction flow. Call at the start of a `build*` method. */
  async record(type: string, userId: string, payload: Prisma.InputJsonValue) {
    const expiresAt = new Date(Date.now() + this.retentionMinutes * 60_000);
    return this.prisma.pendingTx.create({
      data: { type, userId, payload, expiresAt },
    });
  }

  /** Deletes every PendingTx row whose `expiresAt` has passed. Returns the count removed. */
  async deleteExpired(): Promise<number> {
    const result = await this.prisma.pendingTx.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
