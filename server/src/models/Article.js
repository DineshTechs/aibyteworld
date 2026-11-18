import mongoose from 'mongoose';

export const ARTICLE_STATUSES = ['draft', 'pending_approval', 'scheduled', 'published', 'archived'];
export const ARTICLE_ORIGINS = ['manual', 'ai'];

const { ObjectId } = mongoose.Schema.Types;

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // created | updated | status:<from>-><to>
    by: { type: ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const articleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 140 },
    excerpt: { type: String, default: '', maxlength: 400 },
    excerptIsAuto: { type: Boolean, default: false }, // true when generated from the content
    content: { type: String, default: '' }, // sanitized HTML
    contentText: { type: String, default: '' }, // plain text for search
    featuredImage: {
      url: { type: String, default: '' },
      alt: { type: String, default: '', maxlength: 300 },
      width: { type: Number },
      height: { type: Number },
      credit: { type: String, default: '', maxlength: 1000 }, // sanitized HTML: "Photo by X on Unsplash"
      // Smaller WebP copies for fast pages: [{ width, url }]
      variants: { type: [{ _id: false, width: Number, url: String }], default: undefined },
    },
    // Language of the post. Translations point at the original article.
    language: { type: String, default: 'en', maxlength: 5 },
    translationOf: { type: ObjectId, ref: 'Article' },
    author: { type: ObjectId, ref: 'User', required: true, index: true },
    categories: [{ type: ObjectId, ref: 'Category' }],
    tags: [{ type: ObjectId, ref: 'Tag' }],
    status: { type: String, enum: ARTICLE_STATUSES, default: 'draft' },
    origin: { type: String, enum: ARTICLE_ORIGINS, default: 'manual', index: true },
    featured: { type: Boolean, default: false },
    seo: {
      title: { type: String, default: '', maxlength: 120 },
      description: { type: String, default: '', maxlength: 320 },
      focusKeyword: { type: String, default: '', maxlength: 120 },
      canonicalUrl: { type: String, default: '', maxlength: 500 },
      noindex: { type: Boolean, default: false },
      ogTitle: { type: String, default: '', maxlength: 120 },
      ogDescription: { type: String, default: '', maxlength: 300 },
      secondaryKeywords: { type: [String], default: [] },
      // Derived from the "Frequently asked questions" section on every save.
      faq: { type: [{ _id: false, question: String, answer: String }], default: [] },
    },
    // Filled by the AI research pipeline in Phase 2.
    sources: [{ type: ObjectId, ref: 'ResearchSource' }],
    publishedAt: { type: Date },
    scheduledAt: { type: Date },
    readingTime: { type: Number, default: 1 },
    views: { type: Number, default: 0 }, // unique daily visitors, counted by the analytics tracker
    reads: { type: Number, default: 0 }, // visitors who read the post through
    history: { type: [historySchema], default: [] },
    // Automatic sharing to social networks: one entry per channel, so a post is never shared twice.
    shares: { type: [{ _id: false, channel: String, at: Date, ok: Boolean, ref: String, error: String }], default: [] },
    // An updated version from a refresh job, waiting to be applied or discarded.
    refresh: { type: mongoose.Schema.Types.Mixed },
    refreshedAt: { type: Date }, // last time a refresh was applied ("Updated on")
  },
  { timestamps: true },
);

articleSchema.index({ status: 1, publishedAt: -1 });
articleSchema.index({ status: 1, scheduledAt: 1 });
articleSchema.index({ categories: 1, status: 1, publishedAt: -1 });
articleSchema.index({ tags: 1, status: 1, publishedAt: -1 });
articleSchema.index({ status: 1, views: -1 });
articleSchema.index({ status: 1, reads: -1 });
articleSchema.index({ translationOf: 1, language: 1 });
articleSchema.index(
  { title: 'text', excerpt: 'text', contentText: 'text' },
  // MongoDB would read a field named "language" as the search language and
  // refuse Hindi ("hi"), so the search index uses a field that is never set.
  { weights: { title: 10, excerpt: 4, contentText: 1 }, name: 'article_text', language_override: 'textSearchLanguage' },
);

export const Article = mongoose.model('Article', articleSchema);
