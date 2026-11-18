import mongoose from 'mongoose';

// Built-in, cookie-free analytics. Only daily totals are stored: no IP
// addresses, no cookies and no per-person history.

// Daily totals per article.
const articleStatSchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
    views: { type: Number, default: 0 }, // unique visitors who opened the post that day
    reads: { type: Number, default: 0 }, // visitors who actually read it (scrolled through and stayed)
    readSeconds: { type: Number, default: 0 }, // total active reading time
    timed: { type: Number, default: 0 }, // visits with a reading time, for the average
  },
  { versionKey: false },
);
articleStatSchema.index({ day: 1, article: 1 }, { unique: true });
articleStatSchema.index({ article: 1, day: 1 });
export const ArticleStat = mongoose.model('ArticleStat', articleStatSchema);

// Daily views per referring website ("(direct)" when there is none).
const referrerStatSchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    host: { type: String, required: true, maxlength: 200 },
    views: { type: Number, default: 0 },
  },
  { versionKey: false },
);
referrerStatSchema.index({ day: 1, host: 1 }, { unique: true });
export const ReferrerStat = mongoose.model('ReferrerStat', referrerStatSchema);

// Short-lived marks so one visitor counts once per post per day. The key is a
// keyed hash of (IP, browser, day) that changes daily and cannot be reversed;
// marks are deleted automatically after two days.
const visitorMarkSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    at: { type: Date, default: Date.now, expires: 60 * 60 * 48 },
  },
  { versionKey: false },
);
export const VisitorMark = mongoose.model('VisitorMark', visitorMarkSchema);
