import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { authenticate } from './auth.js';
import { HttpError } from './http.js';
import { calculateBookingPrice } from './pricing.js';

export const conversations = Router();
conversations.use(authenticate);
const contextInput = z.object({ listingId: z.string().min(1).optional(), requestId: z.string().min(1).optional() }).refine(v => Boolean(v.listingId) || Boolean(v.requestId), 'Provide a listingId, requestId, or both.');
const offerInput = z.object({ startDate: z.coerce.date(), endDate: z.coerce.date(), dailyPricePaise: z.number().int().min(100).max(100_000_000), depositPaise: z.number().int().min(0).max(500_000_000).default(0), message: z.string().trim().max(1000).optional() }).refine(v => v.startDate < v.endDate, { message: 'End date must be after start date.', path: ['endDate'] });
const actionInput = z.discriminatedUnion('action', [z.object({ action: z.literal('accept') }), z.object({ action: z.literal('reject') }), z.object({ action: z.literal('counter'), terms: offerInput })]);

function isPrismaUnique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }

conversations.get('/', async (req, res) => {
  const items = await prisma.conversation.findMany({ where: { participants: { some: { userId: req.userId! } } }, include: { participants: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } }, listing: { select: { id: true, title: true } }, request: { select: { id: true, title: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } });
  return res.json({ items: items.map(item => ({ id: item.id, status: item.status, listing: item.listing, request: item.request, participants: item.participants.map(p => p.user), lastMessage: item.messages[0] ?? null, updatedAt: item.updatedAt })) });
});

conversations.post('/', async (req, res) => {
  const input = contextInput.parse(req.body);
  let recipientId: string;
  let dedupeKey: string;
  let listingId: string | null = null;
  let requestId: string | null = null;
  let listingOwnerId: string | null = null;
  let requestOwnerId: string | null = null;
  if (input.listingId) {
    const listing = await prisma.listing.findUnique({ where: { id: input.listingId }, select: { id: true, ownerId: true, status: true } });
    if (!listing || listing.status !== 'ACTIVE') throw new HttpError(404, 'Active listing not found.');
    listingId = listing.id; listingOwnerId = listing.ownerId;
  }
  if (input.requestId) {
    const request = await prisma.borrowRequest.findUnique({ where: { id: input.requestId! }, select: { id: true, requesterId: true, status: true, expiresAt: true } });
    if (!request || request.status !== 'OPEN' || request.expiresAt <= new Date()) throw new HttpError(404, 'Open borrowing request not found.');
    requestId = request.id; requestOwnerId = request.requesterId;
  }
  if (listingId && requestId) {
    if (req.userId !== listingOwnerId && req.userId !== requestOwnerId) throw new HttpError(403, 'You must own the listing or the borrowing request to connect these parties.');
    if (listingOwnerId === requestOwnerId) throw new HttpError(400, 'A request owner cannot match their own listing.');
    recipientId = req.userId === listingOwnerId ? requestOwnerId! : listingOwnerId!;
  } else if (listingId) {
    if (listingOwnerId === req.userId) throw new HttpError(400, 'You cannot start a borrowing conversation on your own listing.');
    recipientId = listingOwnerId!;
  } else {
    if (requestOwnerId === req.userId) throw new HttpError(400, 'You cannot respond to your own borrowing request.');
    recipientId = requestOwnerId!;
  }
  const ordered = [req.userId!, recipientId].sort();
  dedupeKey = `${listingId ? `listing:${listingId}` : ''}|${requestId ? `request:${requestId}` : ''}:${ordered[0]}:${ordered[1]}`;
  let conversation = await prisma.conversation.findUnique({ where: { dedupeKey }, include: { participants: { select: { userId: true } } } });
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({ data: { dedupeKey, listingId, requestId, participants: { create: [{ userId: req.userId! }, { userId: recipientId }] } }, include: { participants: { select: { userId: true } } } });
    } catch (error) {
      if (!isPrismaUnique(error)) throw error;
      conversation = await prisma.conversation.findUnique({ where: { dedupeKey }, include: { participants: { select: { userId: true } } } });
    }
  }
  return res.status(201).json({ conversation });
});

conversations.get('/:id/messages', async (req, res) => {
  const conversationId = String(req.params.id);
  const participant = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: req.userId! } } });
  if (!participant) throw new HttpError(404, 'Conversation not found.');
  const items = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, take: 200, select: { id: true, senderId: true, body: true, createdAt: true } });
  await prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: req.userId! } }, data: { lastReadAt: new Date() } });
  return res.json({ items });
});

