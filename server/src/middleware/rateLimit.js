import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const make = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    limit: env.isTest ? 100000 : max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
  });

export const apiLimiter = make(15 * 60 * 1000, 1500, 'Too many requests. Please slow down.');
export const loginLimiter = make(15 * 60 * 1000, 10, 'Too many sign-in attempts. Try again in 15 minutes.');
export const publicWriteLimiter = make(60 * 60 * 1000, 20, 'Too many submissions. Try again later.');
export const uploadLimiter = make(15 * 60 * 1000, 120, 'Too many uploads. Try again later.');
export const aiJobLimiter = make(60 * 60 * 1000, 30, 'Too many AI jobs started. Try again later.');
export const trackLimiter = make(15 * 60 * 1000, 600, 'Too many requests.');
