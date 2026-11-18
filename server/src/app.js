import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import routes from './routes/index.js';
import { SiteSettings } from './models/index.js';
import seoRoutes, { clientRouter } from './routes/seo.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.isProd) app.set('trust proxy', 1);

  app.use(
    helmet({
      // Uploaded images are displayed by the frontend on another origin in development.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // The website only loads its own script files (no inline scripts),
          // plus Google Analytics / Tag Manager when set up and the visitor agrees.
          'script-src': ["'self'", 'https://www.googletagmanager.com', 'https://*.googletagmanager.com', 'https://www.google-analytics.com', 'https://tagmanager.google.com'],
          'img-src': ["'self'", 'data:', 'https:'],
          // Google Search Suggestions in the admin research viewer.
          'frame-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https:'],
          'connect-src': ["'self'", 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com', 'https://*.googletagmanager.com'],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.clientOrigins.includes(origin)),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  // One address for search engines: aibyte.world and www.aibyte.world both
  // reach the site, so page visits on the other one are sent (301) to the
  // address set as Site URL.
  if (env.isProd) {
    let cached = { at: 0, host: '' };
    app.use(async (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/')) return next();
      try {
        if (Date.now() - cached.at > 60000) {
          let host = '';
          try {
            host = new URL((await SiteSettings.getSingleton()).siteUrl).hostname.toLowerCase();
          } catch {
            host = '';
          }
          cached = { at: Date.now(), host };
        }
        const want = cached.host;
        const got = String(req.hostname || '').toLowerCase();
        if (want && got !== want && (got === `www.${want}` || want === `www.${got}`)) return res.redirect(301, `https://${want}${req.originalUrl}`);
      } catch {
        /* never block a visit because of this check */
      }
      return next();
    });
  }
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url.startsWith('/uploads') } }));
  app.use(express.json({ limit: '2mb' }));

  // Uploaded images: static files only, never executed or sniffed as another type.
  app.use(
    '/uploads',
    express.static(env.uploadDir, {
      index: false,
      dotfiles: 'deny',
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  app.use('/api', apiLimiter, routes);
  app.use(seoRoutes); // /sitemap.xml, /robots.txt, /rss.xml
  if (!env.isTest) {
    const client = clientRouter();
    if (client) app.use(client);
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
