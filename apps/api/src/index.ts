import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config, requireAuthConfig, requireDatabaseConfig } from './config.js';
import { prisma } from './db.js';
import { authenticate, currentUser, login, logout, register, updateProfile } from './auth.js';
import { marketplace } from './marketplace.js';
import { conversations } from './conversations.js';
import { handleRazorpayWebhook, payments } from './payments.js';
import { uploadImage } from './storage.js';
import { errorHandler } from './http.js';

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: config.WEB_ORIGIN, credentials: true } });
app.use(helmet());
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '128kb' }), handleRazorpayWebhook);
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path !== '/api/payments/webhook' && req.get('origin') !== config.WEB_ORIGIN) return res.status(403).json({ error: 'Request origin is not allowed.' });
  next();
});
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.post('/api/uploads', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), authenticate, express.raw({ type: '*/*', limit: '5mb' }), uploadImage);
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/api/health', async (_req, res) => {
  let database: 'ready' | 'not_configured' | 'unavailable' = 'not_configured';
  if (config.DATABASE_URL && config.DIRECT_URL) {
    try { await prisma.$queryRaw`SELECT 1`; database = 'ready'; }
    catch { database = 'unavailable'; }
  }
  res.status(database === 'ready' ? 200 : 503).json({ status: database === 'ready' ? 'ok' : 'setup_required', api: 'ready', database, setup: database === 'ready' ? undefined : 'Configure DATABASE_URL and DIRECT_URL from Supabase in apps/api/.env, then apply migrations.' });
});

app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', authenticate, currentUser);
app.patch('/api/auth/me', authenticate, updateProfile);
app.use('/api', marketplace);
app.use('/api/conversations', conversations);
app.use('/api/payments', payments);

io.use(async (socket, next) => {
  try {
    if (socket.handshake.headers.origin !== config.WEB_ORIGIN) return next(new Error('Origin is not allowed.'));
    const cookie = socket.handshake.headers.cookie;
    if (!cookie) return next(new Error('Sign in to connect.'));
    const token = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('borrowbox_session='))?.split('=').slice(1).join('=');
    if (!token) return next(new Error('Sign in to connect.'));
    const jwt = await import('jsonwebtoken');
    const payload = jwt.default.verify(decodeURIComponent(token), requireAuthConfig(), { issuer: 'borrowbox-api' });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return next(new Error('Invalid session.'));
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') return next(new Error('Account is unavailable.'));
    socket.data.userId = payload.sub;
    next();
  } catch { next(new Error('Sign in to connect.')); }
});
io.on('connection', socket => {
  socket.on('conversation:join', async (conversationId: unknown, ack?: (result: { error?: string }) => void) => {
    try {
    if (typeof conversationId !== 'string' || conversationId.length > 60) return ack?.({ error: 'Invalid conversation.' });
    const allowed = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: socket.data.userId } } });
    if (!allowed) return ack?.({ error: 'Conversation not found.' });
    socket.join(`conversation:${conversationId}`);
    ack?.({});
    } catch { ack?.({ error: 'Could not join this conversation. Try again.' }); }
  });
  socket.on('message:send', async (payload: unknown, ack?: (result: { error?: string; message?: unknown }) => void) => {
    try {
    if (!payload || typeof payload !== 'object') return ack?.({ error: 'Invalid message.' });
    const { conversationId, body } = payload as Record<string, unknown>;
    if (typeof conversationId !== 'string' || typeof body !== 'string' || !body.trim() || body.length > 4000) return ack?.({ error: 'Message must contain 1–4000 characters.' });
    const allowed = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: socket.data.userId } } });
    if (!allowed) return ack?.({ error: 'Conversation not found.' });
    const message = await prisma.message.create({ data: { conversationId, senderId: socket.data.userId, body: body.trim() }, select: { id: true, conversationId: true, senderId: true, body: true, createdAt: true } });
    io.to(`conversation:${conversationId}`).emit('message:new', message);
    ack?.({ message });
    } catch { ack?.({ error: 'Message could not be sent. Please try again.' }); }
  });
});

app.use(errorHandler);

async function start() {
  requireDatabaseConfig();
  requireAuthConfig();
  await prisma.$connect();
  server.listen(config.PORT, () => console.log(`BorrowBox API listening on ${config.PORT}`));
}
start().catch(error => { console.error(error instanceof Error ? error.message : 'API startup failed'); process.exit(1); });

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await prisma.$disconnect(); server.close(() => process.exit(0)); });
