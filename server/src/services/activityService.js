import { logger } from '../config/logger.js';
import { ActivityLog } from '../models/index.js';

// Audit trail. Failures here must never break the request that triggered them.
export async function logActivity(req, action, { entityType = '', entityId = '', summary = '', meta } = {}) {
  try {
    await ActivityLog.create({
      actor: req?.user?._id,
      actorName: req?.user?.name || 'system',
      action,
      entityType,
      entityId: entityId ? String(entityId) : '',
      summary,
      meta,
      ip: req?.ip || '',
    });
  } catch (err) {
    logger.warn({ err, action }, 'Failed to write activity log');
  }
}
