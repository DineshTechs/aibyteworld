import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Fetches a public web page as untrusted data: http(s) only, public IP
// addresses only (checked at connect time, for every redirect), size and
// time limits, text responses only. Nothing fetched is ever executed.

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

// Resolves the host and refuses private addresses. Node may ask for all
// addresses (happy eyeballs), so both callback shapes are supported.
function safeLookup(hostname, options, cb) {
  const opts = typeof options === 'object' && options ? options : { family: options };
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length) return cb(new Error(`No address found for ${hostname}`));
    if (list.some((a) => isPrivateAddress(a.address))) return cb(new Error(`Blocked private address for ${hostname}`));
    return opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}

// Node connects to IP-literal hosts without calling lookup, so check them here.
function assertPublicHost(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) throw new Error(`Blocked private address for ${host}`);
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error(`Blocked private address for ${host}`);
}

function requestOnce(url, { timeoutMs, maxBytes, method, binary, userAgent }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method,
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: {
          // Image hosts such as Wikimedia ask for a descriptive agent name.
          'User-Agent': userAgent || (binary ? 'BlogSiteImageFetcher/1.0 (blog photo download; Node.js)' : 'Mozilla/5.0 (compatible; BlogSiteResearchBot/1.0)'),
          Accept: binary ? 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        const type = String(res.headers['content-type'] || '');
        const done = (truncated) => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, body: binary ? buf : buf.toString('utf8'), contentType: type, truncated });
        };
        const wanted = binary ? /^image\//i : /text\/|html|xml|json/i;
        if (method === 'HEAD' || (res.statusCode >= 300 && res.statusCode < 400) || !wanted.test(type)) {
          res.resume();
          return done(false);
        }
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) {
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - maxBytes))));
            res.destroy();
            done(true);
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => done(false));
        res.on('error', reject);
        return undefined;
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

// binary: true reads image/* responses into a Buffer (for downloading images).
// userAgent: a site-specific agent name (Wikimedia asks for one with contact details).
export async function safeFetch(rawUrl, { timeoutMs = 8000, maxBytes = 1_500_000, maxRedirects = 4, method = 'GET', binary = false, userAgent = '' } = {}) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs are allowed');
    assertPublicHost(url);
    // eslint-disable-next-line no-await-in-loop
    const res = await requestOnce(url, { timeoutMs, maxBytes, method, binary, userAgent });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    return { ...res, url: url.toString() };
  }
  throw new Error('Too many redirects');
}

// Reads the publication date and title a page declares about itself.
export function extractPageMeta(html) {
  const head = String(html || '').slice(0, 400_000);
  const attr = (re) => {
    const m = head.match(re);
    return m ? m[1].trim() : '';
  };
  const candidates = [
    attr(/<meta[^>]+(?:property|name)=["'](?:article:published_time|og:published_time|datePublished|date|dc\.date|DC\.date\.issued|pubdate|publish-date|sailthru\.date|parsely-pub-date)["'][^>]*content=["']([^"']+)["']/i),
    attr(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|datePublished|date)["']/i),
    attr(/"datePublished"\s*:\s*"([^"]+)"/i),
    attr(/<time[^>]+datetime=["']([^"']+)["']/i),
  ];
  let publishedAt = null;
  for (const c of candidates) {
    const d = c ? new Date(c) : null;
    if (d && !Number.isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getTime() < Date.now() + 86400000) {
      publishedAt = d;
      break;
    }
  }
  const title =
    attr(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    attr(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return { publishedAt, title: decode(title).slice(0, 300) };
}

export const _test = { isPrivateAddress };
