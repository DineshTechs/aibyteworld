import { AiError } from '../ai/errors.js';
import { requestJson } from '../ai/http.js';

// Free stock photo libraries. Each search returns photos with the credit the
// library asks for: { id, url, width, height, alt, credit: { name, profileUrl,
// source, sourceUrl, pageUrl }, hotlink, downloadLocation }.
// hotlink: true means the library requires its own image URL to be used
// (Unsplash); the others are downloaded and served from /uploads.

// Libraries such as Wikimedia Commons also hold AI-generated pictures; this
// site uses real photos only, so anything that says it was made by AI is skipped.
export const AI_MADE = /dall[·.\-\s]?e|midjourney|stable[ -]?diffusion|ai[- ]generated|generated (by|with|using) (an? )?(ai|artificial intelligence)|adobe firefly|\bimagen\b|text-to-image/i;

const keyError = (name) => new AiError(`No ${name} API key is configured. Add one in AI Providers.`, { code: 'no_key' });
const q = (s) => encodeURIComponent(String(s || '').slice(0, 100));

// ---------- Pexels: https://www.pexels.com/api/documentation/ ----------
export const pexels = {
  kind: 'stock',
  async search({ apiKey, query, perPage = 10 }) {
    if (!apiKey) throw keyError('Pexels');
    const data = await requestJson('Pexels', `https://api.pexels.com/v1/search?query=${q(query)}&orientation=landscape&size=medium&per_page=${perPage}`, {
      headers: { Authorization: apiKey },
      timeoutMs: 20000,
    });
    return (data?.photos || []).map((p) => ({
      id: `pexels-${p.id}`,
      url: p.src?.landscape || p.src?.large2x || p.src?.large,
      width: p.src?.landscape ? 1200 : p.width,
      height: p.src?.landscape ? 627 : p.height,
      alt: p.alt || '',
      credit: { name: p.photographer || 'Pexels photographer', profileUrl: p.photographer_url || '', source: 'Pexels', sourceUrl: 'https://www.pexels.com', pageUrl: p.url || '' },
      hotlink: false,
    }));
  },
  async testConnection({ apiKey }) {
    await this.search({ apiKey, query: 'technology', perPage: 1 });
    return { ok: true, message: 'Key works. Pexels allows 200 searches an hour on the free plan.' };
  },
};

// ---------- Unsplash: https://unsplash.com/documentation ----------
// The API guidelines require hotlinking photo.urls.*, triggering
// links.download_location when a photo is used, and crediting the
// photographer and Unsplash with referral links.
export const unsplash = {
  kind: 'stock',
  async search({ apiKey, query, perPage = 10, appName = 'blogsite' }) {
    if (!apiKey) throw keyError('Unsplash');
    const data = await requestJson('Unsplash', `https://api.unsplash.com/search/photos?query=${q(query)}&orientation=landscape&content_filter=high&per_page=${perPage}`, {
      headers: { Authorization: `Client-ID ${apiKey}`, 'Accept-Version': 'v1' },
      timeoutMs: 20000,
      // Unsplash answers 403 "Rate Limit Exceeded" when the hourly limit is used up.
      mapError: (res, _d, msg) => (/rate limit/i.test(msg) || res.headers.get('x-ratelimit-remaining') === '0' ? new AiError(`Unsplash hourly limit reached: ${msg}`, { status: res.status, retryable: true, code: 'rate_limit', retryAfterMs: 15 * 60 * 1000 }) : null),
    });
    const ref = `utm_source=${encodeURIComponent(appName)}&utm_medium=referral`;
    return (data?.results || []).map((p) => {
      const w = p.width || 1600;
      const h = p.height || 1067;
      return {
        id: `unsplash-${p.id}`,
        url: `${p.urls?.raw || p.urls?.regular}${(p.urls?.raw || p.urls?.regular || '').includes('?') ? '&' : '?'}w=1600&fit=max&q=80&auto=format`,
        width: Math.min(1600, w),
        height: Math.round((Math.min(1600, w) * h) / w),
        alt: p.alt_description || p.description || '',
        credit: { name: p.user?.name || 'Unsplash photographer', profileUrl: p.user?.links?.html ? `${p.user.links.html}?${ref}` : '', source: 'Unsplash', sourceUrl: `https://unsplash.com/?${ref}`, pageUrl: p.links?.html || '' },
        hotlink: true,
        downloadLocation: p.links?.download_location || '',
      };
    });
  },
  // Required by the Unsplash guidelines when a photo is used in a post.
  async trackDownload({ apiKey, downloadLocation }) {
    if (!downloadLocation?.startsWith('https://api.unsplash.com/')) return;
    await requestJson('Unsplash', downloadLocation, { headers: { Authorization: `Client-ID ${apiKey}` }, timeoutMs: 15000 }).catch(() => {});
  },
  async testConnection({ apiKey }) {
    await this.search({ apiKey, query: 'technology', perPage: 1 });
    return { ok: true, message: 'Key works. Demo apps get 50 requests an hour; apply for production on unsplash.com/developers for more.' };
  },
};

