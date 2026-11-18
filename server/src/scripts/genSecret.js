// Fills JWT_SECRET and SECRETS_KEY in server/.env with random values if they are empty.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('server/.env does not exist. Copy .env.example to .env first.');
  process.exit(1);
}
let text = fs.readFileSync(envPath, 'utf8');
for (const name of ['JWT_SECRET', 'SECRETS_KEY']) {
  const re = new RegExp(`^${name}=(.*)$`, 'm');
  const match = text.match(re);
  if (match && match[1].trim().length >= 32) {
    console.log(`${name} already set - left unchanged.`);
    continue;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  text = match ? text.replace(re, `${name}=${secret}`) : `${text.trimEnd()}\n${name}=${secret}\n`;
  console.log(`${name} generated and saved to server/.env`);
}
fs.writeFileSync(envPath, text);
