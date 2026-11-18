import { z } from 'zod';
import { NewsletterSubscriber } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { confirmSubscription, sendDigest, sendTestEmail, subscribe, unsubscribe } from '../services/newsletter/newsletterService.js';
import { asyncHandler, badRequest, escapeRegex, notFound, paged, parsePaging } from '../utils/http.js';

// ---------- Public ----------
export const newsletterSchema = z.object({ email: z.string().trim().email('Enter a valid email address').max(200) });

export const publicSubscribe = asyncHandler(async (req, res) => {
  const { confirm } = await subscribe(req.body.email.toLowerCase());
  // Same answer whether or not the address was already subscribed.
  res.status(201).json(confirm ? { message: 'Almost done: check your inbox and click the link to confirm.', confirm: true } : { message: 'Thanks for subscribing!', confirm: false });
});

export const publicConfirm = asyncHandler(async (req, res) => {
  const ok = await confirmSubscription(String(req.body?.token || req.query.token || '').slice(0, 100));
  if (!ok) throw badRequest('This confirmation link is invalid or has expired. Subscribe again to get a new one.');
  res.json({ message: 'You are subscribed. Thanks!' });
});

// Works for the link in emails (from the website page) and for one-click
// unsubscribe from email apps (POST with the address and token in the URL).
export const publicUnsubscribe = asyncHandler(async (req, res) => {
  const email = String(req.body?.e || req.query.e || '').slice(0, 200);
  const token = String(req.body?.t || req.query.t || '').slice(0, 100);
  if (!(await unsubscribe(email, token))) throw badRequest('This unsubscribe link is not valid.');
  res.json({ message: 'You are unsubscribed and will not get more emails.' });
});

// ---------- Admin ----------
export const testNewsletter = asyncHandler(async (req, res) => {
  const r = await sendTestEmail(req.user.email);
  await logActivity(req, 'newsletter.test', { entityType: 'Growth', summary: `Sent a test newsletter to ${req.user.email}` });
  res.json({ message: `Test email sent to ${req.user.email}${r.posts ? ` with ${r.posts} recent posts` : ''}.` });
});

export const sendDigestNow = asyncHandler(async (req, res) => {
  const r = await sendDigest({ kind: 'manual', days: Math.min(30, Math.max(1, Number(req.body?.days) || 7)) });
  await logActivity(req, 'newsletter.sent', { entityType: 'Growth', summary: r.posts ? `Newsletter sent to ${r.sent} subscribers (${r.failed} failed, ${r.posts} posts)` : 'Newsletter not sent: no new posts' });
  res.json(r);
});

export const listSubscribers = asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query, { defaultLimit: 25, maxLimit: 100 });
  const filter = {};
  if (['pending', 'subscribed', 'unsubscribed'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) filter.email = { $regex: escapeRegex(String(req.query.q).slice(0, 100)), $options: 'i' };
  const [items, total] = await Promise.all([NewsletterSubscriber.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit).lean(), NewsletterSubscriber.countDocuments(filter)]);
  res.json(paged(items, total, paging));
});

export const deleteSubscriber = asyncHandler(async (req, res) => {
  const sub = await NewsletterSubscriber.findByIdAndDelete(req.params.id);
  if (!sub) throw notFound('Subscriber not found');
  await logActivity(req, 'newsletter.removed', { entityType: 'NewsletterSubscriber', entityId: sub._id, summary: `Removed subscriber ${sub.email}` });
  res.status(204).end();
});

// Values starting with = + - @ are prefixed so spreadsheet apps never run them as formulas.
const csv = (v) => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
export const exportSubscribers = asyncHandler(async (req, res) => {
  const subs = await NewsletterSubscriber.find().sort({ createdAt: 1 }).lean();
  const rows = [['email', 'status', 'source', 'signed_up', 'confirmed', 'unsubscribed'], ...subs.map((s) => [s.email, s.status, s.source, s.createdAt?.toISOString(), s.confirmedAt?.toISOString() || '', s.unsubscribedAt?.toISOString() || ''])];
  await logActivity(req, 'newsletter.export', { entityType: 'NewsletterSubscriber', summary: `Exported ${subs.length} subscribers` });
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="subscribers.csv"').send(`${rows.map((r) => r.map(csv).join(',')).join('\r\n')}\r\n`);
});
