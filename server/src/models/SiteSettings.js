import mongoose from 'mongoose';

// Single-document collection (key: "site").
const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'site', unique: true },
    siteName: { type: String, default: 'My Blog', maxlength: 80 },
    tagline: { type: String, default: '', maxlength: 200 },
    description: { type: String, default: '', maxlength: 400 },
    siteUrl: { type: String, default: '', maxlength: 300 },
    contactEmail: { type: String, default: '', maxlength: 200 },
    contactAddress: { type: String, default: '', maxlength: 400 },
    social: {
      twitter: { type: String, default: '' },
      facebook: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      instagram: { type: String, default: '' },
    },
    // Sanitized HTML for the static pages.
    pages: {
      about: { type: String, default: '' },
      privacy: { type: String, default: '' },
      terms: { type: String, default: '' },
    },
    postsPerPage: { type: Number, default: 9, min: 3, max: 30 },
    allowIndexing: { type: Boolean, default: true },
    // Visitor analytics and search engine verification.
    analytics: {
      enabled: { type: Boolean, default: true }, // built-in, cookie-free view and read counts
      gaMeasurementId: { type: String, default: '', maxlength: 30 }, // Google Analytics 4, e.g. G-ABC123XYZ
      consentBanner: { type: Boolean, default: true }, // ask visitors before loading Google Analytics
      googleVerification: { type: String, default: '', maxlength: 120 }, // Search Console HTML tag
      bingVerification: { type: String, default: '', maxlength: 120 }, // Bing Webmaster Tools
    },
    // AI Content Studio defaults and limits (Phase 2).
    ai: {
      maxResearchQuestions: { type: Number, default: 5, min: 1, max: 10 },
      maxSources: { type: Number, default: 15, min: 3, max: 40 },
      defaultLength: { type: Number, default: 1500, min: 300, max: 5000 },
      defaultStyle: { type: String, default: 'Professional and informative', maxlength: 120 },
      defaultLanguage: { type: String, default: 'English', maxlength: 60 },
      defaultCountry: { type: String, default: '', maxlength: 80 },
      dailyJobLimit: { type: Number, default: 10, min: 1, max: 200 },
      outdatedAfterMonths: { type: Number, default: 24, min: 1, max: 120 },
      // What a finished AI article becomes. Phase 2 never publishes automatically.
      resultStatus: { type: String, enum: ['draft', 'pending_approval'], default: 'pending_approval' },
      // Providers tried in order. When one runs out of quota or fails, the next takes over.
      researchProviders: { type: [String], default: () => ['gemini', 'openai', 'anthropic', 'tavily'] },
      writerProviders: { type: [String], default: () => ['gemini', 'openai', 'anthropic', 'nous', 'groq', 'cerebras', 'mistral', 'openrouter', 'ollama'] },
      // Free photo libraries for post images, tried in order (see orderMode).
      imageProviders: { type: [String], default: () => ['openverse', 'unsplash', 'pexels', 'wikimedia', 'pixabay', 'nasa'] },
      // quality: always start with the best-quality ready provider (default).
      // custom: use the lists exactly in the order above.
      orderMode: { type: String, enum: ['quality', 'custom'], default: 'quality' },
      imagesEnabled: { type: Boolean, default: true },
      inlineImages: { type: Number, default: 2, min: 0, max: 4 }, // pictures inside the article, besides the cover
      // Which providers the lists have been offered; used to add new providers once.
      knownProviders: { type: [String], default: () => [] },
    },
    // Autopilot: writes posts on trending topics on a daily schedule.
    autopilot: {
      enabled: { type: Boolean, default: false },
      postsPerDay: { type: Number, default: 4, min: 1, max: 12 },
      startTime: { type: String, default: '06:00' }, // first post of the day, HH:MM local time
      timezone: { type: String, default: 'Asia/Kolkata' },
      niche: { type: String, default: 'Technology & AI', maxlength: 120 },
      keywords: { type: [String], default: () => ['artificial intelligence', 'AI tools', 'technology', 'software', 'gadgets'] },
      country: { type: String, default: '', maxlength: 80 }, // empty = worldwide
      language: { type: String, default: 'English', maxlength: 60 },
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
      length: { type: Number, default: 1200, min: 600, max: 4000 },
      style: { type: String, default: 'Conversational, clear and practical', maxlength: 120 },
      publishMode: { type: String, enum: ['auto_if_checks_pass', 'approval'], default: 'auto_if_checks_pass' },
      minSources: { type: Number, default: 3, min: 1, max: 20 },
      minCitedFindings: { type: Number, default: 5, min: 1, max: 40 },
      requireImage: { type: Boolean, default: true }, // hold posts without a cover image
      // Evergreen guides ("how to", "best X for Y") keep bringing search visitors for
      // months; this many of the daily posts are evergreen instead of trending news.
      evergreenPerDay: { type: Number, default: 2, min: 0, max: 12 },
      evergreenTopics: { type: [String], default: () => [] }, // the admin's own topic ideas, used first
      runAs: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      nextRunAt: { type: Date },
      lastRunAt: { type: Date },
      lastResult: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

siteSettingsSchema.statics.getSingleton = async function getSingleton() {
  return this.findOneAndUpdate(
    { key: 'site' },
    { $setOnInsert: { key: 'site' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

export const SiteSettings = mongoose.model('SiteSettings', siteSettingsSchema);
