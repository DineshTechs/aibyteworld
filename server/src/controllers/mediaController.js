import { z } from 'zod';
import { isStaffEditor } from '../middleware/auth.js';
import { removeUploadedFile, verifyImageSignature } from '../middleware/upload.js';
import { Media, SiteSettings } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { optimizeMedia } from '../services/images/optimize.js';
import { imageSize } from '../integrations/images/common.js';
import fs from 'node:fs';
import { plainText } from '../utils/content.js';
import { asyncHandler, badRequest, forbidden, notFound, paged, parsePaging } from '../utils/http.js';
import { providerChain } from '../services/ai/providerService.js';
import { spinCoverPhoto } from '../services/images/imageService.js';
import { AiError } from '../integrations/ai/errors.js';
import { publicBase } from '../services/growth/common.js';
import { makeSlug } from '../utils/content.js';

export const mediaUpdateSchema = z.object({ alt: z.string().max(300) });

export const listMedia = asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query, { defaultLimit: 24, maxLimit: 60 });
  const [items, total] = await Promise.all([
    Media.find().sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit).populate('uploadedBy', 'name').lean(),
    Media.countDocuments(),
  ]);
  res.json(paged(items, total, paging));
});

export const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file was uploaded');
  if (!verifyImageSignature(req.file.path, req.file.mimetype)) {
    removeUploadedFile(req.file.filename);
    throw badRequest('The file is not a valid image');
  }
  const media = await Media.create({
    filename: req.file.filename,
    originalName: plainText(req.file.originalname).slice(0, 200),
    url: `/uploads/${req.file.filename}`,
    mimeType: req.file.mimetype,
    size: req.file.size,
    alt: plainText(req.body?.alt || '').slice(0, 300),
    uploadedBy: req.user._id,
    ...imageSize(await fs.promises.readFile(req.file.path)),
  });
  // Smaller WebP copies for fast pages (when the optimiser is installed).
  await optimizeMedia(media);
  await logActivity(req, 'media.upload', { entityType: 'Media', entityId: media._id, summary: `Uploaded ${media.originalName || media.filename}` });
  res.status(201).json({ item: media });
});

export const updateMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id);
  if (!media) throw notFound('Media not found');
  if (!isStaffEditor(req.user) && String(media.uploadedBy) !== String(req.user._id)) throw forbidden();
  media.alt = plainText(req.body.alt);
  await media.save();
  res.json({ item: media });
});

export const deleteMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id);
  if (!media) throw notFound('Media not found');
  if (!isStaffEditor(req.user) && String(media.uploadedBy) !== String(req.user._id)) throw forbidden();
  await media.deleteOne();
  if (media.storage !== 'remote') removeUploadedFile(media.filename);
  for (const v of media.variants || []) if (v.url?.startsWith('/uploads/')) removeUploadedFile(v.url.slice('/uploads/'.length));
  await logActivity(req, 'media.delete', { entityType: 'Media', entityId: media._id, summary: `Deleted ${media.originalName || media.filename}` });
  res.status(204).end();
});

// "Spin" in the post editor: find a new cover photo in the photo libraries.
// The photo is saved to the media library; the post changes only when the
// editor saves it.
export const spinSchema = z.object({
  title: z.string().trim().max(300).default(''),
  keyword: z.string().trim().max(120).default(''),
  turn: z.coerce.number().int().min(0).max(1000).default(0),
});

export const spinCover = asyncHandler(async (req, res) => {
  const site = await SiteSettings.getSingleton();
  if (!site.ai?.imagesEnabled) throw badRequest('Photos are turned off in AI Providers.');
  const { chain, skipped } = await providerChain(site.ai, 'image');
  if (!chain.length) throw badRequest(`No photo library is set up. ${skipped.slice(0, 2).join('; ') || 'Add a free Unsplash, Pexels or Pixabay key in AI Providers.'}`);
  try {
    const photo = await spinCoverPhoto({
      chain,
      title: req.body.title,
      keyword: req.body.keyword,
      turn: req.body.turn,
      appName: makeSlug(site.siteName || 'blog') || 'blog',
      contact: publicBase(site.siteUrl) || site.contactEmail || '',
      uploadedBy: req.user._id,
    });
    await logActivity(req, 'media.spin', { entityType: 'Media', entityId: photo.media, summary: `New cover photo from ${photo.provider} (search: ${photo.query})` });
    res.json({ photo: { url: photo.url, alt: photo.alt, credit: photo.credit, provider: photo.provider, query: photo.query } });
  } catch (err) {
    if (err instanceof AiError) throw badRequest(`No new photo found: ${err.message.slice(0, 200)}`);
    throw err;
  }
});
