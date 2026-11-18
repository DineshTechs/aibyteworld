import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/http.js';

fs.mkdirSync(env.uploadDir, { recursive: true });

// Only raster image types. SVG is rejected because it can carry scripts.
const TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  // The stored name is random; the client-supplied name is never used on disk.
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${TYPES[file.mimetype]}`),
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!TYPES[file.mimetype]) return cb(badRequest('Only JPG, PNG, WebP and GIF images are allowed'));
    return cb(null, true);
  },
}).single('file');

// Confirms the file content matches its declared image type (magic bytes).
export function verifyImageSignature(filePath, mimeType) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  switch (mimeType) {
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png':
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif':
      return buf.subarray(0, 4).toString('ascii') === 'GIF8';
    case 'image/webp':
      return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    default:
      return false;
  }
}

export function removeUploadedFile(filename) {
  const safe = path.basename(String(filename || ''));
  if (!safe) return;
  const full = path.join(env.uploadDir, safe);
  fs.rm(full, { force: true }, () => {});
}
