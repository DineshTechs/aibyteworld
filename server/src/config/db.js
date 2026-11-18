import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

// Indexes whose options changed in a later version must be removed before
// they are built again, or MongoDB refuses to start with the new options.
// The article search index used to read the post's "language" field as its
// search language, which refuses Hindi posts.
export async function dropOutdatedIndexes() {
  const articles = mongoose.connection.db.collection('articles');
  const indexes = await articles.indexes().catch(() => []);
  const text = indexes.find((i) => i.name === 'article_text');
  if (text && text.language_override !== 'textSearchLanguage') {
    await articles.dropIndex('article_text');
    logger.info('Rebuilding the article search index so Hindi posts can be saved');
    return true;
  }
  return false;
}

export async function connectDb() {
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.DB_NAME,
    serverSelectionTimeoutMS: 15000,
  });
  logger.info({ db: env.DB_NAME }, 'MongoDB connected');
  await dropOutdatedIndexes();
  // Build declared indexes (safe to run repeatedly).
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function dbState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
}
