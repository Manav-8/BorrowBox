import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './db.js';
import { authenticate } from './auth.js';
import { HttpError } from './http.js';
import { signImagePaths } from './storage.js';

export const marketplace = Router();
const listQuery = z.object({ q: z.string().trim().max(100).optional(), category: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(40).default(12) });
const listingInput = z.object({ title: z.string().trim().min(3).max(100), description: z.string().trim().min(20).max(3000), category: z.string().trim().min(2).max(60), dailyPricePaise: z.number().int().min(100).max(100_000_000), depositPaise: z.number().int().min(0).max(500_000_000).default(0), condition: z.string().trim().min(2).max(40), pickupArea: z.string().trim().min(2).max(120), conditions: z.string().trim().max(1000).optional(), imageUrls: z.array(z.string().min(1).max(300)).max(8).default([]), status: z.enum(['DRAFT','ACTIVE','PAUSED']).default('DRAFT') });
const requestInput = z.object({ title: z.string().trim().min(3).max(100), description: z.string().trim().min(20).max(3000), category: z.string().trim().min(2).max(60), startDate: z.coerce.date(), endDate: z.coerce.date(), budgetPaise: z.number().int().min(100).max(500_000_000), location: z.string().trim().max(120).optional(), radiusKm: z.number().int().min(1).max(250).optional(), expiresAt: z.coerce.date() }).refine(v => v.startDate < v.endDate, { message: 'End date must be after start date.', path: ['endDate'] }).refine(v => v.expiresAt > new Date(), { message: 'Expiry must be in the future.', path: ['expiresAt'] });

marketplace.get('/listings', async (req, res) => {
  const query = listQuery.parse(req.query);
  const where = { status: 'ACTIVE' as const, ...(query.category ? { category: { equals: query.category, mode: 'insensitive' as const } } : {}), ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' as const } }, { description: { contains: query.q, mode: 'insensitive' as const } }] } : {}) };
  const [items, total] = await prisma.$transaction([prisma.listing.findMany({ where, select: { id: true, title: true, description: true, category: true, imageUrls: true, dailyPricePaise: true, depositPaise: true, condition: true, pickupArea: true, owner: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.listing.count({ where })]);
  const signedItems = await Promise.all(items.map(async item => ({ ...item, imageUrls: await signImagePaths(item.imageUrls) })));
  return res.json({ items: signedItems, page: query.page, limit: query.limit, total });
});
marketplace.get('/requests', async (req, res) => {
  const query = listQuery.parse(req.query);
  const where = { status: 'OPEN' as const, expiresAt: { gt: new Date() }, ...(query.category ? { category: { equals: query.category, mode: 'insensitive' as const } } : {}), ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' as const } }, { description: { contains: query.q, mode: 'insensitive' as const } }] } : {}) };
  const [items, total] = await prisma.$transaction([prisma.borrowRequest.findMany({ where, select: { id: true, title: true, description: true, category: true, startDate: true, endDate: true, budgetPaise: true, location: true, expiresAt: true, requester: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.borrowRequest.count({ where })]);
  return res.json({ items, page: query.page, limit: query.limit, total });
});
marketplace.get('/my/listings', authenticate, async (req, res) => {
  const items = await prisma.listing.findMany({ where: { ownerId: req.userId!, ...(req.query.active === '1' ? { status: 'ACTIVE' as const } : {}) }, select: { id: true, title: true, category: true, imageUrls: true, dailyPricePaise: true, depositPaise: true, condition: true, pickupArea: true, description: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } });
  return res.json({ items });
});
marketplace.get('/my/requests', authenticate, async (req, res) => {
  const items = await prisma.borrowRequest.findMany({ where: { requesterId: req.userId! }, select: { id: true, title: true, category: true, status: true, startDate: true, endDate: true, budgetPaise: true, expiresAt: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } });
  return res.json({ items });
});
marketplace.post('/requests/:id/cancel', authenticate, async (req, res) => {
  const changed = await prisma.borrowRequest.updateMany({ where: { id: String(req.params.id), requesterId: req.userId!, status: { in: ['OPEN', 'MATCHED'] } }, data: { status: 'CANCELLED' } });
  if (!changed.count) throw new HttpError(404, 'Open request not found or you do not have permission to cancel it.');
  return res.json({ request: await prisma.borrowRequest.findUnique({ where: { id: String(req.params.id) } }) });
});
marketplace.post('/listings', authenticate, async (req, res) => {
  const input = listingInput.parse(req.body);
  if (input.imageUrls.some(path => !path.startsWith(`${req.userId}/`))) throw new HttpError(400, 'Listing images must be uploaded to your own account first.');
  const listing = await prisma.listing.create({ data: { ...input, ownerId: req.userId! } });
  return res.status(201).json({ listing });
});
marketplace.patch('/listings/:id', authenticate, async (req, res) => {
  const input = listingInput.partial().parse(req.body);
  if (input.imageUrls?.some(path => !path.startsWith(`${req.userId}/`))) throw new HttpError(400, 'Listing images must be uploaded to your own account first.');
  const id = String(req.params.id);
  const updated = await prisma.listing.updateMany({ where: { id, ownerId: req.userId! }, data: input });
  if (!updated.count) throw new HttpError(404, 'Listing not found or you do not have permission to change it.');
  return res.json({ listing: await prisma.listing.findUnique({ where: { id } }) });
});
marketplace.post('/requests', authenticate, async (req, res) => {
  const input = requestInput.parse(req.body);
  const request = await prisma.borrowRequest.create({ data: { ...input, requesterId: req.userId! } });
  return res.status(201).json({ request });
});
