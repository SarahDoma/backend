/**
 * prisma/seed.ts — local development seed
 *
 * Creates a demo user, organiser, event and two ticket types so new
 * contributors have a populated DB immediately after running
 * `npx prisma migrate dev`.
 *
 * Run manually:   npm run db:seed
 * Auto-seeded:    npx prisma migrate reset (calls seed automatically)
 *
 * Idempotent: each resource is upserted on its natural unique key, so
 * running the script more than once is safe.
 */

import { PrismaClient, Industry, UserRole, OrgMemberRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // ── 1. Demo attendee user ────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const attendee = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      email: 'alice@example.com',
      passwordHash,
      name: 'Alice Demo',
      role: UserRole.ATTENDEE,
    },
  });

  // ── 2. Demo organiser user ───────────────────────────────────────────────
  const organiser = await prisma.user.upsert({
    where: { email: 'organiser@example.com' },
    update: {},
    create: {
      email: 'organiser@example.com',
      passwordHash,
      name: 'Bob Organiser',
      role: UserRole.ORGANIZER,
    },
  });

  // ── 3. Organisation ──────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'stellar-events-demo' },
    update: {},
    create: {
      name: 'Stellar Events Demo',
      slug: 'stellar-events-demo',
      industry: Industry.CONCERTS,
      // Placeholder Stellar G-address — replace with a real testnet key if
      // you need to exercise on-chain flows locally.
      stellarAccount: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    },
  });

  // ── 4. Org membership ────────────────────────────────────────────────────
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: organiser.id,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      userId: organiser.id,
      role: OrgMemberRole.OWNER,
    },
  });

  // ── 5. Draft event ───────────────────────────────────────────────────────
  // Events have no natural unique key exposed by Prisma, so we look up by
  // the org + name pair to keep the seed idempotent.
  let event = await prisma.event.findFirst({
    where: { organizationId: org.id, name: 'StellarFest 2027' },
  });

  if (!event) {
    event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: 'StellarFest 2027',
        category: Industry.CONCERTS,
        venue: 'The Stellar Arena, Cape Town',
        startsAt: new Date('2027-03-15T19:00:00Z'),
        endsAt: new Date('2027-03-15T23:00:00Z'),
      },
    });
  }

  // ── 6. Ticket types ──────────────────────────────────────────────────────
  await prisma.ticketType.upsert({
    where: { eventId_name: { eventId: event.id, name: 'General Admission' } },
    update: {},
    create: {
      eventId: event.id,
      name: 'General Admission',
      // Price in stroops (1 XLM = 10_000_000 stroops). 10 XLM here.
      price: BigInt(100_000_000),
      quantityTotal: 500,
      saleStartsAt: new Date('2027-01-01T00:00:00Z'),
    },
  });

  await prisma.ticketType.upsert({
    where: { eventId_name: { eventId: event.id, name: 'VIP' } },
    update: {},
    create: {
      eventId: event.id,
      name: 'VIP',
      // 50 XLM
      price: BigInt(500_000_000),
      quantityTotal: 50,
      saleStartsAt: new Date('2027-01-01T00:00:00Z'),
    },
  });

  console.log(`✅  Seed complete.
  Attendee  : alice@example.com        (password: Password123!)
  Organiser : organiser@example.com    (password: Password123!)
  Org       : ${org.name} (slug: ${org.slug})
  Event     : ${event.name} @ ${event.venue}
  Attendee id: ${attendee.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
