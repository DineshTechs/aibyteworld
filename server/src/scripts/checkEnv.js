// Reports which required values are still missing from server/.env (names only, never values).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (!fs.existsSync(envPath)) {
  console.log('MISSING: server/.env file');
  process.exit(1);
}
const values = dotenv.parse(fs.readFileSync(envPath));
const missing = ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].filter((k) => !(values[k] || '').trim());
if ((values.ADMIN_PASSWORD || '').trim() && values.ADMIN_PASSWORD.trim().length < 10) missing.push('ADMIN_PASSWORD (must be at least 10 characters)');
if (missing.length) {
  console.log(`MISSING in server/.env: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('server/.env is complete.');
