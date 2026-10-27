import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';
import { authenticate } from './auth.js';
import { HttpError } from './http.js';

export const payments = Router();
payments.use(authenticate);
const checkoutInput = z.object({ razorpay_order_id: z.string().min(8).max(80), razorpay_payment_id: z.string().min(8).max(80), razorpay_signature: z.string().length(64).regex(/^[0-9a-f]+$/i) });
const bookingAction = z.enum(['start', 'return', 'complete', 'cancel']);

function getGateway() {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) throw new HttpError(503, 'Razorpay is not configured. Add TEST MODE API keys to apps/api/.env using SETUP_GUIDE.md.');
  return new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET });
}
function signatureMatches(expected: string, actual: string) {
  const a = Buffer.from(expected, 'hex'); const b = Buffer.from(actual, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function checkoutSignatureValid(orderId: string, paymentId: string, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return signatureMatches(expected, signature);
}
export function webhookSignatureValid(rawBody: Buffer, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return signatureMatches(expected, signature);
}

payments.get('/bookings/:id', async (req, res) => {
  const booking = await prisma.booking.findFirst({ where: { id: String(req.params.id), OR: [{ borrowerId: req.userId! }, { lenderId: req.userId! }] }, include: { listing: { select: { id: true, title: true } }, payments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!booking) throw new HttpError(404, 'Booking not found.');
  return res.json({ booking: { id: booking.id, listing: booking.listing, startDate: booking.startDate, endDate: booking.endDate, rentalDays: booking.rentalDays, dailyPricePaise: booking.dailyPricePaise, rentalTotalPaise: booking.rentalTotalPaise, serviceFeePaise: booking.serviceFeePaise, depositPaise: booking.depositPaise, totalPaise: booking.totalPaise, status: booking.status, partyRole: booking.borrowerId === req.userId ? 'BORROWER' : 'LENDER', payment: booking.payments[0] ? { status: booking.payments[0].status, orderId: booking.payments[0].orderId } : null } });
});
payments.get('/bookings', async (req, res) => {
  const items = await prisma.booking.findMany({ where: { OR: [{ borrowerId: req.userId! }, { lenderId: req.userId! }] }, include: { listing: { select: { title: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 });
  return res.json({ items: items.map(b => ({ id: b.id, listingTitle: b.listing.title, status: b.status, startDate: b.startDate, endDate: b.endDate, totalPaise: b.totalPaise, partyRole: b.borrowerId === req.userId ? 'BORROWER' : 'LENDER' })) });
});

payments.post('/bookings/:id/transition', async (req, res) => {
  const action = bookingAction.parse(req.body.action);
  const booking = await prisma.booking.findFirst({ where: { id: String(req.params.id), OR: [{ borrowerId: req.userId! }, { lenderId: req.userId! }] } });
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const borrower = booking.borrowerId === req.userId;
  const allowed = action === 'start' ? !borrower && booking.status === 'CONFIRMED' : action === 'return' ? borrower && booking.status === 'ACTIVE' : action === 'complete' ? !borrower && booking.status === 'RETURNED' : ['PENDING_PAYMENT','PAYMENT_FAILED'].includes(booking.status);
  if (!allowed) throw new HttpError(409, 'You cannot make that change to this booking in its current state.');
  const status = action === 'start' ? 'ACTIVE' : action === 'return' ? 'RETURNED' : action === 'complete' ? 'COMPLETED' : 'CANCELLED';
  const changed = await prisma.booking.updateMany({ where: { id: booking.id, status: booking.status }, data: { status, cancellationReason: action === 'cancel' ? 'Cancelled by a booking participant before payment confirmation.' : undefined } });
  if (!changed.count) throw new HttpError(409, 'The booking changed. Refresh and try again.');
  return res.json({ booking: await prisma.booking.findUnique({ where: { id: booking.id }, select: { id: true, status: true } }) });
});

payments.post('/bookings/:id/order', async (req, res) => {
  const bookingId = String(req.params.id);
  let booking = await prisma.booking.findFirst({ where: { id: bookingId, borrowerId: req.userId! }, include: { payments: { where: { status: { in: ['CREATED', 'AUTHORIZED'] } }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!booking) throw new HttpError(404, 'Booking not found.');
  if (booking.status === 'PAYMENT_FAILED' && booking.paymentExpiresAt > new Date()) {
    const changed = await prisma.booking.updateMany({ where: { id: booking.id, status: 'PAYMENT_FAILED', paymentExpiresAt: { gt: new Date() } }, data: { status: 'PENDING_PAYMENT', paymentExpiresAt: new Date(Date.now() + 15 * 60_000) } });
    if (changed.count !== 1) throw new HttpError(409, 'This booking is no longer payable.');
    booking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payments: { where: { status: { in: ['CREATED', 'AUTHORIZED'] } }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  }
  if (booking.status !== 'PENDING_PAYMENT' || booking.paymentExpiresAt <= new Date()) throw new HttpError(409, 'This booking is no longer payable.');
  const existing = booking.payments[0];
  if (existing?.orderId) return res.json({ keyId: config.RAZORPAY_KEY_ID ?? null, orderId: existing.orderId, amount: existing.amountPaise, currency: existing.currency });
  const gateway = getGateway();
  const order = await gateway.orders.create({ amount: booking.totalPaise, currency: 'INR', receipt: booking.id, notes: { bookingId: booking.id } });
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, orderId: order.id, amountPaise: booking.totalPaise, currency: 'INR', status: 'CREATED' } });
  return res.status(201).json({ keyId: config.RAZORPAY_KEY_ID, orderId: payment.orderId, amount: payment.amountPaise, currency: payment.currency });
});

async function applyCapturedPayment(orderId: string, paymentId: string, amount: number, currency: string) {
  const payment = await prisma.payment.findUnique({ where: { orderId }, include: { booking: true } });
  if (!payment || payment.amountPaise !== amount || payment.currency !== currency || currency !== 'INR') throw new HttpError(400, 'Payment does not match the stored booking amount and currency.');
  if (payment.status === 'CAPTURED' && payment.booking.status === 'CONFIRMED') return payment;
  if (!['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(payment.booking.status) || payment.booking.paymentExpiresAt <= new Date()) throw new HttpError(409, 'Booking payment window has expired.');
  return prisma.$transaction(async tx => {
    const updated = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED'] }, orderId }, data: { paymentId, status: 'CAPTURED' } });
    if (updated.count === 0) {
      const current = await tx.payment.findUnique({ where: { id: payment.id }, include: { booking: true } });
      if (current?.status === 'CAPTURED' && current.booking.status === 'CONFIRMED') return current;
      throw new HttpError(409, 'Payment state has already changed.');
    }
    const confirmed = await tx.booking.updateMany({ where: { id: payment.bookingId, status: { in: ['PENDING_PAYMENT', 'PAYMENT_FAILED'] }, paymentExpiresAt: { gt: new Date() } }, data: { status: 'CONFIRMED' } });
    if (confirmed.count !== 1) throw new HttpError(409, 'Booking payment window has expired.');
    return tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { booking: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

payments.post('/verify', async (req, res) => {
  const input = checkoutInput.parse(req.body);
  const stored = await prisma.payment.findUnique({ where: { orderId: input.razorpay_order_id }, include: { booking: true } });
  if (!stored || stored.booking.borrowerId !== req.userId) throw new HttpError(404, 'Payment order not found.');
  if (!config.RAZORPAY_KEY_SECRET) throw new HttpError(503, 'Razorpay is not configured. Add TEST MODE keys in apps/api/.env.');
  if (!checkoutSignatureValid(stored.orderId!, input.razorpay_payment_id, input.razorpay_signature, config.RAZORPAY_KEY_SECRET)) throw new HttpError(400, 'Payment signature is invalid.');
  const gateway = getGateway();
  const gatewayPayment = await gateway.payments.fetch(input.razorpay_payment_id);
  if (gatewayPayment.order_id !== stored.orderId || gatewayPayment.amount !== stored.amountPaise || gatewayPayment.currency !== stored.currency) throw new HttpError(400, 'Gateway payment does not match the booking.');
  if (gatewayPayment.status === 'captured') {
    const payment = await applyCapturedPayment(stored.orderId!, input.razorpay_payment_id, gatewayPayment.amount, gatewayPayment.currency);
    return res.json({ status: 'confirmed', paymentId: payment.paymentId, bookingId: payment.bookingId });
  }
  if (gatewayPayment.status === 'authorized') {
    await prisma.payment.updateMany({ where: { id: stored.id, status: 'CREATED' }, data: { status: 'AUTHORIZED', paymentId: input.razorpay_payment_id } });
    return res.status(202).json({ status: 'processing', bookingId: stored.bookingId, message: 'Payment is authorized and awaiting capture confirmation.' });
  }
  throw new HttpError(402, 'Payment has not been captured. The booking is not confirmed.');
});

export async function handleRazorpayWebhook(req: Request, res: Response) {
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Webhook requires a raw JSON request body.' });
  const secret = config.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.header('x-razorpay-signature');
  const eventId = req.header('x-razorpay-event-id');
  if (!secret || !signature || !webhookSignatureValid(req.body, signature, secret)) return res.status(400).json({ error: 'Webhook signature is invalid.' });
  if (!eventId || eventId.length > 120) return res.status(400).json({ error: 'Webhook event id is missing.' });
  let event: any;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Webhook JSON is invalid.' }); }
  if (event.event !== 'payment.captured' && event.event !== 'payment.failed') return res.status(200).json({ received: true, ignored: true });
  const entity = event?.payload?.payment?.entity;
  if (!entity || typeof entity.order_id !== 'string' || typeof entity.id !== 'string' || !Number.isInteger(entity.amount) || typeof entity.currency !== 'string') return res.status(400).json({ error: 'Payment event payload is invalid.' });
  try {
    await prisma.$transaction(async tx => {
      await tx.webhookEvent.create({ data: { id: eventId, provider: 'razorpay', eventType: event.event } });
      const stored = await tx.payment.findUnique({ where: { orderId: entity.order_id }, include: { booking: true } });
      if (!stored || stored.amountPaise !== entity.amount || stored.currency !== entity.currency) throw new HttpError(400, 'Webhook payment does not match a stored order.');
      if (event.event === 'payment.captured') {
        if (stored.status === 'CAPTURED' && stored.booking.status === 'CONFIRMED') return;
        if (!['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(stored.booking.status) || stored.booking.paymentExpiresAt <= new Date()) throw new HttpError(409, 'Booking payment window has expired.');
        const updated = await tx.payment.updateMany({ where: { id: stored.id, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED'] } }, data: { status: 'CAPTURED', paymentId: entity.id, lastWebhookEvent: eventId } });
        if (!updated.count) throw new HttpError(409, 'Payment state has already changed.');
        const confirmed = await tx.booking.updateMany({ where: { id: stored.bookingId, status: { in: ['PENDING_PAYMENT', 'PAYMENT_FAILED'] }, paymentExpiresAt: { gt: new Date() } }, data: { status: 'CONFIRMED' } });
        if (!confirmed.count) throw new HttpError(409, 'Booking payment window has expired.');
      } else {
        await tx.payment.updateMany({ where: { id: stored.id, status: { in: ['CREATED', 'AUTHORIZED'] } }, data: { status: 'FAILED', paymentId: entity.id, lastWebhookEvent: eventId } });
        await tx.booking.updateMany({ where: { id: stored.bookingId, status: 'PENDING_PAYMENT' }, data: { status: 'PAYMENT_FAILED' } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(200).json({ received: true, duplicate: true });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  return res.status(200).json({ received: true });
}
