import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signToken } from '../middleware/auth.js';
import { User } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { plainText } from '../utils/content.js';
import { asyncHandler, badRequest, unauthorized } from '../utils/http.js';

export const passwordRule = z.string().min(10, 'Password must be at least 10 characters').max(200);

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordRule,
});

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().max(1000).default(''),
  avatarUrl: z.string().max(500).regex(/^($|\/uploads\/|https?:\/\/)/, 'Must be an uploaded image or http(s) URL').default(''),
});

// A fixed hash so that unknown emails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok || !user.active) {
    await logActivity(req, 'auth.login_failed', { summary: `Failed sign-in for ${email}` });
    throw unauthorized('Incorrect email or password');
  }
  user.lastLoginAt = new Date();
  await user.save();
  req.user = user;
  await logActivity(req, 'auth.login', { entityType: 'User', entityId: user._id, summary: `${user.name} signed in` });
  res.json({ token: signToken(user), user: user.toSafe() });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafe() });
});

export const updateProfile = asyncHandler(async (req, res) => {
  req.user.name = plainText(req.body.name) || req.user.name;
  req.user.bio = plainText(req.body.bio);
  req.user.avatarUrl = req.body.avatarUrl;
  await req.user.save();
  res.json({ user: req.user.toSafe() });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  user.tokenVersion += 1; // signs out every other session
  await user.save();
  await logActivity(req, 'auth.password_change', { entityType: 'User', entityId: user._id, summary: `${user.name} changed their password` });
  res.json({ token: signToken(user), user: user.toSafe() });
});
