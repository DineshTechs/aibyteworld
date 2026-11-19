import { AiError } from '../../integrations/ai/errors.js';
import { safeFetch } from '../../utils/safeFetch.js';

// Reads a website for an article about it: the home page plus the pages that
// describe what it offers (pricing, features, products, services, about...).
// Only public addresses are fetched (safeFetch), robots.txt is respected, and
// page text is treated as data by the prompts that use it.

const AGENT = 'Mozilla/5.0 (compatible; BlogSiteResearchBot/1.0)';
const OFFER = /\b(?:pricing|prices?|plans?|features?|products?|services?|solutions?|platform|how[- ]it[- ]works|use[- ]cases?|customers?|about|company|team|docs|documentation|faqs?|integrations?|apps?|downloads?|courses?|tools?|enterprise|security|why|portfolio|offerings?|packages?|benefits?|industries)\b/gi;
const SKIP = /(?:log-?in|sign-?in|sign-?up|register|account|cart|checkout|privacy|terms|cookies?|legal|careers?|jobs|press|wp-admin|wp-login|feed|rss|\/tag\/|\/author\/|\/category\/|\.(?:pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|xml|json|css|js)$)/i;

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&ndash;': '–', '&mdash;': '—', '&hellip;': '…' };
const decode = (s) => String(s || '').replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp|rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
const squash = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const host = (u) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** A page address without #fragment, tracking parameters or trailing slash. */
export function normaliseUrl(u) {
  const x = new URL(u);
  x.hash = '';
  for (const k of [...x.searchParams.keys()]) if (/^(?:utm_|ref$|fbclid|gclid)/i.test(k)) x.searchParams.delete(k);
  let s = x.toString();
  if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1);
  return s;
}

function meta(html, re) {
  const m = html.match(re);
  return m ? squash(m[1]) : '';
}

