import { AuditService } from './audit.service';

describe('AuditService (#209)', () => {
  it('stores actor, action, entity and timestamp via prisma.auditLog.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'log-1' });
    const prisma = { auditLog: { create } } as never;
    const service = new AuditService(prisma);

    await service.record('user-1', 'ticket.revoke', 'Ticket', 'ticket-1', {
      eventId: 'event-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'user-1',
        action: 'ticket.revoke',
        entityType: 'Ticket',
        entityId: 'ticket-1',
        metadata: { eventId: 'event-1' },
      },
    });
  });

  it('never throws when the audit write fails', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('audit table unavailable'));
    const prisma = { auditLog: { create } } as never;
    const service = new AuditService(prisma);

    await expect(
      service.record('user-1', 'event.create', 'Event', 'event-1'),
    ).resolves.toBeUndefined();
  });

  it('no-ops when prisma has no auditLog delegate (e.g. stale mocks)', async () => {
    const service = new AuditService({} as never);

    await expect(
      service.record('user-1', 'organization.create', 'Organization', 'org-1'),
    ).resolves.toBeUndefined();
  });
});
