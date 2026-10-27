import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

if (process.env.SEED_DEMO_DATA !== 'true') {
  throw new Error('Seeding is disabled. Set SEED_DEMO_DATA=true for this command.');
}
const ownerId = process.env.SEED_OWNER_ID;
if (!ownerId) throw new Error('Set SEED_OWNER_ID to an existing BorrowBox user id. The seed script never creates sample accounts or passwords.');

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!user) throw new Error('SEED_OWNER_ID does not match an existing user. Register and sign in first, then copy your own user id.');
  const listingTitle = 'Weekend mirrorless camera kit';
  const existingListing = await prisma.listing.findFirst({ where: { ownerId, title: listingTitle } });
  if (!existingListing) await prisma.listing.create({ data: { ownerId, title: listingTitle, description: 'A lightweight mirrorless camera with a standard zoom lens, two batteries and a small carry pouch. Great for a weekend project or event.', category: 'Cameras', dailyPricePaise: 35000, depositPaise: 500000, condition: 'Good', pickupArea: 'Central neighborhood', conditions: 'Please return the kit with both batteries and the lens cap.', status: 'ACTIVE' } });
  const requestTitle = 'Projector for a study group';
  const existingRequest = await prisma.borrowRequest.findFirst({ where: { requesterId: ownerId, title: requestTitle, status: 'OPEN' } });
  if (!existingRequest) {
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const startDate = new Date(today); startDate.setUTCDate(startDate.getUTCDate() + 7);
    const endDate = new Date(startDate); endDate.setUTCDate(endDate.getUTCDate() + 1);
    const expiresAt = new Date(today); expiresAt.setUTCDate(expiresAt.getUTCDate() + 30);
    await prisma.borrowRequest.create({ data: { requesterId: ownerId, title: requestTitle, description: 'Looking for a compact projector with HDMI input for a one-day group presentation. A screen is not needed.', category: 'Electronics', startDate, endDate, budgetPaise: 50000, location: 'Central neighborhood', radiusKm: 10, expiresAt, status: 'OPEN' } });
  }
  console.log('Demo listing and borrowing request are ready for the selected existing account.');
} finally {
  await prisma.$disconnect();
}
