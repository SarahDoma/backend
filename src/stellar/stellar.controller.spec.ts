import { StellarController } from './stellar.controller';
import type { StellarService } from './stellar.service';

describe('StellarController', () => {
  it('exposes circuit-breaker metrics', () => {
    const metrics = { state: 'CLOSED', consecutiveFailures: 0 };
    const stellar = {
      getCircuitBreakerMetrics: jest.fn().mockReturnValue(metrics),
    } as unknown as StellarService;

    const controller = new StellarController(stellar);

    expect(controller.getCircuitBreakerMetrics()).toBe(metrics);
  });
});
