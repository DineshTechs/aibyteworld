import { z } from 'zod';
import { isStaffEditor } from '../middleware/auth.js';
import { objectId } from '../middleware/validate.js';
import { ARTICLE_STATUSES, Article, Category, Media, Tag, User } from '../models/index.js';
import { notifySubmitted } from '../services/telegram/bot.js';
import { afterPublish, afterUnpublish, afterUpdate } from '../services/publishHooks.js';
import { Translation } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { excerptFrom, htmlToText, plainText, readingTimeMinutes, sanitizeArticleHtml, uniqueSlug } from '../utils/content.js';
import { extractFaq } from '../utils/writingQuality.js';
import { asyncHandler, badRequest, escapeRegex, forbidden, notFound, paged, parsePaging } from '../utils/http.js';

const imageUrl = z.string().max(500).regex(/^($|\/uploads\/|https?:\/\/)/, 'Must be an uploaded image or http(s) URL');

export const articleSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  slug: z.string().trim().max(140).optional(),
  excerpt: z.string().max(400).optional(),
  content: z.string().max(500000).default(''),
  featuredImage: z.object({ url: imageUrl.default(''), alt: z.string().max(300).default('') }).default({}),
  categories: z.array(objectId).max(10).default([]),
  tags: z.array(objectId).max(30).default([]),
  status: z.enum(ARTICLE_STATUSES).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  featured: z.boolean().optional(),
  author: objectId.optional(),
  seo: z
    .object({
      title: z.string().max(120).default(''),
      description: z.string().max(320).default(''),
      focusKeyword: z.string().max(120).default(''),
      canonicalUrl: z.string().max(500).regex(/^($|https?:\/\/)/, 'Must be an http(s) URL').default(''),
      noindex: z.boolean().default(false),
      ogTitle: z.string().max(120).optional(),
      ogDescription: z.string().max(300).optional(),
      secondaryKeywords: z.array(z.string().max(120)).max(15).optional(),
    })
    .default({}),
});

export const statusSchema = z.object({
  status: z.enum(ARTICLE_STATUSES),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().max(300).optional(),
});

const POPULATE = [
  { path: 'author', select: 'name avatarUrl' },
  { path: 'categories', select: 'name slug' },
  { path: 'tags', select: 'name slug' },
];

const AUTHOR_STATUSES = ['draft', 'pending_approval'];

function assertCanEdit(user, article) {
  if (isStaffEditor(user)) return;
  if (String(article.author) !== String(user._id)) throw forbidden('You can only edit your own articles');
  if (!AUTHOR_STATUSES.includes(article.status)) {
    throw forbidden('This article has been approved. Ask an editor to make further changes.');
  }
}

// Applies a status change with the publishing rules. Only editors and admins
// may publish, schedule or archive - authors can only submit for approval.
function applyStatus(article, nextStatus, scheduledAt, user, note = '') {
  const prev = article.status;
  if (!isStaffEditor(user) && !AUTHOR_STATUSES.includes(nextStatus)) {
    throw forbidden('Only editors and administrators can publish, schedule or archive articles');
  }
  if (nextStatus === 'scheduled') {
    const when = scheduledAt ? new Date(scheduledAt) : null;
    if (!when || Number.isNaN(when.getTime())) throw badRequest('Choose a date and time to schedule this article');
    if (when.getTime() <= Date.now()) throw badRequest('The scheduled time must be in the future');
    article.scheduledAt = when;
  } else {
    article.scheduledAt = undefined;
  }
  if (nextStatus === 'published') {
    if (htmlToText(article.content).length === 0) throw badRequest('An article needs content before it can be published');
    if (!article.publishedAt) article.publishedAt = new Date();
  }
  article.status = nextStatus;
  if (prev !== nextStatus) {
    article.history.push({ action: `status:${prev}->${nextStatus}`, by: user._id, note });
  }
  return prev;
}

// Search engines, sharing and translations follow publishing (see publishHooks.js).
async function runPublishHooks(article, before, beforeSlug) {
  if (article.status === 'published' && before !== 'published') await afterPublish(article._id);
  else if (article.status === 'published') await afterUpdate(article._id);
  else if (before === 'published') await afterUnpublish(beforeSlug || article.slug);
}

async function assertRefsExist(categories, tags) {
  const [c, t] = await Promise.all([
    Category.countDocuments({ _id: { $in: categories } }),
    Tag.countDocuments({ _id: { $in: tags } }),
  ]);
  if (c !== new Set(categories).size) throw badRequest('One or more categories do not exist');
  if (t !== new Set(tags).size) throw badRequest('One or more tags do not exist');
}

