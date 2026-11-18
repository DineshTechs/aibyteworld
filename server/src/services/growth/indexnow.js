import { logger } from '../../config/logger.js';
import { Growth } from '../../models/index.js';
import { apiFetch } from '../../utils/apiFetch.js';
import { NOT_PUBLIC, siteContext } from './common.js';

// IndexNow tells Bing, Yandex, Seznam, Naver and others about a new, changed or
// removed page straight away (Google does not use IndexNow; it reads the sitemap).
// The key file is served at /<key>.txt to prove the site owns the key.
const recent = new Map(); // url -> last ping time, so autosaves do not ping every few seconds
const QUIET_MS = 10 * 60 * 1000;

export async function pingIndexNow(paths, { force = false } = {}) {
  const growth = await Growth.getSingleton();
  if (!growth.indexnow.enabled) return { skipped: 'IndexNow is turned off' };
  const { base } = await siteContext();
  if (!base) return { skipped: NOT_PUBLIC };
  const now = Date.now();
  const urls = [...new Set(paths.map((p) => `${base}${p}`))].filter((u) => force || now - (recent.get(u) || 0) > QUIET_MS);
  if (!urls.length) return { skipped: 'pinged a few minutes ago' };
  const host = new URL(base).host;
  const key = growth.indexnow.key;
  let result;
  try {
    const res = await apiFetch('IndexNow', 'https://api.indexnow.org/indexnow', { method: 'POST', body: { host, key, keyLocation: `${base}/${key}.txt`, urlList: urls.slice(0, 1000) } });
    urls.forEach((u) => recent.set(u, now));
    result = { ok: true, status: res.status, urls: urls.length };
  } catch (err) {
    const why = err.status === 403 ? 'the key file could not be checked (is the site online at the Site URL?)' : err.status === 422 ? 'the addresses do not match the site address' : err.message;
    result = { ok: false, error: why };
    logger.warn({ err: err.message }, 'IndexNow ping failed');
  }
  await Growth.updateOne({ key: 'growth' }, { $set: { 'indexnow.lastPingAt': new Date(), 'indexnow.lastResult': result.ok ? `Sent ${result.urls} address${result.urls === 1 ? '' : 'es'} (HTTP ${result.status})` : `Failed: ${result.error}`.slice(0, 300) } });
  return result;
}

export const _test = { reset: () => recent.clear() };
