import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { EMAIL_PROVIDERS, sendEmail } from '../../integrations/email.js';
import { Article, Growth, NewsletterSubscriber, SiteSettings } from '../../models/index.js';
import { badRequest } from '../../utils/http.js';
import { absolute, growthWithSecrets, publicBase, secretOf } from '../growth/common.js';

// Newsletter: double opt-in confirmation emails, a weekly digest of the best
// new posts, and one-click unsubscribe links in every email.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Unsubscribe tokens are a keyed hash of the address, so links never expire and need no storage.
export const unsubscribeToken = (email) => crypto.createHmac('sha256', `${env.JWT_SECRET}:newsletter`).update(String(email).toLowerCase()).digest('base64url').slice(0, 32);
export const validUnsubscribe = (email, token) => {
  const a = Buffer.from(unsubscribeToken(email));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export async function emailConfig() {
  const g = await growthWithSecrets();
  const n = g.newsletter;
  const apiKey = n.provider !== 'none' && n.apiKey?.data ? secretOf(g, 'newsletter.apiKey') : '';
  const settings = await SiteSettings.getSingleton();
  return { ready: Boolean(apiKey && n.fromEmail), provider: n.provider, apiKey, from: { email: n.fromEmail, name: n.fromName || settings.siteName }, replyTo: n.replyTo, doubleOptIn: n.doubleOptIn, settings, base: publicBase(settings.siteUrl), growth: g };
}

const unsubscribeUrl = (base, email) => `${base}/newsletter?unsubscribe=1&e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;
const oneClickUrl = (base, email) => `${base}/api/public/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;

function layout({ siteName, base, body, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e4e4e7"><a href="${esc(base)}" style="font-size:20px;font-weight:bold;color:#18181b;text-decoration:none">${esc(siteName)}</a></td></tr>
<tr><td style="padding:24px">${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

async function deliver(cfg, to, { subject, html, text, unsubscribe }) {
  const headers = unsubscribe ? { 'List-Unsubscribe': `<${oneClickUrl(cfg.base, to)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {};
  return sendEmail(cfg.provider, cfg.apiKey, { from: cfg.from, to, subject, html, text, headers, replyTo: cfg.replyTo });
}

/** Sends the confirmation email for a new signup. */
export async function sendConfirmation(cfg, email) {
  const token = crypto.randomBytes(24).toString('base64url');
  await NewsletterSubscriber.updateOne({ email }, { $set: { confirmHash: sha(token), confirmExpires: new Date(Date.now() + 7 * 86400000), confirmSentAt: new Date() } });
  const link = `${cfg.base}/newsletter?confirm=${token}`;
  const name = cfg.settings.siteName;
  await deliver(cfg, email, {
    subject: `Confirm your subscription to ${name}`,
    html: layout({ siteName: name, base: cfg.base, body: `<p style="font-size:16px">Please confirm that you want to receive new posts from <b>${esc(name)}</b> by email.</p><p><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Confirm subscription</a></p><p style="font-size:13px;color:#71717a">If you did not sign up, ignore this email and you will not hear from us again.</p>`, footer: `This link works for 7 days.` }),
    text: `Confirm your subscription to ${name}: ${link}\n\nIf you did not sign up, ignore this email.`,
  });
}

/** Handles a signup from the website. Returns { confirm } (whether a confirmation email is needed). */
export async function subscribe(email, source = 'website') {
  const cfg = await emailConfig();
  const confirm = Boolean(cfg.doubleOptIn && cfg.ready && cfg.base);
  const existing = await NewsletterSubscriber.findOne({ email });
  if (existing?.status === 'subscribed') return { confirm };
  if (!confirm) {
    await NewsletterSubscriber.updateOne({ email }, { $set: { status: 'subscribed', confirmedAt: new Date() }, $setOnInsert: { email, source } }, { upsert: true });
    return { confirm };
  }
  // Re-sending is limited to once every 10 minutes per address.
  if (existing?.confirmSentAt && Date.now() - existing.confirmSentAt < 600000) return { confirm };
  await NewsletterSubscriber.updateOne({ email }, { $set: { status: 'pending' }, $setOnInsert: { email, source } }, { upsert: true });
  try {
    await sendConfirmation(cfg, email);
  } catch (err) {
    logger.warn({ err: err.message }, 'Newsletter confirmation email failed');
    await Growth.updateOne({ key: 'growth' }, { $set: { 'newsletter.lastError': err.message.slice(0, 300) } });
  }
  return { confirm };
}

export async function confirmSubscription(token) {
  const sub = await NewsletterSubscriber.findOneAndUpdate(
    { confirmHash: sha(String(token || '')), confirmExpires: { $gt: new Date() } },
    { $set: { status: 'subscribed', confirmedAt: new Date() }, $unset: { confirmHash: 1, confirmExpires: 1 } },
    { new: true },
  );
  return Boolean(sub);
}

export async function unsubscribe(email, token) {
  if (!email || !validUnsubscribe(email, token)) return false;
  await NewsletterSubscriber.updateOne({ email: String(email).toLowerCase() }, { $set: { status: 'unsubscribed', unsubscribedAt: new Date() } });
  return true;
}

// ---------- Digest ----------
export async function digestPosts(since, max) {
  const visible = { status: 'published', publishedAt: { $lte: new Date(), $gte: since }, translationOf: null, 'seo.noindex': { $ne: true } };
  return Article.find(visible).select('title slug excerpt featuredImage publishedAt readingTime reads views').sort({ reads: -1, views: -1, publishedAt: -1 }).limit(max).lean();
}

export function digestEmail({ settings, base, posts, email }) {
  const name = settings.siteName;
  const items = posts
    .map((p) => {
      const url = `${base}/blog/${p.slug}?utm_source=newsletter&utm_medium=email&utm_campaign=weekly`;
      const img = absolute(base, p.featuredImage?.url);
      return `<tr><td style="padding:0 0 24px">${/^https:\/\//.test(img) ? `<a href="${esc(url)}"><img src="${esc(img)}" alt="${esc(p.featuredImage?.alt || p.title)}" width="552" style="width:100%;max-width:552px;height:auto;border-radius:6px;display:block;margin-bottom:10px" /></a>` : ''}<a href="${esc(url)}" style="font-size:18px;font-weight:bold;color:#18181b;text-decoration:none">${esc(p.title)}</a><p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:#3f3f46">${esc(p.excerpt || '')}</p><p style="margin:6px 0 0;font-size:13px"><a href="${esc(url)}" style="color:#2563eb">Read · ${p.readingTime || 1} min</a></p></td></tr>`;
    })
    .join('');
  const subject = posts.length === 1 ? `${name}: ${posts[0].title}` : `${name}: ${posts[0].title} and ${posts.length - 1} more`;
  return {
    subject: subject.slice(0, 150),
    html: layout({
      siteName: name,
      base,
      body: `<p style="font-size:16px;margin:0 0 20px">This week's best posts:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`,
      footer: `You get this because you subscribed at ${esc(base)}. <a href="${esc(unsubscribeUrl(base, email))}" style="color:#71717a">Unsubscribe</a>`,
    }),
    text: `This week's best posts from ${name}:\n\n${posts.map((p) => `${p.title}\n${base}/blog/${p.slug}\n`).join('\n')}\nUnsubscribe: ${unsubscribeUrl(base, email)}`,
  };
}

async function record(entry) {
  await Growth.updateOne({ key: 'growth' }, { $push: { 'newsletter.history': { $each: [{ at: new Date(), ...entry }], $slice: -20 } } });
}

/** Sends the digest to every confirmed subscriber. */
export async function sendDigest({ kind = 'weekly', days = 7 } = {}) {
  const cfg = await emailConfig();
  if (!cfg.ready) throw badRequest('Set up the email provider, API key and sender address first.');
  if (!cfg.base) throw badRequest('Set a public Site URL in Settings first; email links must open for readers.');
  const posts = await digestPosts(new Date(Date.now() - days * 86400000), cfg.growth.newsletter.digest.maxPosts);
  if (!posts.length) {
    await record({ kind, subject: '', posts: 0, sent: 0, failed: 0, note: `No new posts in the last ${days} days, so nothing was sent.` });
    return { sent: 0, failed: 0, posts: 0 };
  }
  const subs = await NewsletterSubscriber.find({ status: 'subscribed' }).select('email').lean();
  let sent = 0;
  let failed = 0;
  let lastError = '';
  let subject = '';
  for (const s of subs) {
    const mail = digestEmail({ settings: cfg.settings, base: cfg.base, posts, email: s.email });
    subject = mail.subject;
    try {
      // eslint-disable-next-line no-await-in-loop
      await deliver(cfg, s.email, { ...mail, unsubscribe: true });
      sent += 1;
      // eslint-disable-next-line no-await-in-loop
      await NewsletterSubscriber.updateOne({ _id: s._id }, { $set: { lastSentAt: new Date() } });
    } catch (err) {
      failed += 1;
      lastError = err.message;
      if (err.status === 401 || err.status === 403) break; // the key is wrong: stop instead of failing every address
    }
    // eslint-disable-next-line no-await-in-loop
    if (!env.isTest) await sleep(EMAIL_PROVIDERS[cfg.provider]?.delayMs || 200);
  }
  await record({ kind, subject, posts: posts.length, sent, failed, note: lastError.slice(0, 200) });
  await Growth.updateOne({ key: 'growth' }, { $set: { 'newsletter.lastError': lastError.slice(0, 300), ...(sent ? { 'newsletter.lastOkAt': new Date() } : {}) } });
  return { sent, failed, posts: posts.length, error: lastError };
}

export async function sendTestEmail(to) {
  const cfg = await emailConfig();
  if (!cfg.ready) throw badRequest('Set up the email provider, API key and sender address first.');
  const base = cfg.base || 'http://localhost:5173';
  const posts = await digestPosts(new Date(Date.now() - 30 * 86400000), cfg.growth.newsletter.digest.maxPosts);
  const mail = posts.length
    ? digestEmail({ settings: cfg.settings, base, posts, email: to })
    : { subject: `Test email from ${cfg.settings.siteName}`, html: layout({ siteName: cfg.settings.siteName, base, body: '<p>Your newsletter email is set up correctly.</p>', footer: 'Test email' }), text: 'Your newsletter email is set up correctly.' };
  await deliver({ ...cfg, base }, to, { ...mail, subject: `[Test] ${mail.subject}` });
  await Growth.updateOne({ key: 'growth' }, { $set: { 'newsletter.lastOkAt': new Date(), 'newsletter.lastError': '' } });
  return { posts: posts.length };
}

function localParts(now, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** Sends the weekly digest once, on the chosen day after the chosen time. */
export async function digestTick(now = new Date()) {
  const g = await Growth.getSingleton();
  const d = g.newsletter.digest;
  if (!d.enabled || g.newsletter.provider === 'none') return null;
  const tz = (await SiteSettings.getSingleton()).autopilot?.timezone || 'UTC';
  const { day, time, weekday } = localParts(now, tz);
  if (weekday !== d.day || time < d.time || d.lastSentDay === day) return null;
  const claimed = await Growth.updateOne({ key: 'growth', 'newsletter.digest.lastSentDay': { $ne: day } }, { $set: { 'newsletter.digest.lastSentDay': day } });
  if (claimed.modifiedCount !== 1) return null;
  try {
    return await sendDigest({ kind: 'weekly' });
  } catch (err) {
    await record({ kind: 'weekly', subject: '', posts: 0, sent: 0, failed: 0, note: err.message.slice(0, 200) });
    return null;
  }
}
