export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (m = 'Bad request', d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m);
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m = 'Conflict') => new HttpError(409, m);

// Wraps async route handlers so rejected promises reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parsePaging(query, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function paged(items, total, { page, limit }) {
  return { items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
