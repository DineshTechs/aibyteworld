import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Article, ArticleStat, ReferrerStat, SiteSettings, VisitorMark } from '../models/index.js';

// Built-in analytics: counts unique views, real reads and reading time per
// post per day. No cookies and no stored IP addresses (see models/Analytics.js).

const BOTS = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|slack|headless|lighthouse|pagespeed|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|postman|insomnia|preview/i;
export const isBot = (ua) => !ua || ua.length < 20 || BOTS.test(ua);

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const daysAgo = (n) => dayKey(new Date(Date.now() - n * 86400000));

function visitorId(req, day) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  const ua = String(req.get('user-agent') || '').slice(0, 300);
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${ip}|${ua}|${day}`).digest('base64url').slice(0, 24);
}

// True the first time a key is seen (within two days).
async function firstTime(key) {
  try {
    await VisitorMark.create({ key });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

function referrerHost(referrer, req, siteUrl) {
  if (!referrer) return '(direct)';
  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '(direct)';
  }
  const own = [req.hostname, siteUrl ? new URL(siteUrl).hostname : '', 'localhost', '127.0.0.1'].map((h) => String(h || '').toLowerCase().replace(/^www\./, ''));
  if (own.includes(host)) return null; // a click inside the site
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/(^|\.)bing\.com$/.test(host)) return 'bing';
  if (/(^|\.)(t\.co|twitter\.com|x\.com)$/.test(host)) return 'x.com';
  if (/(^|\.)facebook\.com$|(^|\.)fb\.me$/.test(host)) return 'facebook';
  if (/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/.test(host)) return 'linkedin';
  if (/duckduckgo\.com$/.test(host)) return 'duckduckgo';
  return host.slice(0, 200);
}

const inc = (day, article, fields) => ArticleStat.updateOne({ day, article }, { $inc: fields }, { upsert: true });

/**
 * Records one event from a visitor's browser.
 * type: "view" (opened the post), "read" (scrolled through and stayed) or
 * "time" (active reading seconds when leaving). Returns { counted }.
 */
export async function recordEvent(req, { articleId, type, seconds, referrer }) {
  const settings = await SiteSettings.getSingleton();
  if (settings.analytics?.enabled === false) return { counted: false, reason: 'disabled' };
  if (isBot(req.get('user-agent'))) return { counted: false, reason: 'bot' };
  if (!mongoose.isValidObjectId(articleId)) return { counted: false, reason: 'unknown' };
  const visible = await Article.exists({ _id: articleId, status: 'published', publishedAt: { $lte: new Date() } });
  if (!visible) return { counted: false, reason: 'unknown' };

  const day = dayKey();
  const v = visitorId(req, day);
  if (type === 'view') {
    if (!(await firstTime(`v:${v}:${articleId}`))) return { counted: false, reason: 'repeat' };
    await Promise.all([inc(day, articleId, { views: 1 }), Article.updateOne({ _id: articleId }, { $inc: { views: 1 } }, { timestamps: false })]);
    const host = referrerHost(referrer, req, settings.siteUrl);
    if (host) await ReferrerStat.updateOne({ day, host }, { $inc: { views: 1 } }, { upsert: true });
    return { counted: true };
  }
  // Reads and reading time only count after a counted view, once per day.
  if (!(await VisitorMark.exists({ key: `v:${v}:${articleId}` }))) return { counted: false, reason: 'no view' };
  if (type === 'read') {
    if (!(await firstTime(`r:${v}:${articleId}`))) return { counted: false, reason: 'repeat' };
    await Promise.all([inc(day, articleId, { reads: 1 }), Article.updateOne({ _id: articleId }, { $inc: { reads: 1 } }, { timestamps: false })]);
    return { counted: true };
  }
  if (type === 'time') {
    const secs = Math.round(Number(seconds) || 0);
    if (secs < 1) return { counted: false, reason: 'no time' };
    if (!(await firstTime(`t:${v}:${articleId}`))) return { counted: false, reason: 'repeat' };
    await inc(day, articleId, { readSeconds: Math.min(secs, 1800), timed: 1 });
    return { counted: true };
  }
  return { counted: false, reason: 'unknown type' };
}

// Article IDs with the most views or reads in the last `days` days.
export async function topArticleIds({ days, by, limit, exclude = [] }) {
  const rows = await ArticleStat.aggregate([
    { $match: { day: { $gte: daysAgo(days - 1) }, [by]: { $gt: 0 }, article: { $nin: exclude.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
    { $group: { _id: '$article', n: { $sum: `$${by}` } } },
    { $sort: { n: -1, _id: -1 } },
    { $limit: limit * 3 },
  ]);
  return rows.map((r) => r._id);
}

// Dashboard numbers for the last `days` days, with the period before for comparison.
export async function analyticsOverview(days) {
  const since = daysAgo(days - 1);
  const prevSince = daysAgo(2 * days - 1);
  const sum = { views: { $sum: '$views' }, reads: { $sum: '$reads' }, readSeconds: { $sum: '$readSeconds' }, timed: { $sum: '$timed' } };
  const [daily, previous, perArticle, referrers, allTime] = await Promise.all([
    ArticleStat.aggregate([{ $match: { day: { $gte: since } } }, { $group: { _id: '$day', ...sum } }, { $sort: { _id: 1 } }]),
    ArticleStat.aggregate([{ $match: { day: { $gte: prevSince, $lt: since } } }, { $group: { _id: null, ...sum } }]),
    ArticleStat.aggregate([
      { $match: { day: { $gte: since } } },
      { $group: { _id: '$article', ...sum } },
      { $sort: { views: -1, reads: -1 } },
      { $limit: 200 },
      { $lookup: { from: Article.collection.name, localField: '_id', foreignField: '_id', as: 'a' } },
      { $unwind: '$a' },
      { $project: { views: 1, reads: 1, readSeconds: 1, timed: 1, title: '$a.title', slug: '$a.slug', status: '$a.status', publishedAt: '$a.publishedAt' } },
    ]),
    ReferrerStat.aggregate([{ $match: { day: { $gte: since } } }, { $group: { _id: '$host', views: { $sum: '$views' } } }, { $sort: { views: -1 } }, { $limit: 12 }]),
    Article.aggregate([{ $group: { _id: null, views: { $sum: '$views' }, reads: { $sum: '$reads' } } }]),
  ]);

  const byDay = new Map(daily.map((d) => [d._id, d]));
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = daysAgo(i);
    const d = byDay.get(day);
    series.push({ day, views: d?.views || 0, reads: d?.reads || 0 });
  }
  const total = (rows) => {
    const t = rows.reduce((acc, r) => ({ views: acc.views + r.views, reads: acc.reads + r.reads, readSeconds: acc.readSeconds + r.readSeconds, timed: acc.timed + r.timed }), { views: 0, reads: 0, readSeconds: 0, timed: 0 });
    return { views: t.views, reads: t.reads, readRate: t.views ? t.reads / t.views : 0, avgReadSeconds: t.timed ? Math.round(t.readSeconds / t.timed) : 0 };
  };
  const posts = perArticle.map((p) => ({ _id: p._id, title: p.title, slug: p.slug, status: p.status, views: p.views, reads: p.reads, readRate: p.views ? p.reads / p.views : 0, avgReadSeconds: p.timed ? Math.round(p.readSeconds / p.timed) : 0 }));
  return {
    days,
    totals: total(daily),
    previous: total(previous),
    series,
    mostViewed: posts.slice(0, 10),
    mostRead: [...posts].filter((p) => p.reads > 0).sort((a, b) => b.reads - a.reads || b.views - a.views).slice(0, 10),
    referrers: referrers.map((r) => ({ host: r._id, views: r.views })),
    allTime: { views: allTime[0]?.views || 0, reads: allTime[0]?.reads || 0 },
  };
}
