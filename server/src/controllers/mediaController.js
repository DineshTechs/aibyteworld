import { z } from 'zod';
import { isStaffEditor } from '../middleware/auth.js';
import { removeUploadedFile, verifyImageSignature } from '../middleware/upload.js';
import { Media } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { optimizeMedia } from '../services/images/optimize.js';
import { imageSize } from '../integrations/images/common.js';
import fs from 'node:fs';
import { plainText } from '../utils/content.js';
import { asyncHandler, badRequest, forbidden, notFound, paged, parsePaging } from '../utils/http.js';

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
