import { Article, ArticleStat, Growth, ResearchJob, SiteSettings, User } from '../../models/index.js';
import { excerptFrom, htmlToText, readingTimeMinutes } from '../../utils/content.js';
import { badRequest, notFound } from '../../utils/http.js';
import { logActivity } from '../activityService.js';
import { providerChain } from '../ai/providerService.js';
import { dayKey } from '../analyticsService.js';
import { afterUpdate } from '../publishHooks.js';
import { queueTranslation } from '../translate/translator.js';

// Post refresh: older posts whose visits are falling (or that are simply
// getting old) are researched again and rewritten. The updated version waits
// on the original post until an editor applies it; the address never changes,
// so search rankings and links are kept.

const DAY = 86400000;
const visible = () => ({ status: 'published', publishedAt: { $lte: new Date() } });
const ACTIVE = ['queued', 'running'];

export async function refreshCandidates({ limit = 20, now = new Date() } = {}) {
  const growth = await Growth.getSingleton();
  const cutoff = new Date(now.getTime() - growth.refresh.minAgeDays * DAY);
  const articles = await Article.find({
    ...visible(),
    translationOf: null,
    publishedAt: { $lte: cutoff },
    $and: [{ $or: [{ refreshedAt: null }, { refreshedAt: { $lte: cutoff } }] }, { $or: [{ refresh: null }, { refresh: { $exists: false } }] }],
  })
    .select('title slug publishedAt refreshedAt views reads origin')
    .limit(500)
    .lean();
  if (!articles.length) return [];
  const ids = articles.map((a) => a._id);
  const busy = new Set((await ResearchJob.find({ 'input.refreshOf': { $in: ids }, status: { $in: ACTIVE } }).select('input.refreshOf').lean()).map((j) => String(j.input.refreshOf)));
  const d28 = dayKey(new Date(now.getTime() - 28 * DAY));
  const d56 = dayKey(new Date(now.getTime() - 56 * DAY));
  const stats = await ArticleStat.aggregate([
    { $match: { article: { $in: ids }, day: { $gte: d56 } } },
    { $group: { _id: '$article', last: { $sum: { $cond: [{ $gte: ['$day', d28] }, '$views', 0] } }, prev: { $sum: { $cond: [{ $lt: ['$day', d28] }, '$views', 0] } } } },
  ]);
  const byId = new Map(stats.map((s) => [String(s._id), s]));
  return articles
    .filter((a) => !busy.has(String(a._id)))
    .map((a) => {
      const s = byId.get(String(a._id)) || { last: 0, prev: 0 };
      const drop = s.prev >= 5 ? Math.max(0, (s.prev - s.last) / s.prev) : 0;
      const since = a.refreshedAt || a.publishedAt;
      const months = Math.floor((now - new Date(since)) / (30 * DAY));
      const reasons = [];
      if (drop >= 0.2) reasons.push(`visits down ${Math.round(drop * 100)}% (last 4 weeks: ${s.last}, the 4 weeks before: ${s.prev})`);
      reasons.push(`${a.refreshedAt ? 'last updated' : 'published'} ${months} month${months === 1 ? '' : 's'} ago`);
      return { _id: a._id, title: a.title, slug: a.slug, publishedAt: a.publishedAt, refreshedAt: a.refreshedAt, views28: s.last, viewsPrev28: s.prev, score: Math.round(drop * 100 + Math.min(months, 24) * 3), reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Starts a refresh job for a published post. */
export async function startRefresh(articleId, { user, reason = 'manual' } = {}) {
  const article = await Article.findById(articleId);
  if (!article) throw notFound('Article not found');
  if (article.status !== 'published') throw badRequest('Only published posts can be refreshed');
  if (article.translationOf) throw badRequest('Refresh the original post; its Hindi version is updated afterwards');
  if (article.refresh) throw badRequest('An updated version is already waiting. Apply or discard it first.');
  if (await ResearchJob.exists({ 'input.refreshOf': article._id, status: { $in: ACTIVE } })) throw badRequest('A refresh of this post is already running');
  const settings = await SiteSettings.getSingleton();
  const [research, writer] = await Promise.all([providerChain(settings.ai, 'research'), providerChain(settings.ai, 'writer')]);
  if (!research.chain.length || !writer.chain.length) throw badRequest('No research or writing provider is ready. Check AI Providers.');
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  if ((await ResearchJob.countDocuments({ createdAt: { $gte: since } })) >= settings.ai.dailyJobLimit) throw badRequest(`The daily limit of ${settings.ai.dailyJobLimit} AI articles is reached.`);
  const owner = user || (await User.findOne({ role: 'admin', active: true }).sort({ createdAt: 1 }));
  if (!owner) throw badRequest('No active administrator to run the refresh as.');
  const words = htmlToText(article.content).split(/\s+/).filter(Boolean).length;
  const headings = [...String(article.content).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => htmlToText(m[1])).filter((h) => h && !/^sources$/i.test(h)).slice(0, 12);
  const first = new Date(article.publishedAt).toISOString().slice(0, 10);
  const ap = settings.autopilot;
  const job = await ResearchJob.create({
    input: {
      topic: article.title,
      primaryKeyword: article.seo?.focusKeyword || '',
      secondaryKeywords: (article.seo?.secondaryKeywords || []).slice(0, 8),
      country: ap.country || settings.ai.defaultCountry || '',
      language: 'English',
      audience: '',
      length: Math.min(4000, Math.max(800, Math.round(words / 100) * 100)),
      style: ap.style || settings.ai.defaultStyle,
      category: article.categories?.[0],
      refreshOf: article._id,
      instructions: `This is an update of an existing published post titled "${article.title}" (first published ${first}). Write a refreshed version for the same search intent: correct anything that is now out of date using only the new research findings, add what is new, and keep the parts that are still useful. The current sections are: ${headings.join('; ') || 'not structured'}.`.slice(0, 4000),
    },
    provider: writer.chain[0].key,
    model: writer.chain[0].model,
    createdBy: owner._id,
  });
  await Growth.updateOne({ key: 'growth' }, { $set: { 'refresh.lastStartedAt': new Date(), 'refresh.lastResult': `Started a refresh of "${article.title}" (${reason})`.slice(0, 300) } });
  await logActivity({ user: owner }, 'refresh.started', { entityType: 'Article', entityId: article._id, summary: `Refresh started for "${article.title}" (${reason})` });
  return job;
}

/** Replaces the post with its updated version (same address). */
export async function applyRefresh(articleId, user) {
  const article = await Article.findById(articleId);
  if (!article) throw notFound('Article not found');
  const r = article.refresh;
  if (!r?.content) throw badRequest('There is no updated version to apply');
  const text = htmlToText(r.content);
  article.title = r.title || article.title;
  article.content = r.content;
  article.contentText = text;
  if (article.excerptIsAuto) article.excerpt = excerptFrom(text);
  article.readingTime = readingTimeMinutes(text);
  if (r.sources?.length) article.sources = r.sources;
  const prev = article.seo?.toObject ? article.seo.toObject() : article.seo || {};
  article.seo = { ...prev, ...(r.seo || {}), focusKeyword: prev.focusKeyword || r.seo?.focusKeyword || '', canonicalUrl: prev.canonicalUrl || '', noindex: Boolean(prev.noindex) };
  if (!article.featuredImage?.url && r.featuredImage?.url) article.featuredImage = r.featuredImage;
  article.refreshedAt = new Date();
  article.refresh = undefined;
  article.history.push({ action: 'refreshed', by: user?._id, note: `Updated version from refresh job ${r.job} applied` });
  await article.save();
  await logActivity({ user }, 'refresh.applied', { entityType: 'Article', entityId: article._id, summary: `Updated version of "${article.title}" applied` });
  await afterUpdate(article._id);
  if (await Article.exists({ translationOf: article._id })) await queueTranslation(article._id, { user });
  return article;
}

export async function discardRefresh(articleId, user) {
  const article = await Article.findById(articleId);
  if (!article) throw notFound('Article not found');
  if (!article.refresh) throw badRequest('There is no updated version to discard');
  article.refresh = undefined;
  article.history.push({ action: 'updated', by: user?._id, note: 'Updated version from a refresh discarded' });
  await article.save();
  await logActivity({ user }, 'refresh.discarded', { entityType: 'Article', entityId: article._id, summary: `Updated version of "${article.title}" discarded` });
  return article;
}

/** Weekly automatic refreshes (called every few minutes). Returns the job started, if any. */
export async function refreshTick(now = new Date()) {
  const growth = await Growth.getSingleton();
  const n = growth.refresh.perWeek;
  if (!n) return null;
  const gap = (7 / n) * DAY;
  if (growth.refresh.lastStartedAt && now - growth.refresh.lastStartedAt < gap) return null;
  if ((await ResearchJob.countDocuments({ 'input.refreshOf': { $exists: true }, createdAt: { $gte: new Date(now.getTime() - 7 * DAY) } })) >= n) return null;
  const [top] = await refreshCandidates({ limit: 1, now });
  if (!top || top.score <= 0) return null;
  try {
    return await startRefresh(top._id, { reason: `weekly: ${top.reasons.join(', ')}` });
  } catch (err) {
    await Growth.updateOne({ key: 'growth' }, { $set: { 'refresh.lastStartedAt': now, 'refresh.lastResult': `Skipped: ${err.message}`.slice(0, 300) } });
    return null;
  }
}
