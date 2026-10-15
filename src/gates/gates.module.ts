import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { GatesController } from './gates.controller';
import { GatesService } from './gates.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [GatesController],
  providers: [GatesService],
  exports: [GatesService],
})
export class GatesModule {}
