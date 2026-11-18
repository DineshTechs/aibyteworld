import mongoose from 'mongoose';

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 200 },
    // pending: waiting for the person to click the link in the confirmation email.
    status: { type: String, enum: ['pending', 'subscribed', 'unsubscribed'], default: 'subscribed' },
    source: { type: String, default: 'website' },
    confirmHash: { type: String, select: false }, // SHA-256 of the confirmation token
    confirmExpires: { type: Date, select: false },
    confirmSentAt: { type: Date },
    confirmedAt: { type: Date },
    unsubscribedAt: { type: Date },
    lastSentAt: { type: Date },
  },
  { timestamps: true },
);

export const NewsletterSubscriber = mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);
