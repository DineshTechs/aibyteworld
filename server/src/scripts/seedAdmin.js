// Creates the first administrator from ADMIN_* values in server/.env.
// Safe to re-run: it never overwrites an existing account.
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../config/db.js';
import { SiteSettings, User } from '../models/index.js';

const name = process.env.ADMIN_NAME || 'Administrator';
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('ADMIN_EMAIL in server/.env is missing or not a valid email address.');
  process.exit(1);
}
if (password.length < 10) {
  console.error('ADMIN_PASSWORD in server/.env must be at least 10 characters.');
  process.exit(1);
}

try {
  await connectDb();
  await SiteSettings.getSingleton();
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`User ${email} already exists (role: ${existing.role}) - nothing changed.`);
  } else {
    await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(password, 12) });
    console.log(`Administrator created: ${email}`);
  }
} catch (err) {
  console.error(`Seeding failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
