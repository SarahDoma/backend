import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { GatesService } from './gates.service';
import { CreateGateDto } from './dto/create-gate.dto';

@Controller('events/:eventId/gates')
@UseGuards(JwtAuthGuard)
export class GatesController {
  constructor(private readonly gates: GatesService) {}

  @Post()
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Body() dto: CreateGateDto,
  ) {
    return this.gates.create(user.userId, eventId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
  ) {
    return this.gates.listForEvent(user.userId, eventId);
  }

  @Delete(':gateId')
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId') eventId: string,
    @Param('gateId') gateId: string,
  ) {
    return this.gates.remove(user.userId, eventId, gateId);
  }
}
