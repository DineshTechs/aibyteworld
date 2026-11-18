import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from './http.js';

// AES-256-GCM encryption for secrets stored in MongoDB (AI provider API keys).
// The key comes from SECRETS_KEY in server/.env and never leaves the server.
function key() {
  const raw = env.SECRETS_KEY;
  if (!raw) {
    throw new HttpError(500, 'SECRETS_KEY is not set in server/.env. Run setup.bat (or "npm run gen:secret") and restart the server.');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptSecret(box) {
  if (!box?.data) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, 'A stored API key could not be decrypted (SECRETS_KEY changed?). Enter the key again in AI Providers.');
  }
}
