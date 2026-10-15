import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FEATURE_FLAG_ENV = {
  feeBump: 'FEATURE_FEE_BUMP',
  indexer: 'FEATURE_INDEXER',
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAG_ENV;

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(flag: FeatureFlag): boolean {
    return (
      this.config.get<string>(FEATURE_FLAG_ENV[flag])?.trim().toLowerCase() ===
      'true'
    );
  }

  snapshot(): Readonly<Record<FeatureFlag, boolean>> {
    return {
      feeBump: this.isEnabled('feeBump'),
      indexer: this.isEnabled('indexer'),
    };
  }
}
