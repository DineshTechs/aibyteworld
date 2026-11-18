import { logger } from '../config/logger.js';
import { DEFAULT_IMAGE_ORDER, DEFAULT_RESEARCH_ORDER, DEFAULT_WRITER_ORDER, PROVIDER_INFO } from '../integrations/ai/index.js';
import { Article, SiteSettings } from '../models/index.js';

// Safe, repeatable data updates run at server start.
//
// 1. AI provider lists: providers added in a new version are appended to the
//    research/writing fallback lists once (before Ollama, which stays last).
//    Providers the admin removed are not added back.
// 0. Article search index: older versions let MongoDB read the post's
//    "language" field as its search language, which refuses Hindi posts.
//    The index is rebuilt once with a separate setting.
export async function fixArticleTextIndex() {
  const indexes = await Article.collection.indexes().catch(() => []);
  const current = indexes.find((i) => i.name === 'article_text');
  if (current?.language_override === 'textSearchLanguage') return false;
  if (current) {
    await Article.collection.dropIndex('article_text');
    logger.info('Rebuilt the article search index so Hindi posts can be saved');
  }
  await Article.createIndexes();
  return true;
}

export async function runMigrations() {
  await fixArticleTextIndex();
  const s = await SiteSettings.getSingleton();
  const ai = s.ai;
  // Image sources that no longer exist (AI image generation was removed) leave the list.
  const validImages = (ai.imageProviders || []).filter((k) => PROVIDER_INFO[k]?.kind === 'image');
  if (validImages.length !== (ai.imageProviders || []).length) {
    ai.imageProviders = validImages.length ? validImages : [...DEFAULT_IMAGE_ORDER];
    s.markModified('ai');
    await s.save();
  }
  const known = new Set(ai.knownProviders || []);
  const allKeys = Object.keys(PROVIDER_INFO);
  const fresh = allKeys.filter((k) => !known.has(k));
  if (!fresh.length) return;
  // First run of this migration: only the providers introduced with it are new;
  // anything else missing from the lists was removed by the admin on purpose.
  const firstRun = known.size === 0;
  const introducedNow = ['tavily', 'groq', 'cerebras', 'mistral', 'openrouter'];
  const add = (list, defaults) => {
    const out = [...list];
    for (const k of defaults) {
      if (out.includes(k)) continue;
      if (firstRun ? !introducedNow.includes(k) : !fresh.includes(k)) continue;
      const ollama = out.indexOf('ollama');
      if (k !== 'ollama' && ollama >= 0) out.splice(ollama, 0, k);
      else out.push(k);
    }
    return out;
  };
  ai.researchProviders = add(ai.researchProviders || [], DEFAULT_RESEARCH_ORDER);
  ai.writerProviders = add(ai.writerProviders || [], DEFAULT_WRITER_ORDER);
  // Image sources: new ones join the end of the image list.
  const images = [...(ai.imageProviders || [])];
  // Openverse (no key) goes first; other new sources join the end.
  for (const k of DEFAULT_IMAGE_ORDER) if (fresh.includes(k) && !images.includes(k) && !firstRun) (k === 'openverse' ? images.unshift(k) : images.push(k));
  ai.imageProviders = images.length || firstRun ? images : [...DEFAULT_IMAGE_ORDER];
  ai.knownProviders = allKeys;
  s.markModified('ai');
  await s.save();
  logger.info({ added: fresh }, 'AI provider lists updated with new providers');
}
