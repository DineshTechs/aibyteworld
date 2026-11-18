import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getAdapter } from '../../integrations/ai/index.js';
import { AiError } from '../../integrations/ai/errors.js';
import { MAX_IMAGE_BYTES, imageSize, sniffImageType } from '../../integrations/images/common.js';
import { Media } from '../../models/index.js';
import { htmlToText, plainText, sanitizeArticleHtml } from '../../utils/content.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { imageBriefPrompt } from '../ai/prompts.js';
import { runWithFailover } from '../ai/routing.js';
import { makeVariants, remoteVariants, srcsetOf } from './optimize.js';

// Adds a cover photo and a few in-article photos to an AI article, taken from
// free photo libraries (Openverse, Unsplash, Pexels, Wikimedia Commons,
// Pixabay, NASA). Images are never generated.
// Libraries are tried best first with the same failover and cooldowns as text
// providers. A missing photo never fails the article: it is noted as a warning.

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SKIP_HEADING = /frequently asked|faq|^sources$|references|further reading/i;

async function downloadImage(url, { userAgent } = {}) {
  const res = await safeFetch(url, { binary: true, maxBytes: MAX_IMAGE_BYTES + 1, timeoutMs: 30000, userAgent });
  if (res.status !== 200) throw new AiError(`Image download failed (HTTP ${res.status}).`, { code: 'download' });
  if (res.truncated || res.body.length > MAX_IMAGE_BYTES) throw new AiError('Image is larger than 10 MB.', { code: 'download' });
  const mimeType = sniffImageType(res.body);
  if (!mimeType) throw new AiError('The downloaded file is not an image.', { code: 'download' });
  return { buffer: res.body, mimeType, ...imageSize(res.body) };
}

// Replaceable in tests (no network there).
export const _deps = { download: downloadImage };