/** Title, description, readable text and links of one HTML page. */
export function parsePage(html, pageUrl) {
  const h = String(html || '').slice(0, 1_500_000);
  const title = meta(h, /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i) || meta(h, /<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
  const description = meta(h, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || meta(h, /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const siteName = meta(h, /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i);
  const ogImage = meta(h, /<meta[^>]+property=["']og:image(?::url)?["'][^>]*content=["']([^"']*)["']/i);
  const clean = h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ');

  const links = [];
  for (const m of clean.matchAll(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]).trim();
    if (!href || /^(?:#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs;
    try {
      abs = normaliseUrl(new URL(href, pageUrl).toString());
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs)) continue;
    const label = squash(m[2]) || meta(m[0], /(?:title|aria-label)=["']([^"']+)["']/i);
    links.push({ url: abs, label: label.slice(0, 80) });
  }

  // Main text: the <main> element if there is one, without menus and footers.
  const body = (clean.match(/<main\b[\s\S]*?<\/main>/i) || clean.match(/<body\b[\s\S]*<\/body>/i) || [clean])[0]
    .replace(/<(nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:\/?(?:p|div|section|article|li|h[1-6]|tr|br|ul|ol|table)\b)[^>]*>/gi, '\n');
  const text = decode(body.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 1)
    .join('\n')
    .slice(0, 12000);
  return { title: title.slice(0, 200), description: description.slice(0, 400), siteName: siteName.slice(0, 100), ogImage, text, links };
}

/** Disallowed path prefixes for every robot ("User-agent: *") or ours. */
export function robotsRules(txt) {
  const rules = [];
  let applies = false;
  let inAgents = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const [k, ...rest] = line.split(':');
    const key = (k || '').trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      const mine = val === '*' || /blogsiteresearchbot/i.test(val);
      applies = inAgents ? applies || mine : mine;
      inAgents = true;
    } else if (key) {
      inAgents = false;
      if (applies && key === 'disallow' && val) rules.push(val.replace(/\*.*$/, ''));
    }
  }
  return rules;
}
const blocked = (rules, path) => rules.some((r) => r && path.startsWith(r));

/** How well a link describes something the website offers (0 = skip). */
function offerScore(link, origin) {
  const u = new URL(link.url);
  if (host(link.url) !== host(origin) || SKIP.test(u.pathname + u.search)) return 0;
  const depth = u.pathname.split('/').filter(Boolean).length;
  if (!depth || /\/blog\/./i.test(u.pathname)) return 0; // the home page, or single blog posts
  const words = (s) => (s.match(OFFER) || []).length;
  return words(u.pathname.replace(/[-_/]/g, ' ')) * 2 + words(link.label) + (depth === 1 ? 1 : 0);
}

/**
 * Reads a website: home page plus up to maxPages-1 pages about its offerings.
 * Returns { url, origin, domain, name, description, image, pages, links }.
 */
// Replaceable in tests (no network there).
export const _siteDeps = { fetch: safeFetch };

export async function readWebsite(rawUrl, { maxPages = 10, fetchPage = _siteDeps.fetch } = {}) {
  let start;
  try {
    start = new URL(rawUrl);
  } catch {
    throw new AiError('That website address is not valid.', { code: 'site_unreadable' });
  }
  const get = (u, bytes = 1_500_000) => fetchPage(u, { timeoutMs: 15000, maxBytes: bytes, userAgent: AGENT });

  let rules = [];
  try {
    const r = await get(`${start.origin}/robots.txt`, 200_000);
    if (r.status < 400) rules = robotsRules(r.body);
  } catch {
    /* no robots.txt: allowed */
  }
  if (blocked(rules, start.pathname || '/')) throw new AiError(`${start.hostname} asks robots not to read this page (robots.txt), so it was not used.`, { code: 'site_unreadable' });

  let home;
  try {
    home = await get(start.toString());
  } catch (err) {
    throw new AiError(`Could not open ${start.hostname}: ${err.message}`, { code: 'site_unreadable' });
  }
  if (home.status >= 400) throw new AiError(`${start.hostname} answered with error ${home.status}.`, { code: 'site_unreadable' });
  if (!/html/i.test(home.contentType)) throw new AiError(`${start.hostname} did not return a web page.`, { code: 'site_unreadable' });
  const origin = new URL(home.url).origin;
  const first = parsePage(home.body, home.url);
  if (first.text.length < 150) {
    throw new AiError(`${host(home.url)} shows almost no text without a browser (it is probably built with JavaScript only), so there is not enough to write from. Try one of its inner pages, or another site.`, { code: 'site_unreadable' });
  }

  const pages = [{ url: normaliseUrl(home.url), title: first.title, description: first.description, text: first.text }];
  const seen = new Map();
  for (const l of first.links) {
    const score = offerScore(l, origin);
    if (score > 0 && !seen.has(l.url)) seen.set(l.url, { ...l, score });
  }
  const candidates = [...seen.values()].sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (pages.length >= maxPages) break;
    if (blocked(rules, new URL(c.url).pathname)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await get(c.url);
      if (r.status >= 400 || !/html/i.test(r.contentType) || host(r.url) !== host(origin)) continue;
      const p = parsePage(r.body, r.url);
      if (p.text.length < 150 || pages.some((x) => x.url === normaliseUrl(r.url))) continue;
      pages.push({ url: normaliseUrl(r.url), title: p.title || c.label, description: p.description, text: p.text });
    } catch {
      /* skip pages that do not open */
    }
  }

  // Links the article may use: only pages that were read and work (no broken links).
  const links = pages.map((p) => ({ url: p.url, label: (p.title || '').slice(0, 80) }));

  let image = '';
  try {
    image = first.ogImage ? new URL(first.ogImage, home.url).toString() : '';
  } catch {
    image = '';
  }
  return {
    url: pages[0].url,
    origin,
    domain: host(origin),
    name: (first.siteName || first.title.split(/\s[|–—-]\s/)[0] || host(origin)).slice(0, 100),
    description: first.description,
    image: /^https:\/\//i.test(image) ? image : '',
    pages,
    links,
    readAt: new Date().toISOString(),
  };
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Controls the links a model wrote: links to this blog's own pages stay; links
 * to the website the article is about stay only if they are pages that were
 * read (so none are broken or made up), open in a new tab and are marked
 * rel="sponsored" for sponsored posts; every other outside link is removed
 * (its text is kept). Returns { html, removed, kept }.
 */
export function controlLinks(html, website, { sponsored = false } = {}) {
  const allowed = new Map();
  for (const l of website?.links || []) {
    try {
      allowed.set(normaliseUrl(l.url), l.url);
    } catch {
      /* skip */
    }
  }
  let removed = 0;
  let kept = 0;
  const out = String(html || '').replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs, text) => {
    const href = (attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (/^\/(?!\/)/.test(href)) return whole; // this blog's own page
    let key = '';
    try {
      key = normaliseUrl(new URL(href.replace(/&amp;/g, '&')).toString());
    } catch {
      key = '';
    }
    if (key && allowed.has(key)) {
      kept += 1;
      return `<a href="${escAttr(allowed.get(key))}" target="_blank" rel="noopener${sponsored ? ' sponsored' : ''}">${text}</a>`;
    }
    removed += 1;
    return text;
  });
  return { html: out, removed, kept };
}

/** The note added to an article about a website (and a disclosure for sponsored posts). */
export function websiteNotes(website, { sponsored = false, date = new Date() } = {}) {
  const d = date.toISOString().slice(0, 10);
  const link = `<a href="${escAttr(website.url)}" target="_blank" rel="noopener${sponsored ? ' sponsored' : ''}">${escAttr(website.domain)}</a>`;
  return {
    top: sponsored ? `<p><em>Disclosure: this is a sponsored article about ${escAttr(website.name)}. Links to ${escAttr(website.domain)} may earn us a commission.</em></p>` : '',
    bottom: `<p><em>This overview is based on information published on ${link} as of ${d}, plus the sources listed below. Check the website for current details and prices.</em></p>`,
  };
}