conversations.get('/:id/offers', async (req, res) => {
  const conversationId = String(req.params.id);
  const participant = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: req.userId! } } });
  if (!participant) throw new HttpError(404, 'Conversation not found.');
  await prisma.offer.updateMany({ where: { conversationId, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
  const items = await prisma.offer.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  return res.json({ items });
});

conversations.post('/:id/offers', async (req, res) => {
  const terms = offerInput.parse(req.body);
  const conversationId = String(req.params.id);
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, participants: { some: { userId: req.userId! } } }, include: { participants: { select: { userId: true } }, listing: true, request: true } });
  if (!conversation || conversation.participants.length !== 2) throw new HttpError(404, 'Conversation not found.');
  if (conversation.status !== 'ACTIVE') throw new HttpError(409, 'This conversation is closed.');
  if (terms.startDate < new Date(new Date().setHours(0,0,0,0))) throw new HttpError(400, 'Rental start date must be today or later.');
  if (conversation.listing && conversation.listing.status !== 'ACTIVE') throw new HttpError(409, 'This listing is no longer available.');
  if (conversation.request && (conversation.request.status !== 'OPEN' || terms.startDate < conversation.request.startDate || terms.endDate > conversation.request.endDate || terms.dailyPricePaise > conversation.request.budgetPaise)) throw new HttpError(400, 'Offer dates or daily price do not fit the borrowing request.');
  const recipientId = conversation.participants.find(p => p.userId !== req.userId)?.userId;
  if (!recipientId) throw new HttpError(409, 'Conversation has no other participant.');
  const offer = await prisma.offer.create({ data: { conversationId, listingId: conversation.listingId, requestId: conversation.requestId, senderId: req.userId!, recipientId, startDate: terms.startDate, endDate: terms.endDate, dailyPricePaise: terms.dailyPricePaise, depositPaise: terms.depositPaise, message: terms.message, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } });
  return res.status(201).json({ offer });
});

conversations.post('/:conversationId/offers/:offerId/action', async (req, res) => {
  const action = actionInput.parse(req.body);
  const conversationId = String(req.params.conversationId);
  const offerId = String(req.params.offerId);
  const current = await prisma.offer.findFirst({ where: { id: offerId, conversationId, recipientId: req.userId! }, include: { listing: true, request: true } });
  if (!current) throw new HttpError(404, 'Pending offer not found for this account.');
  if (current.status !== 'PENDING' || current.expiresAt <= new Date()) throw new HttpError(409, 'This offer is no longer pending.');
  if (action.action === 'counter') {
    if (action.terms.startDate < new Date(new Date().setHours(0,0,0,0))) throw new HttpError(400, 'Rental start date must be today or later.');
    if (current.request && (current.request.status !== 'OPEN' || action.terms.startDate < current.request.startDate || action.terms.endDate > current.request.endDate || action.terms.dailyPricePaise > current.request.budgetPaise)) throw new HttpError(400, 'Counteroffer dates or price do not fit the borrowing request.');
    const result = await prisma.$transaction(async tx => {
      const changed = await tx.offer.updateMany({ where: { id: current.id, recipientId: req.userId!, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'COUNTERED' } });
      if (changed.count !== 1) throw new HttpError(409, 'The offer has already changed. Refresh and try again.');
      const counter = await tx.offer.create({ data: { conversationId, listingId: current.listingId, requestId: current.requestId, senderId: req.userId!, recipientId: current.senderId, previousOfferId: current.id, ...action.terms, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } });
      return counter;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ offer: result });
  }
  if (action.action === 'reject') {
    const changed = await prisma.offer.updateMany({ where: { id: current.id, recipientId: req.userId!, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'REJECTED' } });
    if (changed.count !== 1) throw new HttpError(409, 'The offer has already changed. Refresh and try again.');
    return res.json({ offer: await prisma.offer.findUnique({ where: { id: current.id } }) });
  }
  if (!current.listingId || !current.listing || current.listing.status !== 'ACTIVE') throw new HttpError(409, 'This request conversation has no active listing attached, so it cannot create a booking yet.');
  const price = calculateBookingPrice(current.startDate, current.endDate, current.dailyPricePaise, current.depositPaise);
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.booking.updateMany({ where: { listingId: current.listingId!, status: 'PENDING_PAYMENT', paymentExpiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
      const overlapping = await tx.booking.findFirst({ where: { listingId: current.listingId!, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE'] }, startDate: { lt: current.endDate }, endDate: { gt: current.startDate } }, select: { id: true } });
      if (overlapping) throw new HttpError(409, 'The item is no longer available for those dates.');
      const changed = await tx.offer.updateMany({ where: { id: current.id, recipientId: req.userId!, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      if (changed.count !== 1) throw new HttpError(409, 'The offer has already changed. Refresh and try again.');
      const booking = await tx.booking.create({ data: { borrowerId: current.listing!.ownerId === current.senderId ? current.recipientId : current.senderId, lenderId: current.listing!.ownerId, listingId: current.listingId!, acceptedOfferId: current.id, startDate: current.startDate, endDate: current.endDate, dailyPricePaise: current.dailyPricePaise, rentalDays: price.rentalDays, rentalTotalPaise: price.rentalTotalPaise, serviceFeePaise: price.serviceFeePaise, depositPaise: current.depositPaise, totalPaise: price.totalPaise } });
      await tx.offer.updateMany({ where: { listingId: current.listingId!, id: { not: current.id }, status: 'PENDING', startDate: { lt: current.endDate }, endDate: { gt: current.startDate } }, data: { status: 'EXPIRED' } });
      return { offer: await tx.offer.findUniqueOrThrow({ where: { id: current.id } }), booking };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.json(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2004', 'P2034'].includes(error.code)) throw new HttpError(409, 'The item’s availability changed while you accepted. Refresh and try another date.');
    throw error;
  }
});
