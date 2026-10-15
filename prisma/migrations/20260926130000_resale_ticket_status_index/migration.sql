-- #214 — resale lookups filter by ticket and status
-- (e.g. active listings per ticket, listing feeds, expiry sweeps).
-- Supports: WHERE "ticketId" = $1 [AND "status" = $2] as a single index scan.
CREATE INDEX IF NOT EXISTS "ResaleListing_ticketId_status_idx"
  ON "ResaleListing"("ticketId", "status");
