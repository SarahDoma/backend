import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ScannerDevicesService } from '../scanner-devices.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Authenticates a request via a revocable `ScannerDevice` bearer token
 * instead of a staff JWT, and scopes it to the ticket's event -- a device
 * registered for one event cannot check in tickets for another.
 */
@Injectable()
export class ScannerDeviceGuard implements CanActivate {
  constructor(
    private readonly scannerDevices: ScannerDevicesService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing scanner device token');
    }
    const device = await this.scannerDevices.authenticate(token);

    const ticketId = request.params.ticketId;
    if (typeof ticketId === 'string') {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { eventId: true },
      });
      if (!ticket || ticket.eventId !== device.eventId) {
        throw new UnauthorizedException(
          "This scanner device is not authorized for this ticket's event",
        );
      }
    }

    (request as Request & { scannerDevice: typeof device }).scannerDevice =
      device;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    const deviceHeader = request.headers['x-device-token'];
    return typeof deviceHeader === 'string' ? deviceHeader : undefined;
  }
}
