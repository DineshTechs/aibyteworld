import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ActivityLog, Article, NewsletterSubscriber, ROLES, SiteSettings, User } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { analyticsOverview } from '../services/analyticsService.js';
import { plainText, sanitizeArticleHtml } from '../utils/content.js';
import { asyncHandler, badRequest, conflict, notFound, paged, parsePaging } from '../utils/http.js';
import { passwordRule } from './authController.js';

// ---------- Users ----------
export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email().max(200),
  password: passwordRule,
  role: z.enum(ROLES),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  active: z.boolean(),
  password: passwordRule.optional(),
});

export const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  res.json({ items: users.map((u) => u.toSafe()) });
});

// Used by the editor's author picker (editors and admins).
export const listAuthors = asyncHandler(async (_req, res) => {
  const users = await User.find({ active: true }).sort({ name: 1 }).select('name role');
  res.json({ items: users.map((u) => ({ id: u._id, name: u.name, role: u.role })) });
});

export const createUser = asyncHandler(async (req, res) => {
  const email = req.body.email.toLowerCase();
  if (await User.exists({ email })) throw conflict('A user with that email already exists');
  const user = await User.create({
    name: plainText(req.body.name),
    email,
    role: req.body.role,
    passwordHash: await bcrypt.hash(req.body.password, 12),
  });
  await logActivity(req, 'user.create', { entityType: 'User', entityId: user._id, summary: `Created user ${user.email} (${user.role})` });
  res.status(201).json({ item: user.toSafe() });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+passwordHash');
  if (!user) throw notFound('User not found');
  const isSelf = String(user._id) === String(req.user._id);
  const losingAdmin = user.role === 'admin' && (req.body.role !== 'admin' || !req.body.active);
  if (isSelf && losingAdmin) throw badRequest('You cannot remove your own administrator access');
  if (losingAdmin && (await User.countDocuments({ role: 'admin', active: true })) <= 1) {
    throw badRequest('At least one active administrator is required');
  }
  const changed = [];
  if (user.role !== req.body.role) changed.push(`role ${user.role} -> ${req.body.role}`);
  if (user.active !== req.body.active) changed.push(req.body.active ? 'activated' : 'deactivated');
  user.name = plainText(req.body.name) || user.name;
  user.role = req.body.role;
  user.active = req.body.active;
  if (req.body.password) {
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    changed.push('password reset');
  }
  if (changed.length) user.tokenVersion += 1; // force re-login with the new permissions
  await user.save();
  await logActivity(req, 'user.update', { entityType: 'User', entityId: user._id, summary: `Updated user ${user.email}${changed.length ? `: ${changed.join(', ')}` : ''}` });
  res.json({ item: user.toSafe() });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  if (String(user._id) === String(req.user._id)) throw badRequest('You cannot delete your own account');
  if (await Article.exists({ author: user._id })) {
    throw conflict('This user has articles. Deactivate the account instead, or reassign the articles first.');
  }
  await user.deleteOne();
  await logActivity(req, 'user.delete', { entityType: 'User', entityId: user._id, summary: `Deleted user ${user.email}` });
  res.status(204).end();
});

// ---------- Site settings ----------
// Accepts the code alone or the whole <meta ... content="CODE"> tag the
// search engine shows, and keeps only the code.
function verificationCode(name) {
  return z
    .string()
    .trim()
    .max(400)
    .transform((v) => (v.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] || v).trim())
    .refine((v) => v === '' || /^[A-Za-z0-9_\-]{8,100}$/.test(v), `That does not look like a ${name} verification code. Paste the whole HTML tag or just its content value.`)
    .default('');
}

const optionalUrl = z.string().max(300).regex(/^($|https?:\/\/)/, 'Must be an http(s) URL').default('');

export const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(80),
  tagline: z.string().max(200).default(''),
  description: z.string().max(400).default(''),
  siteUrl: optionalUrl,
  contactEmail: z.union([z.literal(''), z.string().email().max(200)]).default(''),
  contactAddress: z.string().max(400).default(''),
  social: z.object({ twitter: optionalUrl, facebook: optionalUrl, linkedin: optionalUrl, instagram: optionalUrl }).default({}),
  pages: z
    .object({
      about: z.string().max(100000).default(''),
      privacy: z.string().max(100000).default(''),
      terms: z.string().max(100000).default(''),
    })
    .default({}),
  postsPerPage: z.number().int().min(3).max(30).default(9),
  allowIndexing: z.boolean().default(true),
  analytics: z
    .object({
      enabled: z.boolean().default(true),
      gaMeasurementId: z
        .string()
        .trim()
        .transform((v) => v.toUpperCase())
        .refine((v) => v === '' || /^G-[A-Z0-9]{4,20}$/.test(v), 'A Google Analytics 4 measurement ID looks like G-ABC123XYZ')
        .default(''),
      consentBanner: z.boolean().default(true),
      googleVerification: verificationCode('Google Search Console'),
      bingVerification: verificationCode('Bing Webmaster Tools'),
    })
    .optional(),
});

export const getSettings = asyncHandler(async (_req, res) => {
  res.json({ settings: await SiteSettings.getSingleton() });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const b = req.body;
  const settings = await SiteSettings.getSingleton();
  Object.assign(settings, {
    siteName: plainText(b.siteName),
    tagline: plainText(b.tagline),
    description: plainText(b.description),
    siteUrl: b.siteUrl.replace(/\/+$/, ''),
    contactEmail: b.contactEmail,
    contactAddress: plainText(b.contactAddress),
    social: b.social,
    pages: {
      about: sanitizeArticleHtml(b.pages.about),
      privacy: sanitizeArticleHtml(b.pages.privacy),
      terms: sanitizeArticleHtml(b.pages.terms),
    },
    postsPerPage: b.postsPerPage,
    allowIndexing: b.allowIndexing,
    ...(b.analytics ? { analytics: b.analytics } : {}),
  });
  await settings.save();
  await logActivity(req, 'settings.update', { entityType: 'SiteSettings', summary: 'Updated website settings' });
  res.json({ settings });
});

// ---------- Activity & subscribers ----------
export const listActivity = asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query, { defaultLimit: 30, maxLimit: 100 });
  const filter = {};
  if (req.query.action) filter.action = { $regex: `^${String(req.query.action).replace(/[^a-z_.]/gi, '')}` };
  const [items, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);
  res.json(paged(items, total, paging));
});

export const recentActivity = asyncHandler(async (req, res) => {
  const filter = ['admin', 'editor'].includes(req.user.role) ? { action: { $not: /^auth\./ } } : { actor: req.user._id };
  const items = await ActivityLog.find(filter).sort({ createdAt: -1 }).limit(8).select('-ip -meta').lean();
  res.json({ items });
});

export const subscriberCount = asyncHandler(async (_req, res) => {
  res.json({ subscribed: await NewsletterSubscriber.countDocuments({ status: 'subscribed' }) });
});

// ---------- Analytics dashboard ----------
export const analytics = asyncHandler(async (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const settings = await SiteSettings.getSingleton();
  res.json({
    ...(await analyticsOverview(days)),
    tracking: settings.analytics?.enabled !== false,
    googleAnalytics: Boolean(settings.analytics?.gaMeasurementId),
    searchConsole: Boolean(settings.analytics?.googleVerification),
  });
});
