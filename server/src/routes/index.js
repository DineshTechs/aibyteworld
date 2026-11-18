import * as telegram from '../controllers/telegramController.js';
import * as growth from '../controllers/growthController.js';
import * as newsletter from '../controllers/newsletterController.js';
import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import * as ai from '../controllers/aiController.js';
import * as autopilot from '../controllers/autopilotController.js';
import * as articles from '../controllers/articleController.js';
import * as auth from '../controllers/authController.js';
import * as media from '../controllers/mediaController.js';
import * as pub from '../controllers/publicController.js';
import { categories, categorySchema, tags, tagSchema } from '../controllers/taxonomyController.js';
import { dbState } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { aiJobLimiter, loginLimiter, publicWriteLimiter, trackLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { uploadImage } from '../middleware/upload.js';
import { validateBody, validateIdParam } from '../middleware/validate.js';

const router = Router();
const id = validateIdParam('id');
const staff = requireRole('admin', 'editor');
const adminOnly = requireRole('admin');

const startedAt = new Date();
router.get('/health', (_req, res) => {
  const db = dbState();
  // startedAt / uptime show whether the host restarted or paused the app.
  res.status(db === 'connected' ? 200 : 503).json({ status: db === 'connected' ? 'ok' : 'degraded', db, startedAt, uptimeSeconds: Math.round(process.uptime()) });
});

// ---------- Public (no authentication) ----------
router.get('/public/settings', pub.settings);
router.get('/public/home', pub.home);
router.get('/public/articles', pub.listArticles);
router.get('/public/articles/:slug', pub.getArticle);
router.get('/public/categories', pub.listCategories);
router.get('/public/tags', pub.listTags);
router.get('/public/authors/:id', pub.getAuthor);
router.post('/public/newsletter', publicWriteLimiter, validateBody(newsletter.newsletterSchema), newsletter.publicSubscribe);
router.post('/public/newsletter/confirm', publicWriteLimiter, newsletter.publicConfirm);
router.post('/public/newsletter/unsubscribe', trackLimiter, newsletter.publicUnsubscribe);
router.post('/public/track', trackLimiter, validateBody(pub.trackSchema), pub.track);

// ---------- Authentication ----------
router.post('/auth/login', loginLimiter, validateBody(auth.loginSchema), auth.login);
router.get('/auth/me', requireAuth, auth.me);
router.put('/auth/profile', requireAuth, validateBody(auth.profileSchema), auth.updateProfile);
router.post('/auth/change-password', requireAuth, validateBody(auth.changePasswordSchema), auth.changePassword);

// ---------- Admin (authenticated) ----------
const a = Router();
a.use(requireAuth);

a.get('/stats', articles.stats);
a.get('/activity/recent', admin.recentActivity);

a.get('/articles', articles.listArticles);
a.post('/articles', validateBody(articles.articleSchema), articles.createArticle);
a.get('/articles/:id', id, articles.getArticle);
a.put('/articles/:id', id, validateBody(articles.articleSchema), articles.updateArticle);
a.patch('/articles/:id/status', id, validateBody(articles.statusSchema), articles.changeStatus);
a.delete('/articles/:id', id, articles.deleteArticle);
a.post('/articles/:id/share', staff, id, growth.shareNow);
a.post('/articles/:id/translate', staff, id, growth.translateNow);
a.post('/articles/:id/refresh', staff, id, aiJobLimiter, growth.startRefreshNow);
a.post('/articles/:id/refresh/apply', staff, id, growth.applyRefreshNow);
a.delete('/articles/:id/refresh', staff, id, growth.discardRefreshNow);
a.get('/refresh', staff, growth.refreshOverview);

a.get('/categories', categories.list);
a.post('/categories', staff, validateBody(categorySchema), categories.create);
a.put('/categories/:id', staff, id, validateBody(categorySchema), categories.update);
a.delete('/categories/:id', staff, id, categories.remove);

a.get('/tags', tags.list);
a.post('/tags', validateBody(tagSchema), tags.create); // authors may add tags while writing
a.put('/tags/:id', staff, id, validateBody(tagSchema), tags.update);
a.delete('/tags/:id', staff, id, tags.remove);

a.get('/media', media.listMedia);
a.post('/media/optimize', adminOnly, growth.optimizePhotos);
a.post('/media/spin', staff, uploadLimiter, validateBody(media.spinSchema), media.spinCover);
a.post('/media', uploadLimiter, uploadImage, media.uploadMedia);
a.put('/media/:id', id, validateBody(media.mediaUpdateSchema), media.updateMedia);
a.delete('/media/:id', id, media.deleteMedia);

a.get('/authors', staff, admin.listAuthors);

a.get('/users', adminOnly, admin.listUsers);
a.post('/users', adminOnly, validateBody(admin.userCreateSchema), admin.createUser);
a.put('/users/:id', adminOnly, id, validateBody(admin.userUpdateSchema), admin.updateUser);
a.delete('/users/:id', adminOnly, id, admin.deleteUser);

a.get('/analytics', staff, admin.analytics);
a.get('/telegram', adminOnly, telegram.getTelegram);
a.put('/telegram', adminOnly, validateBody(telegram.telegramSchema), telegram.updateTelegram);
a.delete('/telegram/token', adminOnly, telegram.removeTelegramToken);
a.post('/telegram/link', adminOnly, telegram.createTelegramLink);
a.delete('/telegram/chats/:chatId', adminOnly, telegram.removeTelegramChat);
a.post('/telegram/test', adminOnly, telegram.testTelegram);
a.get('/growth', adminOnly, growth.getGrowth);
a.put('/growth', adminOnly, validateBody(growth.growthSchema), growth.updateGrowth);
a.delete('/growth/keys/:name', adminOnly, growth.removeGrowthSecret);
a.post('/growth/check/:channel', adminOnly, growth.checkGrowthChannel);
a.post('/growth/indexnow', adminOnly, growth.pingIndexNowNow);
a.post('/newsletter/test', adminOnly, newsletter.testNewsletter);
a.post('/newsletter/send', adminOnly, newsletter.sendDigestNow);
a.get('/newsletter/subscribers', staff, newsletter.listSubscribers);
a.get('/newsletter/subscribers.csv', adminOnly, newsletter.exportSubscribers);
a.delete('/newsletter/subscribers/:id', adminOnly, id, newsletter.deleteSubscriber);
a.get('/settings', adminOnly, admin.getSettings);
a.put('/settings', adminOnly, validateBody(admin.settingsSchema), admin.updateSettings);

a.get('/activity', adminOnly, admin.listActivity);
a.get('/subscribers/count', staff, admin.subscriberCount);

// AI providers and settings (admin), AI Content Studio jobs (admin, editor)
a.get('/ai/providers', adminOnly, ai.listProviders);
a.put('/ai/providers/:key', adminOnly, validateBody(ai.providerUpdateSchema), ai.updateProvider);
a.delete('/ai/providers/:key/key', adminOnly, ai.removeProviderKey);
a.get('/ai/providers/:key/models', adminOnly, ai.listProviderModels);
a.post('/ai/providers/:key/test', adminOnly, ai.testProvider);
a.post('/ai/providers/:key/reset-health', adminOnly, ai.resetProviderHealth);
a.get('/ai/status', staff, ai.aiStatus);
a.get('/ai/settings', staff, ai.getAiSettings);
a.put('/ai/settings', adminOnly, validateBody(ai.aiSettingsSchema), ai.updateAiSettings);
a.get('/ai/jobs', staff, ai.listJobs);
a.post('/ai/jobs', staff, aiJobLimiter, validateBody(ai.jobCreateSchema), ai.createJob);
a.get('/ai/jobs/:id', staff, id, ai.getJob);
a.post('/ai/jobs/:id/cancel', staff, id, ai.cancelJob);
a.post('/ai/jobs/:id/retry', staff, id, ai.retryJob);

// Autopilot (admin)
a.get('/autopilot', adminOnly, autopilot.getAutopilot);
a.put('/autopilot', adminOnly, validateBody(autopilot.autopilotSchema), autopilot.updateAutopilot);
a.post('/autopilot/run', adminOnly, aiJobLimiter, autopilot.runAutopilotNow);

router.use('/admin', a);

export default router;
