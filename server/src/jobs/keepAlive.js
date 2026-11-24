import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { SiteSettings } from '../models/index.js';
import { publicBase } from '../services/growth/common.js';
import { alertSystem } from '../services/telegram/alert.js';

// Some Node.js hosts stop an app that gets no visits for a while, which would
// also stop Autopilot, the newsletter and the Telegram bot. The app visits its
// own public address every 4 minutes, so the host always sees traffic. (A cron
// job or uptime monitor outside the app also restarts it if it ever stops.)
export function startKeepAlive({ everyMs = 4 * 60 * 1000 } = {}) {
  if (!env.isProd) return () => {};
  let failures = 0;
  const ping = async () => {
    try {
      const base = publicBase((await SiteSettings.getSingleton()).siteUrl);
      if (!base) return;
      const res = await fetch(`${base}/api/health`, { headers: { 'User-Agent': 'aibyte-keepalive/1.0' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures === 1 || failures % 15 === 0) logger.warn({ err: err.message, failures }, 'Keep-alive visit failed');
      if (failures === 3) await alertSystem('keepalive', `The site could not reach its own address 3 times in a row (${err.message}). Visitors may not be able to open it: check the domain, SSL and hosting.`, { icon: '🔴' });
    }
  };
  const t = setInterval(ping, everyMs);
  t.unref?.();
  setTimeout(ping, 30000).unref?.();
  return () => clearInterval(t);
}