// ---------- Openverse: https://api.openverse.org/v1/ ----------
// Openly licensed images (Flickr, Wikimedia Commons, museums...). No key needed.
// Only licences that allow commercial use are requested; each photo is credited
// with title, creator, source and licence, as Creative Commons licences require.
const CC_NAMES = { cc0: 'CC0', pdm: 'Public Domain Mark', by: 'CC BY', 'by-sa': 'CC BY-SA', 'by-nd': 'CC BY-ND' };
export const openverse = {
  kind: 'stock',
  async search({ query, perPage = 10 }) {
    // No size filter: "large" leaves very few results, mostly huge originals.
    const run = (text) =>
      requestJson('Openverse', `https://api.openverse.org/v1/images/?q=${q(text)}&license_type=commercial&aspect_ratio=wide&mature=false&page_size=20`, {
        headers: { 'User-Agent': 'blogsite/1.0 (blog image search)' },
        timeoutMs: 25000,
      });
    const pick = (data) =>
      (data?.results || [])
        .filter((p) => CC_NAMES[String(p.license || '').toLowerCase()] && /^https:\/\//.test(p.url || '') && (!p.filesize || p.filesize < 9_000_000) && !AI_MADE.test(`${p.title || ''} ${(p.tags || []).map((t) => t.name).join(' ')}`))
        // Wikimedia originals are often very large and refuse automated downloads: try them last.
        .sort((a, b) => Number(/wikimedia/i.test(a.source || '')) - Number(/wikimedia/i.test(b.source || '')));
    let results = pick(await run(query));
    const short = String(query).trim().split(/\s+/).slice(0, 2).join(' ');
    if (!results.length && short && short !== String(query).trim()) results = pick(await run(short)); // broader search
    return results.slice(0, perPage + 5).map((p) => {
      const lic = String(p.license).toLowerCase();
      const source = String(p.source || p.provider || 'Openverse').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        id: `openverse-${p.id}`,
        url: p.url,
        width: p.width || 0,
        height: p.height || 0,
        alt: '', // titles are often file names; the article's own alt text is used
        // Words that describe the photo, checked against the search (see photoFits).
        open: true,
        keywords: [p.title, ...(p.tags || []).map((t) => t.name)].join(' ').slice(0, 1000),
        credit: {
          name: p.creator || 'Unknown creator',
          profileUrl: p.creator_url || '',
          source,
          sourceUrl: p.foreign_landing_url || '',
          pageUrl: p.foreign_landing_url || '',
          title: String(p.title || '').slice(0, 120),
          license: `${CC_NAMES[lic]}${p.license_version && !['cc0', 'pdm'].includes(lic) ? ` ${p.license_version}` : ''}`,
          licenseUrl: p.license_url || '',
        },
        hotlink: false,
      };
    });
  },
  async testConnection() {
    const r = await this.search({ query: 'technology', perPage: 5 });
    return { ok: true, message: `Openverse works (no key needed). ${r.length} openly licensed photos found for a test search.` };
  },
};

