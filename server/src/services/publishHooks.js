import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Article, Growth } from '../models/index.js';
import { pingIndexNow } from './growth/indexnow.js';
import { shareArticle } from './growth/share.js';
import { backfillLinksTo } from './seo/internalLinks.js';
import { queueTranslation } from './translate/translator.js';
import { alertSystem } from './telegram/alert.js';

// Work that follows publishing: tell search engines (IndexNow), link older
// posts to the new one, share it, and start its Hindi version. It runs in the
// background so saving a post never waits for other websites. In tests the
// returned promise can be awaited.
const pending = new Set();

function run(name, fn) {
  const p = (async () => {
    try {
      await fn();
    } catch (err) {
      logger.warn({ hook: name, err: err.message }, 'After-publish task failed');
      await alertSystem(`hook-${name}`, `After publishing, the "${name}" task failed: ${err.message}`, { icon: '⚠️' });
    }
  })();
  pending.add(p);
  p.finally(() => pending.delete(p));
  return env.isTest ? p : undefined;
}

export const settleHooks = () => Promise.all([...pending]);

export function afterPublish(articleId) {
  return run('publish', async () => {
    const article = await Article.findById(articleId).select('slug status translationOf language').lean();
    if (!article || article.status !== 'published') return;
    const linked = await backfillLinksTo(article._id).catch((err) => {
      logger.warn({ err: err.message }, 'Automatic internal links failed');
      return [];
    });
    await pingIndexNow([`/blog/${article.slug}`, ...linked.map((a) => `/blog/${a.slug}`)]);
    await shareArticle(article._id);
    const growth = await Growth.getSingleton();
    if (!article.translationOf && growth.translation.hindi) await queueTranslation(article._id, { auto: true });
  });
}

export function afterUpdate(articleId) {
  return run('update', async () => {
    const article = await Article.findById(articleId).select('slug status').lean();
    if (article?.status === 'published') await pingIndexNow([`/blog/${article.slug}`]);
  });
}

// A post that is no longer public: search engines are told to check (and drop) the address.
export function afterUnpublish(slug) {
  return run('unpublish', () => pingIndexNow([`/blog/${slug}`], { force: true }));
}
