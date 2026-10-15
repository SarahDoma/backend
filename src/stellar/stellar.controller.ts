import { Controller, Get } from '@nestjs/common';
import { StellarService } from './stellar.service';

@Controller('stellar')
export class StellarController {
  constructor(private readonly stellar: StellarService) {}

  @Get('circuit-breaker/metrics')
  getCircuitBreakerMetrics() {
    return this.stellar.getCircuitBreakerMetrics();
  }
}