// ---------- Pixabay: https://pixabay.com/api/docs/ ----------
// Permanent hotlinking is not allowed, so photos are downloaded.
export const pixabay = {
  kind: 'stock',
  async search({ apiKey, query, perPage = 10 }) {
    if (!apiKey) throw keyError('Pixabay');
    const data = await requestJson('Pixabay', `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${q(query)}&image_type=photo&orientation=horizontal&safesearch=true&min_width=1200&per_page=${Math.max(3, perPage)}`, {
      timeoutMs: 20000,
      mapError: (res, _d, msg) => (res.status === 400 && /key/i.test(msg) ? new AiError(`Pixabay rejected the API key: ${msg}`, { status: 400, code: 'auth' }) : null),
    });
    return (data?.hits || []).map((p) => ({
      id: `pixabay-${p.id}`,
      url: p.largeImageURL || p.webformatURL,
      width: p.largeImageURL ? Math.min(1280, p.imageWidth || 1280) : p.webformatWidth,
      height: p.largeImageURL ? Math.round((Math.min(1280, p.imageWidth || 1280) * (p.imageHeight || 720)) / (p.imageWidth || 1280)) : p.webformatHeight,
      alt: String(p.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4).join(', '),
      credit: { name: p.user || 'Pixabay contributor', profileUrl: p.user && p.user_id ? `https://pixabay.com/users/${encodeURIComponent(p.user)}-${p.user_id}/` : '', source: 'Pixabay', sourceUrl: 'https://pixabay.com', pageUrl: p.pageURL || '' },
      hotlink: false,
    }));
  },
  async testConnection({ apiKey }) {
    await this.search({ apiKey, query: 'technology', perPage: 3 });
    return { ok: true, message: 'Key works. Pixabay allows 100 requests a minute.' };
  },
};

