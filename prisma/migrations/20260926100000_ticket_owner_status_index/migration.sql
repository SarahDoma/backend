-- #213 — cover GET /tickets/mine which filters by owner and optional status.
-- Supports: WHERE "ownerId" = $1 [AND "status" = $2] ORDER BY "createdAt" DESC.
CREATE INDEX IF NOT EXISTS "Ticket_ownerId_status_idx"
  ON "Ticket"("ownerId", "status");
