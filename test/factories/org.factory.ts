import type { Organization } from '@prisma/client';

let counter = 0;

/** Returns a fully-valid `Organization` row, with realistic defaults, merged with `overrides`. */
export function createOrganization(
  overrides: Partial<Organization> = {},
): Organization {
  const n = ++counter;
  return {
    id: `org-${n}`,
    name: `Test Org ${n}`,
    slug: `test-org-${n}`,
    industry: 'CONCERTS',
    stellarAccount: 'G'.repeat(56),
    logoUrl: null,
    websiteUrl: null,
    defaultMaxResaleMultiplierBps: 11_000,
    defaultRoyaltyBps: 500,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    // #207 — soft-delete marker (null = live).
    deletedAt: null,
    ...overrides,
  };
}
