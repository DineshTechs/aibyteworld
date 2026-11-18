import { Article, Growth } from '../../models/index.js';
import { escapeRegex } from '../../utils/http.js';
import { sanitizeArticleHtml } from '../../utils/content.js';

// Automatic internal links: a phrase in one post that names another post's
// main keyword becomes a link to it. Links help readers find related posts and
// help search engines understand the site. Only exact phrases are linked, at
// most once per target, never inside headings, captions or existing links.

const visible = () => ({ status: 'published', publishedAt: { $lte: new Date() } });

// Phrases worth linking: the focus keyword and secondary keywords of two or more words.
export function phrasesFor(article) {
  const list = [article.seo?.focusKeyword, ...(article.seo?.secondaryKeywords || [])]
    .map((p) => String(p || '').trim().replace(/\s+/g, ' '))
    .filter((p) => p.split(' ').length >= 2 && p.length >= 8 && p.length <= 80);
  return [...new Set(list.map((p) => p.toLowerCase()))].map((l) => list.find((p) => p.toLowerCase() === l));
}

const linkedSlugs = (html) => new Set([...String(html).matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]));
export const countInternalLinks = (html) => (String(html).match(/href="\/blog\//g) || []).length;

// Links the first plain-text occurrence of a phrase inside a paragraph or list item.
function linkFirst(html, phrase, href) {
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(${escapeRegex(phrase)})(?![\\p{L}\\p{M}\\p{N}])`, 'iu');
  const blocks = /<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = blocks.exec(html))) {
    const block = m[0];
    // Walk text pieces between tags, skipping anything inside a link.
    let depth = 0;
    let out = null;
    const parts = block.split(/(<[^>]+>)/);
    for (let i = 0; i < parts.length && out === null; i += 1) {
      const part = parts[i];
      if (part.startsWith('<')) {
        if (/^<a\b/i.test(part)) depth += 1;
        else if (/^<\/a>/i.test(part)) depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth || !re.test(part)) continue;
      parts[i] = part.replace(re, `<a href="${href}">$1</a>`);
      out = parts.join('');
    }
    if (out !== null) return html.slice(0, m.index) + out + html.slice(m.index + block.length);
  }
  return null;
}

/** Adds up to `max` links to related posts in `html`. Returns { html, added: [{ slug, phrase }] }. */
export function addLinks(html, targets, max) {
  let out = String(html || '');
  const already = linkedSlugs(out);
  const added = [];
  for (const t of targets) {
    if (added.length >= max) break;
    if (already.has(t.slug)) continue;
    for (const phrase of t.phrases) {
      const next = linkFirst(out, phrase, `/blog/${t.slug}`);
      if (next) {
        out = next;
        already.add(t.slug);
        added.push({ slug: t.slug, phrase });
        break;
      }
    }
  }
  return { html: out, added };
}

// Published posts in the same language, most related first (shared category and tags).
async function relatedTargets({ excludeIds, language, categories = [], tags = [], limit = 60 }) {
  const docs = await Article.find({ ...visible(), _id: { $nin: excludeIds }, ...(language === 'en' ? { translationOf: null } : { language }) })
    .select('slug seo.focusKeyword seo.secondaryKeywords categories tags publishedAt')
    .sort({ publishedAt: -1 })
    .limit(300)
    .lean();
  const cat = new Set(categories.map(String));
  const tag = new Set(tags.map(String));
  return docs
    .map((d) => ({ slug: d.slug, phrases: phrasesFor(d), score: (d.categories || []).filter((c) => cat.has(String(c))).length * 2 + (d.tags || []).filter((x) => tag.has(String(x))).length }))
    .filter((d) => d.phrases.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Links a new post's content to older related posts (used before saving AI articles). */
export async function linkNewContent(html, { excludeIds = [], language = 'en', categories = [], tags = [] } = {}) {
  const growth = await Growth.getSingleton();
  if (!growth.links.enabled) return { html, added: [] };
  const room = growth.links.maxPerArticle - countInternalLinks(html);
  if (room <= 0) return { html, added: [] };
  const targets = await relatedTargets({ excludeIds, language, categories, tags });
  return addLinks(html, targets, room);
}

/**
 * After a post is published, older posts that mention its keyword get one link
 * to it (at most 3 older posts, and only posts with fewer than 8 internal links).
 */
export async function backfillLinksTo(articleId) {
  const growth = await Growth.getSingleton();
  if (!growth.links.enabled || !growth.links.backfill) return [];
  const target = await Article.findById(articleId).lean();
  if (!target || target.status !== 'published') return [];
  const phrases = phrasesFor(target);
  if (!phrases.length) return [];
  const language = target.translationOf ? target.language : 'en';
  const candidates = await Article.find({
    ...visible(),
    _id: { $ne: target._id },
    ...(language === 'en' ? { translationOf: null } : { language }),
    publishedAt: { $lt: target.publishedAt || new Date() },
    $or: phrases.map((p) => ({ contentText: { $regex: escapeRegex(p), $options: 'i' } })),
  })
    .sort({ publishedAt: -1 })
    .limit(20);
  const changed = [];
  for (const a of candidates) {
    if (changed.length >= 3) break;
    if (countInternalLinks(a.content) >= 8) continue;
    const { html, added } = addLinks(a.content, [{ slug: target.slug, phrases }], 1);
    if (!added.length) continue;
    // Write only if nobody changed the post in the meantime.
    // eslint-disable-next-line no-await-in-loop
    const res = await Article.updateOne(
      { _id: a._id, updatedAt: a.updatedAt },
      { $set: { content: sanitizeArticleHtml(html) }, $push: { history: { action: 'updated', at: new Date(), note: `Link to "${target.title}" added automatically` } } },
    );
    if (res.modifiedCount === 1) changed.push({ id: a._id, slug: a.slug, phrase: added[0].phrase });
  }
  return changed;
}
