import pino from 'pino';
import { env } from './env.js';

// Structured JSON logs. Secrets and credentials are redacted.
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token'],
    censor: '[redacted]',
  },
});
