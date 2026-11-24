import mongoose from 'mongoose';

// Telegram bot settings (one document). The bot token is encrypted with
// SECRETS_KEY and never returned by the API.
const chatSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true }, // where messages are sent
    fromId: { type: String, required: true }, // the Telegram account allowed to press buttons
    title: { type: String, default: '', maxlength: 120 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // admin who linked it; actions are logged as this user
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const telegramSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'telegram', unique: true },
    enabled: { type: Boolean, default: false },
    token: { iv: { type: String, select: false }, tag: { type: String, select: false }, data: { type: String, select: false } },
    tokenLast4: { type: String, default: '' },
    botUsername: { type: String, default: '' },
    chats: { type: [chatSchema], default: [] },
    // One-time code for linking a chat (/start CODE), valid for 15 minutes.
    linkCode: { code: String, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, expiresAt: Date },
    notify: {
      held: { type: Boolean, default: true }, // Autopilot post waiting for approval
      review: { type: Boolean, default: true }, // AI Studio article ready for review
      submitted: { type: Boolean, default: true }, // an author submitted a post for approval
      published: { type: Boolean, default: true }, // Autopilot published a post
      failed: { type: Boolean, default: true }, // an AI job failed or Autopilot skipped a slot
      started: { type: Boolean, default: true }, // an AI article started (or resumed)
      problems: { type: Boolean, default: true }, // provider switches or missing photos while writing
      system: { type: Boolean, default: true }, // site restarts and background task errors
      dailySummary: { type: Boolean, default: true },
    },
    summaryTime: { type: String, default: '21:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // in the Autopilot time zone
    lastSummaryDay: { type: String, default: '' },
    updateOffset: { type: Number, default: 0 },
    lastPollAt: Date,
    lastError: { type: String, default: '' },
  },
  { timestamps: true },
);

telegramSchema.statics.getSingleton = async function getSingleton() {
  return (await this.findOne({ key: 'telegram' })) || this.create({ key: 'telegram' });
};

export const TelegramBot = mongoose.model('TelegramBot', telegramSchema);
