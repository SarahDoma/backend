import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { RegisterScannerDeviceDto } from './dto/register-scanner-device.dto';

const TOKEN_PREFIX = 'scn';

@Injectable()
export class ScannerDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Registers a device and returns its raw bearer token once -- only the hash is persisted. */
  async register(
    userId: string,
    eventId: string,
    dto: RegisterScannerDeviceDto,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    // #207 — soft-deleted events behave as not-found.
    if (!event || (event as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Event not found');
    }
    await this.organizations.assertMember(event.organizationId, userId);

    const token = `${TOKEN_PREFIX}_${randomBytes(32).toString('hex')}`;
    const device = await this.prisma.scannerDevice.create({
      data: { eventId, name: dto.name, tokenHash: this.hash(token) },
    });
    return { device, token };
  }

  async listForEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event || (event as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Event not found');
    }
    await this.organizations.assertMember(event.organizationId, userId);

    return this.prisma.scannerDevice.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, eventId: string, deviceId: string) {
    const device = await this.prisma.scannerDevice.findUnique({
      where: { id: deviceId },
      include: { event: true },
    });
    if (!device || device.eventId !== eventId) {
      throw new NotFoundException('Scanner device not found');
    }
    await this.organizations.assertMember(device.event.organizationId, userId);
    return this.prisma.scannerDevice.update({
      where: { id: deviceId },
      data: { revokedAt: new Date() },
    });
  }

  /** Validates a raw bearer token, returning the live (non-revoked) device it belongs to. */
  async authenticate(token: string) {
    const device = await this.prisma.scannerDevice.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!device || device.revokedAt) {
      throw new UnauthorizedException(
        'Invalid or revoked scanner device token',
      );
    }
    await this.prisma.scannerDevice.update({
      where: { id: device.id },
      data: { lastUsedAt: new Date() },
    });
    return device;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