async function fillFromInput(article, input, user) {
  await assertRefsExist(input.categories, input.tags);
  const content = sanitizeArticleHtml(input.content);
  const text = htmlToText(content);

  article.title = plainText(input.title);
  if (!article.title) throw badRequest('Title is required');
  article.slug = await uniqueSlug(Article, input.slug || article.slug || article.title, article._id);
  article.content = content;
  article.contentText = text;
  // An excerpt sent back unchanged after it was generated stays automatic, so it
  // follows later content edits; anything the editor typed is kept as written.
  const typed = plainText(input.excerpt || '');
  const keepAuto = !typed || (article.excerptIsAuto && typed === article.excerpt);
  article.excerpt = keepAuto ? excerptFrom(text) : typed;
  article.excerptIsAuto = keepAuto;
  article.readingTime = readingTimeMinutes(text);
  // Size and credit belong to the picture: kept while the same picture is used.
  // A picture chosen from the media library brings its size and credit with it.
  const same = article.featuredImage?.url && article.featuredImage.url === input.featuredImage.url;
  const media = !same && input.featuredImage.url ? await Media.findOne({ url: input.featuredImage.url }).lean() : null;
  article.featuredImage = {
    url: input.featuredImage.url,
    alt: plainText(input.featuredImage.alt),
    ...(same ? { width: article.featuredImage.width, height: article.featuredImage.height, credit: article.featuredImage.credit || '', variants: article.featuredImage.variants?.length ? article.featuredImage.variants : undefined } : {}),
    ...(media ? { width: media.width, height: media.height, credit: sanitizeArticleHtml(media.credit?.html || ''), variants: media.variants?.length ? media.variants.map(({ width, url }) => ({ width, url })) : undefined } : {}),
  };
  article.categories = [...new Set(input.categories)];
  article.tags = [...new Set(input.tags)];
  // Fields the editor does not send (for example AI-generated Open Graph text)
  // are kept; the FAQ list always follows the article's FAQ section.
  const prev = article.seo?.toObject ? article.seo.toObject() : article.seo || {};
  article.seo = {
    ...prev,
    title: plainText(input.seo.title),
    description: plainText(input.seo.description),
    focusKeyword: plainText(input.seo.focusKeyword),
    canonicalUrl: input.seo.canonicalUrl,
    noindex: input.seo.noindex,
    ...(input.seo.ogTitle !== undefined ? { ogTitle: plainText(input.seo.ogTitle) } : {}),
    ...(input.seo.ogDescription !== undefined ? { ogDescription: plainText(input.seo.ogDescription) } : {}),
    ...(input.seo.secondaryKeywords !== undefined ? { secondaryKeywords: input.seo.secondaryKeywords.map(plainText).filter(Boolean) } : {}),
    faq: extractFaq(content),
  };

  if (isStaffEditor(user)) {
    if (typeof input.featured === 'boolean') article.featured = input.featured;
    if (input.author && String(input.author) !== String(article.author)) {
      if (!(await User.exists({ _id: input.author, active: true }))) throw badRequest('Selected author does not exist');
      article.author = input.author;
    }
  }
}

