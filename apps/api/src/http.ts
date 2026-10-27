import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error instanceof Error && error.name === 'ZodError') {
    return res.status(400).json({ error: 'Invalid input', details: JSON.parse(error.message) });
  }
  console.error('Unhandled request error:', error instanceof Error ? error.message : 'unknown');
  return res.status(500).json({ error: 'The request could not be completed.' });
}
