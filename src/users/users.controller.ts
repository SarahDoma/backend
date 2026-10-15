import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { ConnectWalletDto } from './dto/connect-wallet.dto';
import { LookupQuery } from './dto/lookup-query.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  findMe(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.findMe(user.userId);
  }

  @Patch('me/wallet')
  connectWallet(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ConnectWalletDto,
  ) {
    return this.usersService.connectWallet(user.userId, dto.stellarPublicKey);
  }

  @Get('lookup')
  lookupByEmail(@Query() query: LookupQuery) {
    return this.usersService.lookupByEmail(query.email);
  }
}
