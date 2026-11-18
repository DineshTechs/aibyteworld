import net from 'node:net';
import { Growth, SiteSettings } from '../../models/index.js';
import { decryptSecret } from '../../utils/crypto.js';

// The site's public address from Settings, or '' while the site only runs on
// this computer. Sharing, IndexNow and newsletters need a real address, because
// links to localhost are useless to readers and search engines.
export function publicBase(siteUrl) {
  const raw = String(siteUrl || '').trim().replace(/\/+$/, '');
  let u;
  try {
    u = new URL(raw);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol)) return '';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.test') || !host.includes('.') && !net.isIP(host)) return '';
  if (net.isIP(host)) {
    const v4 = host.split('.').map(Number);
    const priv = net.isIPv4(host) ? v4[0] === 10 || v4[0] === 127 || (v4[0] === 192 && v4[1] === 168) || (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) || (v4[0] === 169 && v4[1] === 254) : host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
    if (priv) return '';
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

export const NOT_PUBLIC = 'the Site URL in Settings is not a public web address yet (it is empty or points to this computer)';

export async function siteContext() {
  const settings = await SiteSettings.getSingleton();
  return { settings, base: publicBase(settings.siteUrl) };
}

export const articleUrl = (base, article) => `${base}/blog/${article.slug}`;
export const absolute = (base, u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`);

// Growth settings with the encrypted secrets loaded.
const SECRET_PATHS = [
  'share.x.apiKey', 'share.x.apiSecret', 'share.x.accessToken', 'share.x.accessSecret',
  'share.linkedin.token', 'share.facebook.token', 'newsletter.apiKey',
].flatMap((p) => [`+${p}.iv`, `+${p}.tag`, `+${p}.data`]);

export async function growthWithSecrets() {
  await Growth.getSingleton();
  return Growth.findOne({ key: 'growth' }).select(SECRET_PATHS.join(' '));
}

export const secretOf = (doc, path) => decryptSecret(path.split('.').reduce((o, k) => o?.[k], doc));
export const hasSecret = (doc, path) => Boolean(path.split('.').reduce((o, k) => o?.[k], doc)?.data);
