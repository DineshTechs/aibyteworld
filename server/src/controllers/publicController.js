import mongoose from 'mongoose';
import { z } from 'zod';
import { Article, Category, SiteSettings, Tag, User } from '../models/index.js';
import { recordEvent, topArticleIds } from '../services/analyticsService.js';
import { asyncHandler, notFound, paged, parsePaging } from '../utils/http.js';

const CARD_FIELDS = 'title slug excerpt featuredImage author categories tags publishedAt readingTime views reads featured language refreshedAt';
const POPULATE = [
  { path: 'author', select: 'name avatarUrl' },
  { path: 'categories', select: 'name slug' },
  { path: 'tags', select: 'name slug' },
];

// Only published articles whose publish time has passed are ever public.
const visible = () => ({ status: 'published', publishedAt: { $lte: new Date() } });
// Lists show one language at a time: originals by default, or e.g. ?lang=hi.
const LIST_LANGS = ['hi'];
const inLanguage = (lang) => (LIST_LANGS.includes(lang) ? { language: lang } : { translationOf: null });
const listed = (lang) => ({ ...visible(), ...inLanguage(lang) });

const cards = (filter, sort, limit, skip = 0) =>
  Article.find(filter).select(CARD_FIELDS).sort(sort).skip(skip).limit(limit).populate(POPULATE).lean();

// Most viewed or most read posts of the last `days` days, then all-time
// leaders, so the lists fill up even while there is little recent traffic.
// Posts nobody has opened yet never appear.
async function ranked({ by, days, limit, exclude = [] }) {
  const ids = await topArticleIds({ days, by, limit, exclude });
  const recent = ids.length ? await cards({ ...listed(), _id: { $in: ids } }, {}, limit * 3) : [];
  const order = new Map(ids.map((id, i) => [String(id), i]));
  const out = recent.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id))).slice(0, limit);
  if (out.length < limit) {
    const skip = [...exclude, ...out.map((a) => a._id)];
    out.push(...(await cards({ ...listed(), _id: { $nin: skip }, [by]: { $gt: 0 } }, { [by]: -1, views: -1, publishedAt: -1 }, limit - out.length)));
  }
  return out;
}

async function tagsWithCounts(sinceDays) {
  const match = listed();
  if (sinceDays) match.publishedAt.$gte = new Date(Date.now() - sinceDays * 86400000);
  const rows = await Article.aggregate([
    { $match: match },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', articleCount: { $sum: 1 } } },
    { $sort: { articleCount: -1 } },
    { $limit: 100 },
    { $lookup: { from: Tag.collection.name, localField: '_id', foreignField: '_id', as: 'tag' } },
    { $unwind: '$tag' },
    { $project: { _id: '$tag._id', name: '$tag.name', slug: '$tag.slug', articleCount: 1 } },
  ]);
  return rows;
}

async function categoriesWithCounts() {
  const [docs, counts] = await Promise.all([
    Category.find().sort({ name: 1 }).lean(),
    Article.aggregate([{ $match: listed() }, { $unwind: '$categories' }, { $group: { _id: '$categories', n: { $sum: 1 } } }]),
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  return docs.map((d) => ({ ...d, articleCount: map.get(String(d._id)) || 0 }));
}

export const settings = asyncHandler(async (_req, res) => {
  const s = await SiteSettings.getSingleton();
  const languages = (await Promise.all(LIST_LANGS.map(async (l) => ((await Article.exists({ ...visible(), language: l })) ? l : null)))).filter(Boolean);
  res.json({
    settings: {
      siteName: s.siteName,
      tagline: s.tagline,
      description: s.description,
      siteUrl: s.siteUrl,
      contactEmail: s.contactEmail,
      contactAddress: s.contactAddress,
      social: s.social,
      pages: s.pages,
      postsPerPage: s.postsPerPage,
      allowIndexing: s.allowIndexing,
      analytics: {
        enabled: s.analytics?.enabled !== false,
        gaMeasurementId: s.analytics?.gaMeasurementId || '',
        gtmContainerId: s.analytics?.gtmContainerId || '',
        consentBanner: s.analytics?.consentBanner !== false,
      },
      languages, // other languages that have published posts
    },
  });
});

export const home = asyncHandler(async (_req, res) => {
  const base = listed();
  const [featured, latest, mostRead, mostViewed, trending, categories] = await Promise.all([
    cards({ ...base, featured: true }, { publishedAt: -1 }, 4),
    cards(base, { publishedAt: -1 }, 9),
    ranked({ by: 'reads', days: 30, limit: 4 }), // read through most this month
    ranked({ by: 'views', days: 7, limit: 5 }), // opened most this week
    tagsWithCounts(30),
    categoriesWithCounts(),
  ]);
  const popular = mostViewed;
  const trendingTags = trending.length ? trending.slice(0, 12) : (await tagsWithCounts()).slice(0, 12);
  const top = categories.filter((c) => c.articleCount > 0).sort((a, b) => b.articleCount - a.articleCount).slice(0, 3);
  const categorySections = await Promise.all(
    top.map(async (category) => ({
      category,
      articles: await cards({ ...base, categories: category._id }, { publishedAt: -1 }, 3),
    })),
  );
  res.json({ featured, latest, mostRead, mostViewed, popular, trendingTags, categorySections });
});

export const listArticles = asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query, { defaultLimit: 9, maxLimit: 30 });
  const filter = listed(String(req.query.lang || ''));
  let context = {};

  if (req.query.category) {
    const category = await Category.findOne({ slug: String(req.query.category) }).lean();
    if (!category) throw notFound('Category not found');
    filter.categories = category._id;
    context = { category };
  }
  if (req.query.tag) {
    const tag = await Tag.findOne({ slug: String(req.query.tag) }).lean();
    if (!tag) throw notFound('Tag not found');
    filter.tags = tag._id;
    context = { ...context, tag };
  }
  if (req.query.author) {
    if (!mongoose.isValidObjectId(req.query.author)) throw notFound('Author not found');
    filter.author = req.query.author;
  }

  const q = String(req.query.q || '').trim().slice(0, 100);
  const SORTS = { popular: { views: -1, publishedAt: -1 }, 'most-read': { reads: -1, views: -1, publishedAt: -1 } };
  let sort = SORTS[req.query.sort] || { publishedAt: -1 };
  let query = Article.find(filter);
  if (q) {
    filter.$text = { $search: q };
    query = Article.find(filter, { score: { $meta: 'textScore' } });
    sort = { score: { $meta: 'textScore' }, publishedAt: -1 };
  }

  const [items, total] = await Promise.all([
    query.select(CARD_FIELDS).sort(sort).skip(paging.skip).limit(paging.limit).populate(POPULATE).lean(),
    Article.countDocuments(filter),
  ]);
  res.json({ ...paged(items, total, paging), ...context });
});

