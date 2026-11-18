import { logger } from '../config/logger.js';
import { Article } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { afterPublish } from '../services/publishHooks.js';

// Publishes scheduled articles whose time has come. Each article is claimed with
// one atomic findOneAndUpdate, so an article can never be published twice even
// if two ticks (or two server processes) overlap.
export async function publishDueArticles(now = new Date()) {
  let published = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const article = await Article.findOneAndUpdate(
      { status: 'scheduled', scheduledAt: { $lte: now } },
      {
        $set: { status: 'published', publishedAt: now },
        $unset: { scheduledAt: 1 },
        $push: { history: { action: 'status:scheduled->published', at: now, note: 'Published by scheduler' } },
      },
      { new: true },
    );
    if (!article) break;
    published += 1;
    // eslint-disable-next-line no-await-in-loop
    await logActivity(null, 'article.published', {
      entityType: 'Article',
      entityId: article._id,
      summary: `Scheduled article published: ${article.title}`,
    });
    // eslint-disable-next-line no-await-in-loop
    await afterPublish(article._id);
  }
  return published;
}

export function startPublishScheduler(intervalMs = 30000) {
  const tick = async () => {
    try {
      const n = await publishDueArticles();
      if (n) logger.info({ published: n }, 'Scheduler published articles');
    } catch (err) {
      logger.error({ err }, 'Publish scheduler tick failed');
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
