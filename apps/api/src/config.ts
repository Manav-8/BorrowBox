import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('listing-images'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional()
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export function requireDatabaseConfig() {
  if (!config.DATABASE_URL || !config.DIRECT_URL) {
    throw new Error('Database is not configured. Copy .env.example to apps/api/.env and set DATABASE_URL and DIRECT_URL from Supabase.');
  }
}
export function requireAuthConfig() {
  if (!config.JWT_ACCESS_SECRET) throw new Error('Authentication is not configured. Set JWT_ACCESS_SECRET in apps/api/.env.');
  return config.JWT_ACCESS_SECRET;
}
