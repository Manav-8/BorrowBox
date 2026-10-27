import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { config } from './config.js';
import { HttpError } from './http.js';

const supported = new Map([['image/jpeg', { ext: 'jpg', magic: Buffer.from([0xff,0xd8,0xff]) }], ['image/png', { ext: 'png', magic: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) }], ['image/webp', { ext: 'webp', magic: Buffer.from('RIFF') }], ['image/avif', { ext: 'avif', magic: Buffer.from([0x00,0x00,0x00]) }]]);
function storage() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Image storage is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the API environment.');
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(config.SUPABASE_STORAGE_BUCKET);
}

export async function uploadImage(req: Request, res: Response) {
  if (!Buffer.isBuffer(req.body) || req.body.length < 12) throw new HttpError(400, 'Choose a valid image file.');
  const contentType = req.header('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  const type = supported.get(contentType);
  const validAvif = contentType === 'image/avif' && req.body.length >= 12 && req.body.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(req.body.subarray(8, 12).toString('ascii'));
  const validWebp = contentType === 'image/webp' && req.body.length >= 12 && req.body.subarray(0, 4).toString('ascii') === 'RIFF' && req.body.subarray(8, 12).toString('ascii') === 'WEBP';
  const validSignature = contentType === 'image/avif' ? validAvif : contentType === 'image/webp' ? validWebp : !!type && req.body.subarray(0, type.magic.length).equals(type.magic);
  if (!type || !validSignature) throw new HttpError(415, 'Use a valid JPEG, PNG, WebP or AVIF image.');
  const path = `${req.userId}/${randomUUID()}.${type.ext}`;
  const { error } = await storage().upload(path, req.body, { contentType, cacheControl: '3600', upsert: false });
  if (error) throw new HttpError(502, 'Image upload failed. Check the private listing-images bucket setup and try again.');
  return res.status(201).json({ path });
}

export async function signImagePaths(paths: string[]) {
  if (paths.length === 0) return paths;
  const bucket = storage();
  return Promise.all(paths.map(async path => {
    const { data, error } = await bucket.createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) throw new HttpError(502, 'A listing image could not be loaded from private storage.');
    return data.signedUrl;
  }));
}