export const getArticle = asyncHandler(async (req, res) => {
  // Views are counted by the analytics tracker (POST /public/track), not here,
  // so bots, previews and repeat visits do not inflate them.
  const article = await Article.findOne({ ...visible(), slug: String(req.params.slug).toLowerCase() })
    .select('-contentText -history -sources -refresh -shares')
    .populate([{ path: 'author', select: 'name avatarUrl bio' }, POPULATE[1], POPULATE[2]])
    .lean();
  if (!article) throw notFound('Article not found');

  const base = article.translationOf ? { ...visible(), language: article.language } : listed();
  const relatedFilter = { ...base, _id: { $ne: article._id } };
  const catIds = article.categories.map((c) => c._id);
  const tagIds = article.tags.map((t) => t._id);
  if (catIds.length || tagIds.length) relatedFilter.$or = [{ categories: { $in: catIds } }, { tags: { $in: tagIds } }];

  const originalId = article.translationOf || article._id;
  const [related, popular, previous, next, translations] = await Promise.all([
    cards(relatedFilter, { publishedAt: -1 }, 3),
    ranked({ by: 'reads', days: 30, limit: 4, exclude: [article._id, originalId] }),
    Article.findOne({ ...base, publishedAt: { $lt: article.publishedAt } }).sort({ publishedAt: -1 }).select('title slug').lean(),
    Article.findOne({ ...base, publishedAt: { $gt: article.publishedAt, $lte: new Date() } }).sort({ publishedAt: 1 }).select('title slug').lean(),
    // The same post in other languages (published only).
    Article.find({ ...visible(), $or: [{ _id: originalId }, { translationOf: originalId }], _id: { $ne: article._id } }).select('title slug language').lean(),
  ]);
  res.json({ article, related, popular, previous, next, translations: translations.map((t) => ({ ...t, language: t.language || 'en' })) });
});

export const listCategories = asyncHandler(async (_req, res) => {
  res.json({ items: await categoriesWithCounts() });
});

export const listTags = asyncHandler(async (_req, res) => {
  res.json({ items: await tagsWithCounts() });
});

export const getAuthor = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Author not found');
  const user = await User.findOne({ _id: req.params.id, active: true });
  if (!user) throw notFound('Author not found');
  const articleCount = await Article.countDocuments({ ...visible(), author: user._id });
  res.json({ author: { ...user.toPublic(), articleCount } });
});

// ---------- Analytics events from visitors' browsers ----------
export const trackSchema = z.object({
  articleId: z.string().regex(/^[a-f0-9]{24}$/i),
  type: z.enum(['view', 'read', 'time']),
  seconds: z.number().min(0).max(86400).optional(),
  referrer: z.string().max(500).optional(),
});

export const track = asyncHandler(async (req, res) => {
  await recordEvent(req, req.body);
  res.status(204).end();
});
