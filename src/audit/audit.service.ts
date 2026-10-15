import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * #209 — best-effort audit trail for sensitive actions.
 * Stores actor, action, entity and timestamp. Failures never break the
 * primary write path (audit is observability, not authorization).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async record(
    actorId: string | null | undefined,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.prisma) return;
    const delegate = (this.prisma as unknown as Record<string, unknown>)
      .auditLog as { create: (args: unknown) => Promise<unknown> } | undefined;
    if (!delegate) return;
    try {
      await delegate.create({
        data: {
          actorId: actorId ?? null,
          action,
          entityType,
          entityId,
          ...(metadata !== undefined ? { metadata } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log ${action} ${entityType}:${entityId}: ${(err as Error).message}`,
      );
    }
  }
}
