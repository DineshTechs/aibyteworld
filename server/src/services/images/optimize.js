import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { Article, Media } from '../../models/index.js';

// Faster photos: local images get smaller WebP copies (480, 960 and 1600 px
// wide) so phones download a fraction of the original. Uses the optional
// "sharp" library; without it photos are simply served as they are.
export const WIDTHS = [480, 960, 1600];
let sharpLib;

async function loadSharp() {
  if (sharpLib === undefined) {
    try {
      sharpLib = (await import('sharp')).default;
    } catch {
      sharpLib = null;
    }
  }
  return sharpLib;
}

// Replaceable in tests.
export const _deps = { loadSharp };
export const optimizerAvailable = async () => Boolean(await _deps.loadSharp());

/** Makes WebP copies of an image buffer. Returns { width, height, variants } or null. */
export async function makeVariants(buffer, baseName) {
  const sharp = await _deps.loadSharp();
  if (!sharp) return null;
  const meta = await sharp(buffer).metadata();
  if (!meta.width || meta.pages > 1) return null; // animated images are left alone
  const widths = [...new Set(WIDTHS.map((w) => Math.min(w, meta.width)))];
  const variants = [];
  for (const w of widths) {
    // eslint-disable-next-line no-await-in-loop
    const out = await sharp(buffer).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const filename = `${baseName}-${w}w.webp`;
    // eslint-disable-next-line no-await-in-loop
    await fs.promises.writeFile(path.join(env.uploadDir, filename), out);
    variants.push({ width: w, url: `/uploads/${filename}`, size: out.length });
  }
  const oriented = meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  return { ...oriented, variants };
}

// Hotlinked Unsplash photos are resized by Unsplash's own image service.
export function remoteVariants(url, width) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'images.unsplash.com') return undefined;
    return WIDTHS.filter((w) => !width || w <= width).map((w) => {
      const v = new URL(url);
      v.searchParams.set('w', String(w));
      v.searchParams.set('fm', 'webp');
      v.searchParams.set('q', '75');
      v.searchParams.set('fit', 'max');
      return { width: w, url: v.toString() };
    });
  } catch {
    return undefined;
  }
}

export const srcsetOf = (variants) => (variants?.length ? variants.map((v) => `${v.url} ${v.width}w`).join(', ') : '');

/** Optimises one Media record (local files only). Returns the updated record or null. */
export async function optimizeMedia(media) {
  if (media.storage === 'remote') {
    if (!media.variants?.length) {
      const v = remoteVariants(media.url, media.width);
      if (v?.length) {
        media.variants = v.map((x) => ({ ...x, size: 0 }));
        await media.save();
      }
    }
    return media;
  }
  if (media.variants?.length || media.mimeType === 'image/gif') return media;
  try {
    const file = path.join(env.uploadDir, path.basename(media.filename));
    const buffer = await fs.promises.readFile(file);
    const res = await makeVariants(buffer, path.basename(media.filename).replace(/\.[a-z0-9]+$/i, ''));
    if (!res) return null;
    media.variants = res.variants;
    media.width = media.width || res.width;
    media.height = media.height || res.height;
    await media.save();
    return media;
  } catch (err) {
    logger.warn({ media: String(media._id), err: err.message }, 'Photo optimisation failed');
    return null;
  }
}

// Adds srcset to <img> tags in article HTML for images that have copies.
export function addSrcset(html, byUrl) {
  return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\ssrcset=/i.test(tag)) return tag;
    const src = (tag.match(/\ssrc="([^"]+)"/i) || [])[1];
    const set = src && srcsetOf(byUrl.get(src.replace(/&amp;/g, '&')));
    return set ? tag.replace(/<img\b/i, `<img srcset="${set.replace(/&/g, '&amp;')}" sizes="(min-width: 768px) 720px, 100vw"`) : tag;
  });
}

/** Optimises photos that have no copies yet and updates the posts that use them. */
export async function optimizeExisting(limit = 40) {
  const todo = await Media.find({ $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }], mimeType: { $ne: 'image/gif' } }).sort({ createdAt: -1 }).limit(limit);
  const byUrl = new Map();
  let done = 0;
  for (const m of todo) {
    // eslint-disable-next-line no-await-in-loop
    const r = await optimizeMedia(m);
    if (r?.variants?.length) {
      byUrl.set(r.url, r.variants);
      done += 1;
    }
  }
  let posts = 0;
  if (byUrl.size) {
    const urls = [...byUrl.keys()];
    const articles = await Article.find({ $or: [{ 'featuredImage.url': { $in: urls } }, { content: { $regex: urls.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') } }] });
    for (const a of articles) {
      const cover = byUrl.get(a.featuredImage?.url);
      if (cover) a.featuredImage.variants = cover.map(({ width, url }) => ({ width, url }));
      a.content = addSrcset(a.content, byUrl);
      // eslint-disable-next-line no-await-in-loop
      await Article.updateOne({ _id: a._id }, { $set: { content: a.content, ...(cover ? { 'featuredImage.variants': a.featuredImage.variants } : {}) } });
      posts += 1;
    }
  }
  const remaining = await Media.countDocuments({ $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }], mimeType: { $ne: 'image/gif' }, storage: 'local' });
  return { optimised: done, posts, remaining: Math.max(0, remaining - (todo.length - done)) };
}