// Wikimedia asks every program to name itself with a way to contact its owner.
export const wikimediaAgent = (contact) => `BlogSitePhotoSearch/1.0 (${contact || 'self-hosted blog'}) Node.js`;
const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- Wikimedia Commons: https://commons.wikimedia.org/w/api.php ----------
// Millions of freely licensed photos. No key. Only CC0, public domain, CC BY and
// CC BY-SA files without extra restrictions (such as trademarks or personality
// rights) are used, and each is credited with title, author and licence.
// A 1280 px copy (one of Wikimedia's standard sizes) is downloaded once.
const WM_LICENCE = /^(cc0|public domain|pd\b|pdm|cc[ -]by(-sa)?[ -]\d)/i;
export const wikimedia = {
  kind: 'stock',
  async search({ query, perPage = 10, contact }) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: `${String(query || '').slice(0, 100)} filetype:bitmap`,
      gsrnamespace: '6',
      gsrlimit: '25',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1280',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName|ImageDescription|Categories|Restrictions|NonFree',
    });
    const data = await requestJson('Wikimedia Commons', `https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': wikimediaAgent(contact), 'Api-User-Agent': wikimediaAgent(contact) },
      timeoutMs: 20000,
    });
    const meta = (ii, k) => stripTags(ii?.extmetadata?.[k]?.value);
    return (data?.query?.pages || [])
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => ({ p, ii: p.imageinfo?.[0] }))
      .filter(({ ii }) => ii && /^image\/(jpeg|png|webp)$/.test(ii.mime) && ii.width >= 1000 && ii.width >= ii.height * 1.2)
      .filter(({ p, ii }) => !AI_MADE.test([p.title, meta(ii, 'ObjectName'), meta(ii, 'ImageDescription'), meta(ii, 'Categories')].join(' ')))
      .filter(({ ii }) => WM_LICENCE.test(meta(ii, 'LicenseShortName')) && !/\bnc\b|\bnd\b/i.test(meta(ii, 'LicenseShortName')) && !meta(ii, 'Restrictions') && !/true/i.test(meta(ii, 'NonFree')))
      .slice(0, perPage + 5)
      .map(({ p, ii }) => {
        const title = (meta(ii, 'ObjectName') || String(p.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')).slice(0, 120);
        return {
          id: `wikimedia-${p.pageid}`,
          url: ii.thumburl || ii.url,
          width: Math.min(ii.thumbwidth || ii.width, ii.width),
          height: ii.thumbwidth && ii.thumbwidth < ii.width ? ii.thumbheight : ii.height,
          alt: '',
          open: true,
          keywords: [title, meta(ii, 'ImageDescription'), meta(ii, 'Categories')].join(' ').slice(0, 1000),
          credit: {
            name: meta(ii, 'Artist').slice(0, 100) || 'Unknown author',
            profileUrl: '',
            source: 'Wikimedia Commons',
            sourceUrl: 'https://commons.wikimedia.org',
            pageUrl: ii.descriptionurl || '',
            title,
            license: meta(ii, 'LicenseShortName').replace(/^pd\b.*$/i, 'Public domain'),
            licenseUrl: meta(ii, 'LicenseUrl'),
          },
          hotlink: false,
          userAgent: wikimediaAgent(contact),
        };
      });
  },
  async testConnection({ contact } = {}) {
    const r = await this.search({ query: 'computer', perPage: 5, contact });
    return { ok: true, message: `Wikimedia Commons works (no key needed). ${r.length} freely licensed photos found for a test search.` };
  },
};

// ---------- NASA Image and Video Library: https://images.nasa.gov ----------
// No key. NASA's own photos are generally not copyrighted; anything credited
// to a news agency or marked as copyrighted is skipped. Best for space,
// science and engineering topics, so it is tried last.
const NASA_SKIP = /©|copyright|getty|associated press|\bap photo|reuters|afp\b|courtesy of/i;
export const nasa = {
  kind: 'stock',
  async search({ query, perPage = 10 }) {
    const data = await requestJson('NASA Images', `https://images-api.nasa.gov/search?q=${q(query)}&media_type=image&page_size=25`, { timeoutMs: 20000 });
    return (data?.collection?.items || [])
      // Each item lists its copies; the ~1920 px "large" one suits a blog.
      .map((it) => {
        const links = it.links || [];
        const large = links.find((l) => /~large\.(jpe?g|png)$/i.test(l.href || ''))?.href;
        const thumb = links.find((l) => l.rel === 'preview' || /~thumb\./.test(l.href || ''))?.href || '';
        return { d: it.data?.[0] || {}, href: large || thumb.replace(/~thumb\.(jpe?g|png)$/i, '~large.$1') };
      })
      .filter(({ d, href }) => d.nasa_id && /^https:\/\/images-assets\.nasa\.gov\//.test(href) && !NASA_SKIP.test([d.description, d.photographer, d.secondary_creator, d.title].join(' ')) && !AI_MADE.test([d.description, d.title].join(' ')))
      .slice(0, perPage + 5)
      .map(({ d, href }) => ({
        id: `nasa-${d.nasa_id}`,
        url: href,
        width: 0, // known after download
        height: 0,
        sizeUnknown: true,
        alt: '',
        open: true,
        keywords: stripTags([d.title, d.description, ...(d.keywords || [])].join(' ')).slice(0, 1000),
        credit: { name: stripTags(d.photographer || d.secondary_creator || `NASA${d.center ? ` ${d.center}` : ''}`).slice(0, 100), profileUrl: '', source: 'NASA', sourceUrl: 'https://images.nasa.gov', pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}` },
        hotlink: false,
      }));
  },
  async testConnection() {
    const r = await this.search({ query: 'satellite', perPage: 5 });
    return { ok: true, message: `NASA Images works (no key needed). ${r.length} photos found for a test search.` };
  },
};
