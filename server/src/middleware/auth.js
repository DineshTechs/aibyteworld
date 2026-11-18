import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { asyncHandler, forbidden, unauthorized } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

// Requires a valid "Authorization: Bearer <token>" header. Tokens are never read
// from cookies, so browsers cannot attach them automatically (no CSRF surface).
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Session expired or invalid. Please sign in again.');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.active || user.tokenVersion !== payload.tv) {
    throw unauthorized('Session expired or invalid. Please sign in again.');
  }
  req.user = user;
  next();
});

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  return next();
};

export const isStaffEditor = (user) => user.role === 'admin' || user.role === 'editor';
