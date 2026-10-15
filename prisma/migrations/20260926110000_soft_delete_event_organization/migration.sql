-- #207 — soft-delete columns for Event and Organization.
-- App queries filter `deletedAt IS NULL`; hard-delete cascades below are unchanged
-- and only run via manual ops / `prisma migrate reset` (see docs/DATABASE.md).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Organization_deletedAt_idx" ON "Organization"("deletedAt");
CREATE INDEX IF NOT EXISTS "Event_deletedAt_idx" ON "Event"("deletedAt");
CREATE INDEX IF NOT EXISTS "Event_organizationId_deletedAt_idx" ON "Event"("organizationId", "deletedAt");
