import { Controller, Get } from '@nestjs/common';
import { Industry } from '@prisma/client';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('industries')
  getIndustries() {
    return Object.values(Industry);
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }
}