async function saveLocal(img, meta) {
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXT[img.mimeType] || '.jpg'}`;
  await fs.promises.mkdir(env.uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(env.uploadDir, filename), img.buffer);
  // Smaller WebP copies for fast pages (skipped when the optimiser is not installed).
  const opt = await makeVariants(img.buffer, filename.replace(/\.[a-z0-9]+$/i, '')).catch((err) => {
    logger.warn({ err: err.message }, 'Photo optimisation failed');
    return null;
  });
  return Media.create({
    filename,
    originalName: meta.originalName.slice(0, 200),
    url: `/uploads/${filename}`,
    mimeType: img.mimeType,
    size: img.buffer.length,
    alt: meta.alt,
    storage: 'local',
    origin: 'stock',
    sourceId: meta.sourceId,
    width: img.width || undefined,
    height: img.height || undefined,
    credit: meta.credit,
    provider: meta.provider,
    uploadedBy: meta.uploadedBy,
    variants: opt?.variants,
  });
}

export function stockCredit(c) {
  const link = (href, text) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));
  if (c.license) {
    // Creative Commons credit: title, creator, source and licence.
    const title = c.title ? `${link(c.pageUrl, `"${c.title}"`)} by ` : 'Photo by ';
    return {
      text: `${c.title ? `"${c.title}" by ` : 'Photo by '}${c.name} (${c.source}), ${c.license}`,
      html: `${title}${link(c.profileUrl, c.name)}${c.title ? '' : ` on ${link(c.pageUrl, c.source)}`}, ${link(c.licenseUrl, c.license)}`,
    };
  }
  const verb = c.source === 'Pixabay' ? 'Image by' : 'Photo by';
  const prep = c.source === 'Pixabay' ? 'from' : 'on';
  return {
    text: `${verb} ${c.name} ${prep} ${c.source}`,
    html: `${verb} ${link(c.profileUrl || c.pageUrl, c.name)} ${prep} ${link(c.sourceUrl, c.source)}`,
  };
}

const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const clipAlt = (s) => {
  const t = plainText(s).replace(/^(an? )?(image|photo|picture) of /i, '').trim();
  const out = t.length > 125 ? t.slice(0, 126).replace(/\s+\S*$/, '') : t;
  return out.charAt(0).toUpperCase() + out.slice(1);
};

// Photos that do not suit a technology news site whatever the search was:
// archive scans and documents, maps, old artwork, film/comic/toy pictures
// (also someone else's characters), logos, and anything dated before 1950.
export const UNSUITABLE_PHOTO =
  /\b(?:nypl|scan(?:ned)? by|manuscripts?|handwritten|hand-written|deeds?|land survey|survey of land|maps?|atlas|engravings?|lithographs?|etchings?|woodcuts?|illustrations? from|plate \d+|page \d+|herbarium|specimens?|postage stamps?|postcards?|newspapers?|magazine covers?|book covers?|posters?|comics?|cosplay|superheroe?s?|justice league|avengers|marvel|star wars|movies?|film stills?|trailers?|album covers?|lego|action figures?|toys?|memes?|logos?|coat of arms|flag of)\b|\b1[5-8]\d\d\b|\b19[0-4]\d\b/i;

// Words too common to show that a photo matches a search ("review", "people").
const GENERIC_WORDS = new Set(
  'the and for with from into about using use used uses new best top how what why who your you our their this that these those more most very than then them they are was were has have had not but can will just like over under after before during while modern digital online review reviewing reviews guide guides tips ways people person man woman men women team working work works someone something image photo picture shot view concept background closeup close-up looking showing shows small large big good great high low simple'.split(' '),
);
const stems = (s) => new Set((String(s || '').toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !GENERIC_WORDS.has(w)).map((w) => w.slice(0, 5)));

/**
 * Does a search result suit the post? Unsuitable kinds of picture are always
 * skipped. Results from the open libraries (Openverse, Wikimedia, NASA) are
 * matched loosely by their sources, so they must also share at least one
 * meaningful word with the search; Pexels, Unsplash and Pixabay rank their
 * own results by relevance and are trusted.
 */
export function photoFits(r, query) {
  const text = [r.credit?.title, r.alt, r.keywords].filter(Boolean).join(' ');
  if (UNSUITABLE_PHOTO.test(text)) return false;
  if (!r.open) return true;
  const wanted = stems(query);
  if (!wanted.size) return true;
  const have = stems(text);
  return [...wanted].some((w) => have.has(w));
}

// One photo from one library: the best match not used in this post or on the site before.
async function fromProvider(p, brief, ctx) {
  const adapter = getAdapter(p.key);
  const results = await adapter.search({ apiKey: p.apiKey, query: brief.query, perPage: 10, appName: ctx.appName, contact: ctx.contact });
  const fresh = results.filter((r) => r.url && !ctx.used.has(r.id) && ((r.width || 0) >= 800 || r.sizeUnknown) && photoFits(r, brief.query));
  const usedBefore = new Set((await Media.find({ sourceId: { $in: fresh.map((r) => r.id) } }, 'sourceId').lean()).map((m) => m.sourceId));
  const candidates = fresh.filter((r) => !usedBefore.has(r.id));
  // Covers of 1200 px or wider can appear as large cards in Google Discover.
  if (brief.role === 'cover') candidates.sort((a, b) => Number((b.width || 0) >= 1200) - Number((a.width || 0) >= 1200));
  if (!candidates.length) throw new AiError(`${p.info.name} found no suitable photo for "${brief.query}".`, { code: 'no_results' });
  let lastErr;
  for (const r of candidates.slice(0, 5)) {
    const alt = clipAlt(r.alt && wordCount(r.alt) >= 3 && r.credit.source !== 'Pixabay' ? r.alt : brief.alt);
    const credit = stockCredit(r.credit);
    try {
      let media;
      let size = { width: r.width, height: r.height };
      if (r.hotlink) {
        // The library requires its own URL; record the use as its rules ask.
        // eslint-disable-next-line no-await-in-loop
        await adapter.trackDownload?.({ apiKey: p.apiKey, downloadLocation: r.downloadLocation });
        // eslint-disable-next-line no-await-in-loop
        media = await Media.create({ filename: `remote-${crypto.randomBytes(10).toString('hex')}`, originalName: r.id, url: r.url, mimeType: 'image/jpeg', size: 0, alt, storage: 'remote', origin: 'stock', sourceId: r.id, width: r.width, height: r.height, credit, provider: p.info.name, uploadedBy: ctx.uploadedBy, variants: remoteVariants(r.url, r.width)?.map((v) => ({ ...v, size: 0 })) });
      } else {
        // eslint-disable-next-line no-await-in-loop
        const img = await _deps.download(r.url, { userAgent: r.userAgent });
        size = { width: img.width || r.width, height: img.height || r.height };
        if (size.width && size.width < 800) throw new AiError(`The photo is only ${size.width} px wide.`, { code: 'download' });
        // eslint-disable-next-line no-await-in-loop
        media = await saveLocal(img, { originalName: `${r.id}${EXT[img.mimeType] || '.jpg'}`, alt, sourceId: r.id, credit, provider: p.info.name, uploadedBy: ctx.uploadedBy });
      }
      ctx.used.add(r.id);
      const variants = media.variants?.length ? media.variants.map(({ width, url }) => ({ width, url })) : undefined;
      return { url: media.url, alt, ...size, credit: credit.html, provider: p.info.name, media: media._id, ...(variants ? { variants } : {}) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new AiError(`Could not get a photo from ${p.info.name}: ${lastErr?.message || 'unknown error'}`, { code: 'download' });
}

// H2 sections that get a picture, spread through the article.
// Words left out of a photo search made from a post title.
const SEARCH_STOP = new Set(
  'a an the and or of for to in on at by with from into about how what why when who your you our is are was were be it its this that these those vs versus best top guide guides tips ways new simple steps step complete ultimate 2024 2025 2026 2027'.split(' '),
);

const searchWords = (s) => plainText(s).replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w && !SEARCH_STOP.has(w.toLowerCase()));

/** A short photo search from a post's focus keyword or title. */
export function photoQuery(title, keyword = '') {
  const fromKeyword = searchWords(keyword);
  return (fromKeyword.length >= 2 ? fromKeyword : [...fromKeyword, ...searchWords(title)]).slice(0, 5).join(' ');
}

/**
 * Searches to try in turn. Focus keywords and titles often name a product or
 * person no photo library has ("Suki agentic OS"), so plainer searches follow:
 * the subtitle after a colon, the whole title, then its two longest words.
 */
export function photoQueries(title, keyword = '') {
  const t = plainText(title);
  const sub = t.includes(':') ? t.slice(t.indexOf(':') + 1) : '';
  const longest = [...new Set(searchWords(sub || t))].sort((a, b) => b.length - a.length).slice(0, 2).join(' ');
  const list = [photoQuery(t, keyword), sub && searchWords(sub).slice(0, 5).join(' '), searchWords(t).slice(0, 5).join(' '), longest];
  const seen = new Set();
  return list.filter((q) => q && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()));
}

/**
 * "Spin": one new cover photo for a post. Photos already used anywhere on the
 * site are skipped, so each spin brings a different one. `turn` rotates which
 * library is asked first, so repeated spins also look in different places.
 */
export async function spinCoverPhoto({ chain, title, keyword, turn = 0, appName, contact, uploadedBy }) {
  const queries = photoQueries(title, keyword);
  if (!queries.length) throw new AiError('Add a title first, so there is something to search for.', { code: 'no_results' });
  const n = chain.length ? turn % chain.length : 0;
  const order = [...chain.slice(n), ...chain.slice(0, n)];
  const ctx = { used: new Set(), appName, contact, uploadedBy };
  let problem = null; // a library outage, as opposed to "nothing found"
  for (const query of queries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { result } = await runWithFailover(order, 'image', (p) => fromProvider(p, { role: 'cover', query, alt: plainText(title).slice(0, 125) }, ctx));
      return { ...result, query };
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      if (err.code !== 'no_results') problem = err;
    }
  }
  const searched = `Searched for: ${queries.map((q) => `"${q}"`).join(', ')}.`;
  if (problem) throw new AiError(`No new photo found. ${searched} Last problem: ${problem.message.slice(0, 160)}`, { code: problem.code });
  throw new AiError(`None of your photo libraries had a new, fitting photo. ${searched} Try a plainer focus keyword, such as "healthcare AI".`, { code: 'no_results' });
}

export function pickSections(html, count) {
  const heads = [...String(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m, i) => ({ i, heading: htmlToText(m[1]).trim() })).filter((h) => h.heading && !SKIP_HEADING.test(h.heading));
  if (!count || !heads.length) return [];
  const n = Math.min(count, heads.length);
  const picked = [];
  for (let k = 0; k < n; k += 1) {
    const idx = Math.min(heads.length - 1, Math.floor(((k + 0.5) * heads.length) / n));
    if (!picked.includes(heads[idx])) picked.push(heads[idx]);
  }
  return picked;
}

export function figureHtml(img) {
  const dims = img.width && img.height ? ` width="${img.width}" height="${img.height}"` : '';
  const set = srcsetOf(img.variants);
  const srcset = set ? ` srcset="${esc(set)}" sizes="(min-width: 768px) 720px, 100vw"` : '';
  return `<figure><img src="${esc(img.url)}"${srcset} alt="${esc(img.alt)}"${dims} loading="lazy" />${img.credit ? `<figcaption>${img.credit}</figcaption>` : ''}</figure>`;
}

// Puts each figure after the first paragraph of its section (or right after
// the heading when the section starts with something else).
export function insertFigures(html, placements) {
  const src = String(html);
  const h2s = [...src.matchAll(/<h2[^>]*>[\s\S]*?<\/h2>/gi)];
  const inserts = [];
  for (const pl of placements) {
    const m = h2s[pl.index];
    if (!m) continue;
    const afterHeading = m.index + m[0].length;
    const nextH2 = h2s[pl.index + 1]?.index ?? src.length;
    const pEnd = src.indexOf('</p>', afterHeading);
    const at = pEnd >= 0 && pEnd < nextH2 ? pEnd + 4 : afterHeading;
    inserts.push({ at, html: pl.html });
  }
  inserts.sort((a, b) => b.at - a.at);
  let out = src;
  for (const ins of inserts) out = out.slice(0, ins.at) + ins.html + out.slice(ins.at);
  return out;
}

const s = (max) => z.preprocess((v) => (v == null ? '' : String(v)), z.string()).transform((t) => plainText(t).slice(0, max));
const briefItem = z.object({ query: s(80), alt: s(160) }).catch({ query: '', alt: '' });
export const briefSchema = z.object({
  cover: briefItem,
  sections: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(briefItem)),
});

export async function addImages({ job, step, settings, chain, appName, contact, gen, isCancelled, onSwitch, onSkip }) {
  // Resumed job: images were already added.
  if (job.images?.length) {
    step.message = `${job.images.length} image(s) already added`;
    return;
  }
  if (!settings.imagesEnabled) {
    step.message = 'Images are turned off in AI Providers';
    return;
  }
  if (!chain.chain.length) {
    job.warnings.push(`No images were added: no photo library is set up (${chain.skipped.slice(0, 3).join('; ') || 'add a free Unsplash, Pexels or Pixabay key in AI Providers'}).`);
    step.message = 'No photo library is set up';
    return;
  }

  const title = plainText(job.plan?.title || job.input.topic);
  const keyword = plainText(job.analysis?.primaryKeyword || job.input.primaryKeyword || '');
  const sections = pickSections(job.draftHtml, settings.inlineImages);
  const blocks = String(job.draftHtml).split(/<h2[^>]*>/i);
  const sectionText = (i) => htmlToText(blocks[i + 1] || '').slice(0, 500);

  // Photo searches and alt text: one call to a writing model, with a plain fallback.
  let briefs;
  try {
    const r = await gen(step, { ...imageBriefPrompt({ title, keyword, intro: htmlToText(blocks[0]).slice(0, 600), sections: sections.map((x) => ({ heading: x.heading, text: sectionText(x.i) })) }), json: true, temperature: 0.4, maxOutputTokens: 2048 }, briefSchema);
    briefs = r.json;
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    job.warnings.push(`Photo searches were made from the headings because the model failed (${err.message.slice(0, 120)}).`);
    briefs = { cover: {}, sections: [] };
  }
  const fill = (b, heading) => ({
    query: b?.query || (keyword || heading).split(/\s+/).slice(0, 4).join(' '),
    alt: b?.alt || heading,
  });
  const wanted = [
    { role: 'cover', heading: title, ...fill(briefs.cover, title) },
    ...sections.map((x, k) => ({ role: 'inline', heading: x.heading, index: x.i, ...fill(briefs.sections[k], x.heading) })),
  ];

  const ctx = { used: new Set(), appName, contact, uploadedBy: job.createdBy };
  const added = [];
  const failed = {};
  const fetchOne = async (brief) => {
    const { result } = await runWithFailover(chain.chain, 'image', (p) => fromProvider(p, brief, ctx), { onSwitch, onSkip });
    added.push({ role: brief.role, heading: brief.heading, index: brief.index, ...result });
    job.usage.images = (job.usage.images || 0) + 1;
  };
  for (const brief of wanted) {
    // eslint-disable-next-line no-await-in-loop
    await isCancelled();
    try {
      // eslint-disable-next-line no-await-in-loop
      await fetchOne(brief);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      logger.warn({ job: String(job._id), err: err.message }, 'No image found');
      failed[brief.role === 'cover' ? 'cover' : brief.heading] = err.message.slice(0, 200);
      if (brief.role !== 'cover') job.warnings.push(`No photo for "${brief.heading}" was added: ${err.message.slice(0, 200)}`);
    }
  }

  // A post needs a cover. Libraries often fail only for a moment (a timeout or
  // a server error), so try once more after a short pause with a simpler search,
  // and otherwise use the first in-article photo as the cover.
  if (failed.cover) {
    const first = wanted[0];
    // Plainer searches, as the editor's Spin button uses: the keyword, the
    // subtitle, the title, then its two longest words (product names and
    // people's names rarely have photos).
    const tried = new Set([first.query.toLowerCase()]);
    const retries = [(keyword || first.query).split(/\s+/).slice(0, 3).join(' '), ...photoQueries(title, keyword)].filter((q) => q && !tried.has(q.toLowerCase()) && tried.add(q.toLowerCase()));
    let note = `the first search failed (${failed.cover})`;
    try {
      await isCancelled();
      await new Promise((r) => setTimeout(r, env.isTest ? 0 : 5000));
      let found = '';
      let lastErr;
      for (const query of retries) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await fetchOne({ ...first, query });
          found = query;
          break;
        } catch (err) {
          if (!(err instanceof AiError)) throw err;
          lastErr = err;
        }
      }
      if (!found) throw lastErr || new AiError('No other searches to try.', { code: 'no_results' });
      job.warnings.push(`The cover photo was found with a plainer search ("${found}"); ${note}.`);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      note += `; plainer searches (${retries.map((q) => `"${q}"`).join(', ') || 'none'}) also failed: ${err.message.slice(0, 160)}`;
      const promote = added.find((x) => x.role === 'inline');
      if (promote) {
        promote.role = 'cover';
        job.warnings.push(`The first in-article photo is used as the cover photo, because no cover photo could be found: ${note}.`);
      } else job.warnings.push(`No cover photo was added: ${note}.`);
    }
  }

  const inline = added.filter((x) => x.role === 'inline');
  if (inline.length) job.draftHtml = sanitizeArticleHtml(insertFigures(job.draftHtml, inline.map((x) => ({ index: x.index, html: figureHtml(x) }))));
  job.images = added.map(({ index, ...rest }) => rest);
  job.markModified('images');
  const providers = [...new Set(added.map((x) => x.provider))];
  step.provider = providers.join(', ');
  const cover = added.some((x) => x.role === 'cover');
  step.message = `${cover ? 'Cover photo added' : 'No cover photo'} · ${inline.length} in-article photo${inline.length === 1 ? '' : 's'}`;
}
