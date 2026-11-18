import mongoose from 'mongoose';

// A request to translate an article (Hindi for now). The runner processes one
// at a time; the result is a separate article linked to the original.
const translationSchema = new mongoose.Schema(
  {
    source: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true, index: true },
    lang: { type: String, enum: ['hi'], default: 'hi' },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    auto: { type: Boolean, default: false }, // started automatically after publishing
    article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article' },
    provider: { type: String, default: '' },
    warnings: [{ type: String }],
    error: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    lockedAt: Date,
    startedAt: Date,
    finishedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
translationSchema.index({ status: 1, createdAt: 1 });

export const Translation = mongoose.model('Translation', translationSchema);
