import { logger } from '../config/logger.js';
import { digestTick } from '../services/newsletter/newsletterService.js';
import { afterPublish, afterUpdate } from '../services/publishHooks.js';
import { refreshTick } from '../services/refresh/refreshService.js';
import { notifyReview } from '../services/telegram/bot.js';
import { processTranslationOnce } from '../services/translate/translator.js';

// Background work for growth features: translations (one at a time), the
// weekly newsletter digest and weekly post refreshes.
let translating = false;

export async function translateNext() {
  if (translating) return false;
  translating = true;
  try {
    return await processTranslationOnce({ afterPublish, afterUpdate, notifyReview });
  } finally {
    translating = false;
  }
}

export function startGrowthScheduler() {
  const t1 = setInterval(() => translateNext().catch((err) => logger.error({ err }, 'Translation runner failed')), 10000);
  const t2 = setInterval(() => {
    digestTick().catch((err) => logger.error({ err }, 'Newsletter digest failed'));
    refreshTick().catch((err) => logger.error({ err }, 'Refresh scheduler failed'));
  }, 60000);
  t1.unref();
  t2.unref();
  return () => {
    clearInterval(t1);
    clearInterval(t2);
  };
}
