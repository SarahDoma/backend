import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreateGateDto } from './dto/create-gate.dto';

@Injectable()
export class GatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
  ) {}

  async create(userId: string, eventId: string, dto: CreateGateDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    // #207 — soft-deleted events behave as not-found.
    if (!event || (event as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Event not found');
    }
    await this.organizations.assertMember(event.organizationId, userId);

    const existing = await this.prisma.gate.findUnique({
      where: { eventId_name: { eventId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(
        'A gate with this name already exists for this event',
      );
    }

    return this.prisma.gate.create({ data: { eventId, name: dto.name } });
  }

  async listForEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event || (event as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Event not found');
    }
    await this.organizations.assertMember(event.organizationId, userId);

    return this.prisma.gate.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(userId: string, eventId: string, gateId: string) {
    const gate = await this.prisma.gate.findUnique({
      where: { id: gateId },
      include: { event: true },
    });
    if (!gate || gate.eventId !== eventId) {
      throw new NotFoundException('Gate not found');
    }
    await this.organizations.assertMember(gate.event.organizationId, userId);
    await this.prisma.gate.delete({ where: { id: gateId } });
  }

  /** Throws unless `gateId` belongs to `eventId`. Used by check-in to attribute a scan. */
  async assertBelongsToEvent(gateId: string, eventId: string) {
    const gate = await this.prisma.gate.findUnique({ where: { id: gateId } });
    if (!gate || gate.eventId !== eventId) {
      throw new NotFoundException('Gate not found for this event');
    }
    return gate;
  }
}
