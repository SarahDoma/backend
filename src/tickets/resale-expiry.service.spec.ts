import { ResaleExpiryService } from './resale-expiry.service';
import type { TicketsService } from './tickets.service';

describe('ResaleExpiryService', () => {
  let service: ResaleExpiryService;
  let ticketsService: { cancelExpiredListings: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    ticketsService = {
      cancelExpiredListings: jest.fn().mockResolvedValue({ cancelledCount: 1 }),
    };

    service = new ResaleExpiryService(
      ticketsService as unknown as TicketsService,
    );
  });

  afterEach(() => {
    service.stopCron();
    jest.useRealTimers();
  });

  it('runs initial check on module init and sets up interval', () => {
    service.onModuleInit();
    expect(ticketsService.cancelExpiredListings).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    expect(ticketsService.cancelExpiredListings).toHaveBeenCalledTimes(2);
  });

  it('handles error in checkExpiredListings gracefully without crashing', async () => {
    ticketsService.cancelExpiredListings.mockRejectedValueOnce(
      new Error('DB failure'),
    );

    await expect(service.checkExpiredListings()).resolves.not.toThrow();
  });
});
