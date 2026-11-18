import crypto from 'node:crypto';
import mongoose from 'mongoose';

// Settings for getting more readers: auto-sharing, newsletter email, IndexNow,
// internal links, Hindi versions and post refreshes (one document).
// Secrets are encrypted with SECRETS_KEY and never returned by the API.
const secret = () => ({ iv: { type: String, select: false }, tag: { type: String, select: false }, data: { type: String, select: false } });
const status = { lastOkAt: Date, lastError: { type: String, default: '' } };

const growthSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'growth', unique: true },
    share: {
      telegram: { enabled: { type: Boolean, default: false }, channel: { type: String, default: '', maxlength: 100 }, ...status },
      x: {
        enabled: { type: Boolean, default: false },
        apiKey: secret(),
        apiSecret: secret(),
        accessToken: secret(),
        accessSecret: secret(),
        last4: { type: String, default: '' },
        ...status,
      },
      linkedin: {
        enabled: { type: Boolean, default: false },
        token: secret(),
        last4: { type: String, default: '' },
        author: { type: String, default: '', maxlength: 120 }, // urn:li:person:… or urn:li:organization:…
        version: { type: String, default: '', maxlength: 6 }, // LinkedIn-Version header, YYYYMM; empty = automatic
        ...status,
      },
      facebook: { enabled: { type: Boolean, default: false }, pageId: { type: String, default: '', maxlength: 40 }, token: secret(), last4: { type: String, default: '' }, ...status },
      hashtags: { type: Number, default: 3, min: 0, max: 5 },
      includeTranslations: { type: Boolean, default: false },
      lastSkipped: { type: String, default: '' },
    },
    newsletter: {
      provider: { type: String, enum: ['none', 'brevo', 'resend'], default: 'none' },
      apiKey: secret(),
      last4: { type: String, default: '' },
      fromEmail: { type: String, default: '', maxlength: 200 },
      fromName: { type: String, default: '', maxlength: 80 },
      replyTo: { type: String, default: '', maxlength: 200 },
      doubleOptIn: { type: Boolean, default: true },
      digest: {
        enabled: { type: Boolean, default: false },
        day: { type: Number, default: 0, min: 0, max: 6 }, // 0 = Sunday, in the Autopilot time zone
        time: { type: String, default: '10:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
        maxPosts: { type: Number, default: 6, min: 1, max: 12 },
        lastSentDay: { type: String, default: '' },
      },
      history: { type: [{ _id: false, at: Date, kind: String, subject: String, posts: Number, sent: Number, failed: Number, note: String }], default: [] },
      ...status,
    },
    indexnow: {
      enabled: { type: Boolean, default: true },
      key: { type: String, default: () => crypto.randomBytes(16).toString('hex') },
      lastPingAt: Date,
      lastResult: { type: String, default: '' },
    },
    links: {
      enabled: { type: Boolean, default: true }, // add links to related posts in new AI articles
      maxPerArticle: { type: Number, default: 3, min: 1, max: 8 },
      backfill: { type: Boolean, default: true }, // link older posts to a new post
    },
    translation: {
      hindi: { type: Boolean, default: true }, // translate new posts into Hindi automatically
      autoPublish: { type: Boolean, default: true }, // publish the Hindi version when the original is published and the checks pass
    },
    refresh: {
      perWeek: { type: Number, default: 1, min: 0, max: 7 },
      minAgeDays: { type: Number, default: 90, min: 30, max: 730 },
      lastStartedAt: Date,
      lastResult: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

growthSchema.statics.getSingleton = async function getSingleton() {
  return this.findOneAndUpdate({ key: 'growth' }, { $setOnInsert: { key: 'growth' } }, { new: true, upsert: true, setDefaultsOnInsert: true });
};

export const Growth = mongoose.model('Growth', growthSchema);
