-- #216 — nothing in the schema prevented two ACTIVE ResaleListing rows for
-- a ticket. Partial unique index (Prisma cannot express WHERE, so this is
-- raw SQL by design): concurrent creates for the same ticket cannot both
-- succeed — the loser gets a P2002 that TicketsService maps to 409.
-- Non-ACTIVE rows are excluded so a ticket can be re-listed after its
-- listing is sold or cancelled while history stays intact.
CREATE UNIQUE INDEX IF NOT EXISTS "ResaleListing_ticketId_active_key"
  ON "ResaleListing"("ticketId")
  WHERE "status" = 'ACTIVE';
