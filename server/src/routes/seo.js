import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { env, SERVER_ROOT } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Growth, SiteSettings } from '../models/index.js';
import { buildRobots, buildRss, buildSitemap, headToHtml, renderHead, siteBase } from '../services/seoService.js';
import { asyncHandler } from '../utils/http.js';

const router = Router();

router.get(
  '/sitemap.xml',
  asyncHandler(async (req, res) => {
    const settings = await SiteSettings.getSingleton();
    res.type('application/xml').set('Cache-Control', 'public, max-age=900').send(await buildSitemap(siteBase(req, settings)));
  }),
);

router.get(
  '/robots.txt',
  asyncHandler(async (req, res) => {
    const settings = await SiteSettings.getSingleton();
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(buildRobots(siteBase(req, settings), settings.allowIndexing));
  }),
);

router.get(
  '/rss.xml',
  asyncHandler(async (req, res) => {
    const settings = await SiteSettings.getSingleton();
    res.type('application/rss+xml').set('Cache-Control', 'public, max-age=900').send(await buildRss(siteBase(req, settings), settings));
  }),
);

// IndexNow key file: proves to search engines that this site owns the key.
router.get(
  /^\/([a-f0-9]{32})\.txt$/,
  asyncHandler(async (req, res, next) => {
    const growth = await Growth.getSingleton();
    if (!growth.indexnow.enabled || req.params[0] !== growth.indexnow.key) return next();
    return res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(growth.indexnow.key);
  }),
);

export default router;

// Production: serve the built website from client/dist and write the page's
// SEO tags into index.html on the server. Returns null when no build exists.
export function clientRouter() {
  const dist = env.CLIENT_DIST || path.resolve(SERVER_ROOT, '..', 'client', 'dist');
  const indexPath = path.join(dist, 'index.html');
  if (!fs.existsSync(indexPath)) return null;
  const template = fs.readFileSync(indexPath, 'utf8');
  const r = Router();
  r.use(
    '/assets',
    (req, res, next) => {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      next();
    },
  );
  // index: false so "/" goes through the SEO handler below.
  r.use(express.static(dist, { index: false, maxAge: '1h' }));
  r.get(
    '*',
    asyncHandler(async (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      if (!req.accepts('html')) return next();
      const settings = await SiteSettings.getSingleton();
      const base = siteBase(req, settings);
      let head;
      try {
        head = await renderHead(req.path, base);
      } catch (err) {
        logger.error({ err, path: req.path }, 'SEO head rendering failed');
        head = { status: 200, title: settings.siteName, description: '', canonical: base + req.path, ld: [], type: 'website' };
      }
      const html = template
        .replace(/<title>[\s\S]*?<\/title>/, '')
        .replace(/<html lang="[^"]*"/, `<html lang="${head.lang || 'en'}"`)
        .replace('<!--seo-head-->', headToHtml(head, settings.siteName));
      return res.status(head.status).set('Cache-Control', 'no-cache').type('html').send(html);
    }),
  );
  logger.info({ dist }, 'Serving the built website with server-side SEO tags');
  return r;
}
