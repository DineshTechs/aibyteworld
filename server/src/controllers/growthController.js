import { z } from 'zod';
import { Article, Growth, Media, NewsletterSubscriber, ResearchJob, SiteSettings, TelegramBot, Translation } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { pingIndexNow } from '../services/growth/indexnow.js';
import { CHANNELS, CHANNEL_NAMES, channelReady, checkChannel, linkedinVersion, shareArticle } from '../services/growth/share.js';
import { growthWithSecrets, hasSecret, publicBase } from '../services/growth/common.js';
import { optimizeExisting, optimizerAvailable } from '../services/images/optimize.js';
import { applyRefresh, discardRefresh, refreshCandidates, startRefresh } from '../services/refresh/refreshService.js';
import { LANGS, queueTranslation } from '../services/translate/translator.js';
import { encryptSecret } from '../utils/crypto.js';
import { plainText } from '../utils/content.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';

const secret = z.string().trim().max(1000).optional(); // empty or missing = keep the saved value
const email = z.string().trim().max(200).refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address');

export const growthSchema = z.object({
  share: z
    .object({
      telegram: z.object({ enabled: z.boolean(), channel: z.string().trim().max(100).regex(/^($|@[A-Za-z0-9_]{4,32}|-100\d{5,20})$/, 'Use @channelname or the numeric channel ID (-100…)') }).optional(),
      x: z.object({ enabled: z.boolean(), apiKey: secret, apiSecret: secret, accessToken: secret, accessSecret: secret }).optional(),
      linkedin: z.object({ enabled: z.boolean(), token: secret, author: z.string().trim().max(120).regex(/^($|urn:li:(person|organization):[A-Za-z0-9_-]+)$/, 'Use urn:li:person:… or urn:li:organization:…'), version: z.string().trim().regex(/^($|\d{6})$/, 'Use YYYYMM, for example 202509') }).optional(),
      facebook: z.object({ enabled: z.boolean(), pageId: z.string().trim().regex(/^($|\d{5,25})$/, 'The Page ID is a number'), token: secret }).optional(),
      hashtags: z.number().int().min(0).max(5).optional(),
      includeTranslations: z.boolean().optional(),
    })
    .optional(),
  newsletter: z
    .object({
      provider: z.enum(['none', 'brevo', 'resend']),
      apiKey: secret,
      fromEmail: email,
      fromName: z.string().trim().max(80).default(''),
      replyTo: email.default(''),
      doubleOptIn: z.boolean(),
      digest: z.object({ enabled: z.boolean(), day: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'), maxPosts: z.number().int().min(1).max(12) }),
    })
    .optional(),
  indexnow: z.object({ enabled: z.boolean() }).optional(),
  links: z.object({ enabled: z.boolean(), maxPerArticle: z.number().int().min(1).max(8), backfill: z.boolean() }).optional(),
  translation: z.object({ hindi: z.boolean(), autoPublish: z.boolean() }).optional(),
  refresh: z.object({ perWeek: z.number().int().min(0).max(7), minAgeDays: z.number().int().min(30).max(730) }).optional(),
});

const SECRET_FIELDS = {
  'share.x.apiKey': ['share', 'x', 'apiKey'],
  'share.x.apiSecret': ['share', 'x', 'apiSecret'],
  'share.x.accessToken': ['share', 'x', 'accessToken'],
  'share.x.accessSecret': ['share', 'x', 'accessSecret'],
  'share.linkedin.token': ['share', 'linkedin', 'token'],
  'share.facebook.token': ['share', 'facebook', 'token'],
  'newsletter.apiKey': ['newsletter', 'apiKey'],
};
const last4Of = { 'share.x.accessToken': 'share.x.last4', 'share.linkedin.token': 'share.linkedin.last4', 'share.facebook.token': 'share.facebook.last4', 'newsletter.apiKey': 'newsletter.last4' };

const plain = (o) => (o?.toObject ? o.toObject() : JSON.parse(JSON.stringify(o || {})));

async function view() {
  const [g, settings, tgDoc, queued, recentTranslations, photosMissing, available, counts] = await Promise.all([
    growthWithSecrets(),
    SiteSettings.getSingleton(),
    TelegramBot.findOne({ key: 'telegram' }).select('+token.data botUsername').lean(),
    Translation.countDocuments({ status: { $in: ['queued', 'running'] } }),
    Translation.find().sort({ createdAt: -1 }).limit(8).populate('source', 'title').populate('article', 'title slug status').lean(),
    Media.countDocuments({ storage: 'local', mimeType: { $ne: 'image/gif' }, $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }] }),
    optimizerAvailable(),
    NewsletterSubscriber.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const base = publicBase(settings.siteUrl);
  const st = (s) => ({ lastOkAt: s.lastOkAt || null, lastError: s.lastError || '' });
  const s = g.share;
  const tgReady = Boolean(tgDoc?.token?.data);
  const n = g.newsletter;
  const c = Object.fromEntries(counts.map((r) => [r._id, r.n]));
  return {
    siteUrl: settings.siteUrl,
    base,
    share: {
      telegram: { enabled: s.telegram.enabled, channel: s.telegram.channel, botReady: tgReady, botUsername: tgDoc?.botUsername || '', ready: channelReady(g, 'telegram', { tgToken: tgReady }), ...st(s.telegram) },
      x: { enabled: s.x.enabled, has: Object.fromEntries(['apiKey', 'apiSecret', 'accessToken', 'accessSecret'].map((k) => [k, hasSecret(g, `share.x.${k}`)])), last4: s.x.last4, ready: channelReady(g, 'x'), ...st(s.x) },
      linkedin: { enabled: s.linkedin.enabled, hasToken: hasSecret(g, 'share.linkedin.token'), last4: s.linkedin.last4, author: s.linkedin.author, version: s.linkedin.version, versionUsed: linkedinVersion(s.linkedin.version), ready: channelReady(g, 'linkedin'), ...st(s.linkedin) },
      facebook: { enabled: s.facebook.enabled, pageId: s.facebook.pageId, hasToken: hasSecret(g, 'share.facebook.token'), last4: s.facebook.last4, ready: channelReady(g, 'facebook'), ...st(s.facebook) },
      hashtags: s.hashtags,
      includeTranslations: s.includeTranslations,
      lastSkipped: s.lastSkipped,
    },
    newsletter: {
      provider: n.provider,
      hasKey: hasSecret(g, 'newsletter.apiKey'),
      last4: n.last4,
      fromEmail: n.fromEmail,
      fromName: n.fromName,
      replyTo: n.replyTo,
      doubleOptIn: n.doubleOptIn,
      digest: { enabled: n.digest.enabled, day: n.digest.day, time: n.digest.time, maxPosts: n.digest.maxPosts, lastSentDay: n.digest.lastSentDay },
      ready: Boolean(n.provider !== 'none' && hasSecret(g, 'newsletter.apiKey') && n.fromEmail),
      history: [...(n.history || [])].reverse(),
      subscribers: { subscribed: c.subscribed || 0, pending: c.pending || 0, unsubscribed: c.unsubscribed || 0 },
      timezone: settings.autopilot?.timezone || 'UTC',
      ...st(n),
    },
    indexnow: { enabled: g.indexnow.enabled, key: g.indexnow.key, keyUrl: base ? `${base}/${g.indexnow.key}.txt` : '', lastPingAt: g.indexnow.lastPingAt || null, lastResult: g.indexnow.lastResult },
    links: plain(g.links),
    translation: { ...plain(g.translation), queued, recent: recentTranslations },
    refresh: plain(g.refresh),
    photos: { available, missing: photosMissing },
  };
}

export const getGrowth = asyncHandler(async (_req, res) => res.json(await view()));

export const updateGrowth = asyncHandler(async (req, res) => {
  const b = req.body;
  const g = await growthWithSecrets();
  const changed = [];
  const setSecret = (path, value) => {
    if (!value) return;
    const [a, bb, cc] = SECRET_FIELDS[path];
    const box = encryptSecret(value);
    if (cc) g[a][bb][cc] = box;
    else g[a][bb] = box;
    const l4 = last4Of[path];
    if (l4) {
      const [x, y, z2] = l4.split('.');
      if (z2) g[x][y][z2] = value.slice(-4);
      else g[x][y] = value.slice(-4);
    }
  };
  if (b.share) {
    const s = b.share;
    if (s.telegram) Object.assign(g.share.telegram, { enabled: s.telegram.enabled, channel: s.telegram.channel });
    if (s.x) {
      g.share.x.enabled = s.x.enabled;
      ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'].forEach((k) => setSecret(`share.x.${k}`, s.x[k]));
    }
    if (s.linkedin) {
      Object.assign(g.share.linkedin, { enabled: s.linkedin.enabled, author: s.linkedin.author, version: s.linkedin.version });
      setSecret('share.linkedin.token', s.linkedin.token);
    }
    if (s.facebook) {
      Object.assign(g.share.facebook, { enabled: s.facebook.enabled, pageId: s.facebook.pageId });
      setSecret('share.facebook.token', s.facebook.token);
    }
    if (s.hashtags !== undefined) g.share.hashtags = s.hashtags;
    if (s.includeTranslations !== undefined) g.share.includeTranslations = s.includeTranslations;
    changed.push('sharing');
  }
  if (b.newsletter) {
    const n = b.newsletter;
    Object.assign(g.newsletter, { provider: n.provider, fromEmail: n.fromEmail.toLowerCase(), fromName: plainText(n.fromName), replyTo: n.replyTo.toLowerCase(), doubleOptIn: n.doubleOptIn });
    Object.assign(g.newsletter.digest, n.digest);
    setSecret('newsletter.apiKey', n.apiKey);
    changed.push('newsletter');
  }
  if (b.indexnow) {
    g.indexnow.enabled = b.indexnow.enabled;
    changed.push('IndexNow');
  }
  if (b.links) {
    Object.assign(g.links, b.links);
    changed.push('internal links');
  }
  if (b.translation) {
    Object.assign(g.translation, b.translation);
    changed.push('translations');
  }
  if (b.refresh) {
    Object.assign(g.refresh, b.refresh);
    changed.push('post refresh');
  }
  for (const section of ['share', 'newsletter', 'indexnow', 'links', 'translation', 'refresh']) if (b[section]) g.markModified(section);
  await g.save();
  await logActivity(req, 'growth.settings', { entityType: 'Growth', summary: `Updated ${changed.join(', ') || 'growth'} settings` });
  res.json(await view());
});

export const removeGrowthSecret = asyncHandler(async (req, res) => {
  const name = String(req.params.name);
  const paths = { x: ['share.x.apiKey', 'share.x.apiSecret', 'share.x.accessToken', 'share.x.accessSecret'], linkedin: ['share.linkedin.token'], facebook: ['share.facebook.token'], newsletter: ['newsletter.apiKey'] }[name];
  if (!paths) throw notFound('Unknown key');
  const unset = Object.fromEntries(paths.map((p) => [p, 1]));
  const off = { x: 'share.x.enabled', linkedin: 'share.linkedin.enabled', facebook: 'share.facebook.enabled' }[name];
  const l4 = { x: 'share.x.last4', linkedin: 'share.linkedin.last4', facebook: 'share.facebook.last4', newsletter: 'newsletter.last4' }[name];
  await Growth.updateOne({ key: 'growth' }, { $unset: unset, $set: { [l4]: '', ...(off ? { [off]: false } : {}), ...(name === 'newsletter' ? { 'newsletter.digest.enabled': false } : {}) } });
  await logActivity(req, 'growth.key_removed', { entityType: 'Growth', summary: `Removed the ${name} key` });
  res.json(await view());
});

export const checkGrowthChannel = asyncHandler(async (req, res) => {
  const ch = String(req.params.channel);
  if (!CHANNELS.includes(ch)) throw notFound('Unknown channel');
  try {
    const message = await checkChannel(ch);
    await Growth.updateOne({ key: 'growth' }, { $set: { [`share.${ch}.lastError`]: '' } });
    res.json({ ok: true, message, growth: await view() });
  } catch (err) {
    await Growth.updateOne({ key: 'growth' }, { $set: { [`share.${ch}.lastError`]: String(err.message).slice(0, 300) } });
    res.json({ ok: false, message: err.message, growth: await view() });
  }
});

export const pingIndexNowNow = asyncHandler(async (req, res) => {
  const latest = await Article.find({ status: 'published', publishedAt: { $lte: new Date() }, 'seo.noindex': { $ne: true } }).sort({ updatedAt: -1 }).limit(50).select('slug').lean();
  const result = await pingIndexNow(['/', ...latest.map((a) => `/blog/${a.slug}`)], { force: true });
  await logActivity(req, 'growth.indexnow', { entityType: 'Growth', summary: `IndexNow: ${result.ok ? `sent ${result.urls} addresses` : result.skipped || result.error}` });
  res.json({ result, growth: await view() });
});

// ---------- Photos ----------
export const optimizePhotos = asyncHandler(async (req, res) => {
  if (!(await optimizerAvailable())) throw badRequest('The photo optimiser is not installed. Run setup.bat again (it installs the "sharp" library) and restart the server.');
  const result = await optimizeExisting(40);
  await logActivity(req, 'media.optimize', { entityType: 'Media', summary: `Optimised ${result.optimised} photos used in ${result.posts} posts` });
  res.json({ result, growth: await view() });
});

// ---------- Per-article actions ----------
export const shareNow = asyncHandler(async (req, res) => {
  const article = await Article.findById(req.params.id).select('status title').lean();
  if (!article) throw notFound('Article not found');
  if (article.status !== 'published') throw badRequest('Only published posts can be shared');
  const result = await shareArticle(article._id, { retry: true });
  if (result.skipped) throw badRequest(`Not shared: ${result.skipped}.`);
  const parts = Object.entries(result.results || {}).map(([ch, r]) => `${CHANNEL_NAMES[ch]}: ${r.ok ? 'shared' : r.skipped || r.error}`);
  await logActivity(req, 'article.share', { entityType: 'Article', entityId: article._id, summary: `Shared "${article.title}": ${parts.join('; ')}`.slice(0, 500) });
  const fresh = await Article.findById(article._id).select('shares').lean();
  res.json({ results: result.results, shares: fresh.shares });
});

export const translateNow = asyncHandler(async (req, res) => {
  const lang = String(req.body?.lang || 'hi');
  if (!LANGS[lang]) throw badRequest('Unsupported language');
  const article = await Article.findById(req.params.id).select('translationOf title content').lean();
  if (!article) throw notFound('Article not found');
  if (article.translationOf) throw badRequest('This post is already a translation');
  if (!article.content) throw badRequest('Write the post before translating it');
  const task = await queueTranslation(article._id, { user: req.user, lang });
  if (!task) throw badRequest('A translation of this post is already in progress');
  await logActivity(req, 'translation.queued', { entityType: 'Article', entityId: article._id, summary: `${LANGS[lang].name} translation of "${article.title}" queued` });
  res.status(202).json({ task });
});

export const refreshOverview = asyncHandler(async (_req, res) => {
  const [candidates, waiting, jobs, growth] = await Promise.all([
    refreshCandidates({ limit: 25 }),
    Article.find({ refresh: { $exists: true, $ne: null } }).select('title slug refresh.createdAt refresh.title refresh.words').lean(),
    ResearchJob.find({ 'input.refreshOf': { $exists: true } }).sort({ createdAt: -1 }).limit(10).select('input.topic input.refreshOf status error createdAt finishedAt').lean(),
    Growth.getSingleton(),
  ]);
  res.json({ candidates, waiting, jobs, settings: growth.refresh });
});

export const startRefreshNow = asyncHandler(async (req, res) => {
  const job = await startRefresh(req.params.id, { user: req.user, reason: 'started by hand' });
  res.status(201).json({ job: { _id: job._id, topic: job.input.topic } });
});

export const applyRefreshNow = asyncHandler(async (req, res) => {
  const article = await applyRefresh(req.params.id, req.user);
  res.json({ article: { _id: article._id, title: article.title, slug: article.slug, refreshedAt: article.refreshedAt } });
});

export const discardRefreshNow = asyncHandler(async (req, res) => {
  await discardRefresh(req.params.id, req.user);
  res.status(204).end();
});
