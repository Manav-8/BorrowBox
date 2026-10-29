import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from './db.js';
import { config, requireAuthConfig } from './config.js';
import { HttpError } from './http.js';

declare global { namespace Express { interface Request { userId?: string } } }
const emailSchema = z.string().email().max(254).transform(v => v.toLowerCase());
const registerSchema = z.object({ email: emailSchema, password: z.string().min(10).max(128), displayName: z.string().trim().min(2).max(60) });
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const profileSchema = z.object({ displayName: z.string().trim().min(2).max(60).optional(), bio: z.string().trim().max(500).nullable().optional(), phone: z.string().trim().max(30).nullable().optional() }).refine(v => Object.values(v).some(value => value !== undefined), 'Update at least one profile field.');

function tokenCookie(res: Response, token: string) {
  res.cookie('borrowbox_session', token, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 1000 * 60 * 60 * 4, path: '/' });
}
function issueToken(userId: string) {
  return jwt.sign({ sub: userId }, requireAuthConfig(), { expiresIn: '4h', issuer: 'borrowbox-api' });
}

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw new HttpError(409, 'An account with this email already exists.');
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.user.create({ data: { email: input.email, passwordHash, displayName: input.displayName }, select: { id: true, email: true, displayName: true } });
  tokenCookie(res, issueToken(user.id));
  return res.status(201).json({ user });
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, input.password))) throw new HttpError(401, 'Email or password is incorrect.');
  tokenCookie(res, issueToken(user.id));
  return res.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie('borrowbox_session', { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax', path: '/' });
  return res.status(204).end();
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.borrowbox_session as string | undefined;
    if (!token) throw new HttpError(401, 'Sign in to continue.');
    const decoded = jwt.verify(token, requireAuthConfig(), { issuer: 'borrowbox-api' });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') throw new HttpError(401, 'Session is invalid. Sign in again.');
    const user = await prisma.user.findUnique({ where: { id: decoded.sub }, select: { id: true, status: true } });
    if (!user || user.status !== 'ACTIVE') throw new HttpError(401, 'Account is unavailable.');
    req.userId = user.id;
    next();
  } catch (err) { next(err instanceof jwt.JsonWebTokenError ? new HttpError(401, 'Session expired. Sign in again.') : err); }
}

export async function currentUser(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, email: true, displayName: true, bio: true, avatarUrl: true, createdAt: true } });
  return res.json({ user });
}

export function createSocketToken(req: Request, res: Response) {
  const token = jwt.sign({ sub: req.userId!, purpose: 'socket' }, requireAuthConfig(), { expiresIn: '5m', issuer: 'borrowbox-api' });
  return res.json({ token });
}

export async function updateProfile(req: Request, res: Response) {
  const input = profileSchema.parse(req.body);
  const user = await prisma.user.update({ where: { id: req.userId! }, data: input, select: { id: true, email: true, displayName: true, phone: true, bio: true, avatarUrl: true, createdAt: true } });
  return res.json({ user });
}
