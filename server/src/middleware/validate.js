import mongoose from 'mongoose';
import { z } from 'zod';
import { badRequest } from '../utils/http.js';

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v), { message: 'Invalid id' });

// Validates and replaces req.body with the parsed (stripped) value.
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(badRequest(details[0] ? `${details[0].field || 'body'}: ${details[0].message}` : 'Invalid input', details));
  }
  req.body = result.data;
  return next();
};

export const validateIdParam = (name = 'id') => (req, _res, next) => {
  if (!mongoose.isValidObjectId(req.params[name])) return next(badRequest('Invalid id'));
  return next();
};
