-- #211 — enforce that a seat is issued once per event, ignoring unassigned seats.
-- Partial unique index (Prisma cannot express WHERE, so this is raw SQL by design).
-- Tested against the schema: duplicate (eventId, seat) with seat <> 'unassigned' fails,
-- while any number of 'unassigned' rows per event succeed.
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_eventId_seat_partial_key"
  ON "Ticket"("eventId", "seat")
  WHERE "seat" <> 'unassigned';
