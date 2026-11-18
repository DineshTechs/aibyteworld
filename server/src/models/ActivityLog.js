import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: 'system' },
    action: { type: String, required: true, index: true }, // e.g. article.publish
    entityType: { type: String, default: '' },
    entityId: { type: String, default: '' },
    summary: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activityLogSchema.index({ createdAt: -1 });

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
