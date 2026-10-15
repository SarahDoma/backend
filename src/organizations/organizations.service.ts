import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { OrgMemberRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const existingSlug = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    });
    if (existingSlug) {
      throw new ConflictException('That organization slug is already taken');
    }

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: dto });
      await tx.organizationMember.create({
        data: { organizationId: created.id, userId, role: OrgMemberRole.OWNER },
      });
      await tx.user.updateMany({
        where: { id: userId, role: UserRole.ATTENDEE },
        data: { role: UserRole.ORGANIZER },
      });
      return created;
    });

    // #209 — audit org creation (best-effort, never blocks the response).
    await this.audit?.record(
      userId,
      'organization.create',
      'Organization',
      org.id,
      {
        slug: org.slug,
      },
    );
    return org;
  }

  async findMine(userId: string) {
    return this.prisma.organization.findMany({
      // #207 — hide soft-deleted orgs.
      where: { members: { some: { userId } }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    // #207 — soft-deleted rows read as not-found.
    if (!org || (org as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return org;
  }

  /** #207 — soft-delete: sets `deletedAt` instead of hard-deleting. */
  async softDelete(userId: string, id: string) {
    await this.findOne(id);
    await this.assertMember(id, userId);
    const org = await this.prisma.organization.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit?.record(userId, 'organization.delete', 'Organization', id);
    return org;
  }

  /** #207 — restore a soft-deleted organization. */
  async restore(userId: string, id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    await this.assertMember(id, userId);
    const restored = await this.prisma.organization.update({
      where: { id },
      data: { deletedAt: null },
    });
    await this.audit?.record(
      userId,
      'organization.restore',
      'Organization',
      id,
    );
    return restored;
  }

  /** Throws unless `userId` is a member of `organizationId`. Used by Events/Tickets services to authorize writes. */
  async assertMember(organizationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }
  }
}