export const listArticles = asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (ARTICLE_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (['manual', 'ai'].includes(req.query.origin)) filter.origin = req.query.origin;
  if (req.query.q) filter.title = { $regex: escapeRegex(String(req.query.q).slice(0, 100)), $options: 'i' };
  if (!isStaffEditor(req.user)) filter.author = req.user._id; // authors see only their own

  const [items, total] = await Promise.all([
    Article.find(filter)
      .select('-content -contentText -history -refresh.content -refresh.seo')
      .sort({ updatedAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate(POPULATE)
      .lean(),
    Article.countDocuments(filter),
  ]);
  res.json(paged(items, total, paging));
});

export const getArticle = asyncHandler(async (req, res) => {
  const article = await Article.findById(req.params.id)
    .select('-contentText')
    .populate([...POPULATE, { path: 'history.by', select: 'name' }, { path: 'sources', select: 'url title domain publishedAt reachable job' }]);
  if (!article) throw notFound('Article not found');
  if (!isStaffEditor(req.user) && String(article.author._id) !== String(req.user._id)) throw forbidden();
  // Language versions of this post and the latest translation request.
  const originalId = article.translationOf || article._id;
  const [translations, translationTask] = await Promise.all([
    Article.find({ $or: [{ _id: originalId }, { translationOf: originalId }], _id: { $ne: article._id } }).select('title slug status language translationOf').lean(),
    Translation.findOne({ source: originalId }).sort({ createdAt: -1 }).select('status error lang createdAt finishedAt article').lean(),
  ]);
  res.json({ article, translations, translationTask });
});

export const createArticle = asyncHandler(async (req, res) => {
  const article = new Article({ author: req.user._id, origin: 'manual', status: 'draft' });
  await fillFromInput(article, req.body, req.user);
  article.history.push({ action: 'created', by: req.user._id });
  if (req.body.status && req.body.status !== 'draft') {
    applyStatus(article, req.body.status, req.body.scheduledAt, req.user);
  }
  await article.save();
  if (article.status === 'pending_approval') await notifySubmitted(article, req.user.name);
  await runPublishHooks(article, 'draft');
  await logActivity(req, 'article.create', { entityType: 'Article', entityId: article._id, summary: `Created "${article.title}" (${article.status})` });
  await article.populate(POPULATE);
  res.status(201).json({ article });
});

export const updateArticle = asyncHandler(async (req, res) => {
  const article = await Article.findById(req.params.id);
  if (!article) throw notFound('Article not found');
  assertCanEdit(req.user, article);

  const beforeSlug = article.slug;
  await fillFromInput(article, req.body, req.user);
  let statusChange = '';
  const before = article.status;
  if (req.body.status && (req.body.status !== article.status || req.body.status === 'scheduled')) {
    const prev = applyStatus(article, req.body.status, req.body.scheduledAt, req.user);
    if (prev !== article.status) statusChange = ` (${prev} -> ${article.status})`;
  }
  // Keep the history bounded: record at most one "updated" entry per editor per hour.
  const last = article.history[article.history.length - 1];
  const recent = last && last.action === 'updated' && String(last.by) === String(req.user._id) && Date.now() - new Date(last.at).getTime() < 3600000;
  if (!statusChange && !recent) article.history.push({ action: 'updated', by: req.user._id });
  if (article.history.length > 200) article.history = article.history.slice(-200);

  await article.save();
  if (article.status === 'pending_approval' && before !== 'pending_approval') await notifySubmitted(article, req.user.name);
  await runPublishHooks(article, before, beforeSlug);
  if (beforeSlug !== article.slug && before === 'published') await afterUnpublish(beforeSlug);
  if (statusChange || !req.query.autosave) {
    await logActivity(req, statusChange ? `article.${article.status}` : 'article.update', {
      entityType: 'Article',
      entityId: article._id,
      summary: `Updated "${article.title}"${statusChange}`,
    });
  }
  await article.populate(POPULATE);
  res.json({ article });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const article = await Article.findById(req.params.id);
  if (!article) throw notFound('Article not found');
  if (!isStaffEditor(req.user)) assertCanEdit(req.user, article);
  const prev = applyStatus(article, req.body.status, req.body.scheduledAt, req.user, req.body.note || '');
  await article.save();
  if (article.status === 'pending_approval' && prev !== 'pending_approval') await notifySubmitted(article, req.user.name);
  await runPublishHooks(article, prev);
  await logActivity(req, `article.${article.status}`, {
    entityType: 'Article',
    entityId: article._id,
    summary: `"${article.title}": ${prev} -> ${article.status}`,
  });
  await article.populate(POPULATE);
  res.json({ article });
});

export const deleteArticle = asyncHandler(async (req, res) => {
  const article = await Article.findById(req.params.id);
  if (!article) throw notFound('Article not found');
  assertCanEdit(req.user, article);
  const wasPublished = article.status === 'published';
  await article.deleteOne();
  if (wasPublished) await afterUnpublish(article.slug);
  // A translation without its original is kept, but no longer points at it.
  await Article.updateMany({ translationOf: article._id }, { $unset: { translationOf: 1 } });
  await logActivity(req, 'article.delete', { entityType: 'Article', entityId: article._id, summary: `Deleted "${article.title}"` });
  res.status(204).end();
});

export const stats = asyncHandler(async (req, res) => {
  const scope = isStaffEditor(req.user) ? {} : { author: req.user._id };
  const [byStatus, byOrigin] = await Promise.all([
    Article.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Article.aggregate([{ $match: scope }, { $group: { _id: '$origin', n: { $sum: 1 } } }]),
  ]);
  const s = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  const o = Object.fromEntries(byOrigin.map((r) => [r._id, r.n]));
  res.json({
    total: byStatus.reduce((sum, r) => sum + r.n, 0),
    published: s.published || 0,
    draft: s.draft || 0,
    scheduled: s.scheduled || 0,
    pendingApproval: s.pending_approval || 0,
    archived: s.archived || 0,
    aiGenerated: o.ai || 0,
    manual: o.manual || 0,
  });
});
