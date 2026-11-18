import multer from 'multer';
import { logger } from '../config/logger.js';
import { HttpError } from '../utils/http.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : `Upload failed: ${err.message}`;
    return res.status(400).json({ error: message });
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err?.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier' });
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ error: `That ${field} is already in use` });
  }
  logger.error({ err, path: req.originalUrl, method: req.method }, 'Unhandled error');
  return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}
