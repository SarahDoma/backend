import { ConfigService } from '@nestjs/config';
import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  it('defaults missing flags to disabled', () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const flags = new FeatureFlagsService(config as unknown as ConfigService);

    expect(flags.snapshot()).toEqual({ feeBump: false, indexer: false });
  });

  it('reads flags from their typed environment keys', () => {
    const values: Record<string, string> = {
      FEATURE_FEE_BUMP: ' TRUE ',
      FEATURE_INDEXER: 'false',
    };
    const config = { get: jest.fn((key: string) => values[key]) };
    const flags = new FeatureFlagsService(config as unknown as ConfigService);

    expect(flags.isEnabled('feeBump')).toBe(true);
    expect(flags.isEnabled('indexer')).toBe(false);
  });
});
