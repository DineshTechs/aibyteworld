import { AiError } from '../../integrations/ai/errors.js';
import { Article, SiteSettings } from '../../models/index.js';
import { makeSlug, plainText, sanitizeArticleHtml } from '../../utils/content.js';
import { logActivity } from '../activityService.js';
import { providerChain } from '../ai/providerService.js';
import { publicBase } from '../growth/common.js';
import { spinCoverPhoto } from './imageService.js';

// "Spin" for cover photos, shared by the post editor and Telegram.

export class SpinError extends Error {}

/** Finds a new cover photo (saved to the media library) for a title and keyword. */
export async function findNewCover({ title, keyword = '', turn = 0, uploadedBy }) {
  const site = await SiteSettings.getSingleton();
  if (!site.ai?.imagesEnabled) throw new SpinError('Photos are turned off in AI Providers.');
  const { chain, skipped } = await providerChain(site.ai, 'image');
  if (!chain.length) throw new SpinError(`No photo library is set up. ${skipped.slice(0, 2).join('; ') || 'Add a free Unsplash, Pexels or Pixabay key in AI Providers.'}`);
  try {
    return await spinCoverPhoto({
      chain,
      title,
      keyword,
      turn,
      appName: makeSlug(site.siteName || 'blog') || 'blog',
      contact: publicBase(site.siteUrl) || site.contactEmail || '',
      uploadedBy,
    });
  } catch (err) {
    if (err instanceof AiError) throw new SpinError(err.message.slice(0, 500));
    throw err;
  }
}

/**
 * Replaces a post's cover photo with a new one and saves the post (used from
 * Telegram, where there is no separate Save step). Returns the updated post.
 */
export async function replaceArticleCover(articleId, user, { turn = 0, via = 'Telegram' } = {}) {
  const article = await Article.findById(articleId);
  if (!article) throw new SpinError('That post no longer exists.');
  const photo = await findNewCover({ title: article.title, keyword: article.seo?.focusKeyword || '', turn, uploadedBy: user._id });
  const featuredImage = {
    url: photo.url,
    alt: plainText(photo.alt).slice(0, 300),
    ...(photo.width ? { width: photo.width, height: photo.height } : {}),
    credit: sanitizeArticleHtml(photo.credit || ''),
    ...(photo.variants?.length ? { variants: photo.variants } : {}),
  };
  await Article.updateOne(
    { _id: article._id },
    {
      $set: { featuredImage },
      $push: { history: { action: 'cover:spin', by: user._id, at: new Date(), note: `New cover photo from ${via} (${photo.provider}, search: ${photo.query})` } },
    },
  );
  await logActivity({ user }, 'article.cover', { entityType: 'Article', entityId: article._id, summary: `"${article.title}": new cover photo from ${via}` });
  return { article: await Article.findById(article._id), photo };
}
