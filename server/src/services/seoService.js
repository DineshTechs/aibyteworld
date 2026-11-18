import { Article, Category, SiteSettings, Tag, User } from '../models/index.js';

// Server-side SEO: sitemap, robots.txt, RSS, and per-page <head> tags with
// JSON-LD for the production build (so crawlers and social networks that do
// not run JavaScript still see titles, descriptions and structured data).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const visible = () => ({ status: 'published', publishedAt: { $lte: new Date() } });

export function siteBase(req, settings) {
  const configured = String(settings?.siteUrl || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

const absUrl = (base, u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`);

export async function buildSitemap(base) {
  const [articles, catIds, tagIds] = await Promise.all([
    Article.find({ ...visible(), 'seo.noindex': { $ne: true } }).select('slug updatedAt publishedAt featuredImage.url language translationOf').sort({ publishedAt: -1 }).limit(45000).lean(),
    Article.distinct('categories', visible()),
    Article.distinct('tags', visible()),
  ]);
  const [cats, tags] = await Promise.all([Category.find({ _id: { $in: catIds } }).select('slug updatedAt').lean(), Tag.find({ _id: { $in: tagIds } }).select('slug updatedAt').lean()]);
  const latest = articles[0]?.updatedAt;
  // Language versions of the same post list each other (hreflang).
  const groups = new Map();
  for (const a of articles) {
    const key = String(a.translationOf || a._id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const alternates = (a) => {
    const g = groups.get(String(a.translationOf || a._id)) || [];
    if (g.length < 2) return '';
    const original = g.find((x) => !x.translationOf);
    return [...g.map((x) => `<xhtml:link rel="alternate" hreflang="${x.translationOf ? x.language : 'en'}" href="${esc(`${base}/blog/${x.slug}`)}"/>`), original ? `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(`${base}/blog/${original.slug}`)}"/>` : ''].join('');
  };
  const url = (loc, lastmod, priority, image, extra = '') =>
    `<url><loc>${esc(base + loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}${priority ? `<priority>${priority}</priority>` : ''}${extra}${image ? `<image:image><image:loc>${esc(image)}</image:loc></image:image>` : ''}</url>`;
  const entries = [
    url('/', latest, '1.0'),
    url('/blog', latest, '0.8'),
    ...['/about', '/contact', '/privacy', '/terms'].map((p) => url(p, null, '0.3')),
    ...cats.map((c) => url(`/category/${c.slug}`, c.updatedAt, '0.6')),
    ...tags.map((t) => url(`/tag/${t.slug}`, t.updatedAt, '0.4')),
    ...articles.map((a) => url(`/blog/${a.slug}`, a.updatedAt, '0.7', absUrl(base, a.featuredImage?.url), alternates(a))),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
}

export function buildRobots(base, allowIndexing) {
  if (!allowIndexing) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /search\n\nSitemap: ${base}/sitemap.xml\n`;
}

export async function buildRss(base, settings) {
  const items = await Article.find({ ...visible(), translationOf: null })
    .select('title slug excerpt publishedAt categories author')
    .sort({ publishedAt: -1 })
    .limit(20)
    .populate('categories', 'name')
    .populate('author', 'name')
    .lean();
  const body = items
    .map(
      (a) => `<item><title>${esc(a.title)}</title><link>${esc(`${base}/blog/${a.slug}`)}</link><guid isPermaLink="true">${esc(`${base}/blog/${a.slug}`)}</guid><pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>${a.author ? `<dc:creator>${esc(a.author.name)}</dc:creator>` : ''}${(a.categories || []).map((c) => `<category>${esc(c.name)}</category>`).join('')}<description>${esc(a.excerpt)}</description></item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${esc(settings.siteName)}</title><link>${esc(base)}</link><description>${esc(settings.description || settings.tagline || settings.siteName)}</description><language>en</language><atom:link href="${esc(`${base}/rss.xml`)}" rel="self" type="application/rss+xml"/>\n${body}\n</channel></rss>\n`;
}

// Works out the head tags and HTTP status for a public URL.
export async function renderHead(pathname, base) {
  const settings = await SiteSettings.getSingleton();
  const site = settings.siteName;
  // The site as an organisation, with its logo and social profiles (used by search engines).
  const sameAs = Object.values(settings.social?.toObject ? settings.social.toObject() : settings.social || {}).filter((u) => /^https?:\/\//.test(u || ''));
  const org = { '@type': 'Organization', name: site, url: `${base}/`, logo: { '@type': 'ImageObject', url: `${base}/icon-512.png`, width: 512, height: 512 }, ...(sameAs.length ? { sameAs } : {}) };
  const twitterSite = (String(settings.social?.twitter || '').match(/(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/) || [])[1] || '';
  const head = {
    status: 200,
    title: settings.tagline ? `${site} – ${settings.tagline}` : site,
    description: settings.description || settings.tagline || '',
    canonical: `${base}${pathname}`,
    // Pages without their own photo are shared with the site's default image.
    image: `${base}/og-default.png`,
    imageWidth: 1200,
    imageHeight: 630,
    imageAlt: site,
    twitterSite,
    type: 'website',
    noindex: !settings.allowIndexing,
    ld: [],
    // Search Console and Bing Webmaster Tools ownership checks.
    googleVerification: settings.analytics?.googleVerification || '',
    bingVerification: settings.analytics?.bingVerification || '',
  };
  const path = pathname.replace(/\/+$/, '') || '/';
  let m;

  if (path === '/') {
    head.ld.push({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: site, url: `${base}/`, ...(head.description ? { description: head.description } : {}), inLanguage: 'en', publisher: { '@id': `${base}/#organization` }, potentialAction: { '@type': 'SearchAction', target: `${base}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } }, { ...org, '@id': `${base}/#organization` }] });
  } else if (path.startsWith('/admin')) {
    head.title = `Admin | ${site}`;
    head.noindex = true;
  } else if (path === '/search') {
    head.title = `Search | ${site}`;
    head.noindex = true;
  } else if (path === '/newsletter') {
    head.title = `Newsletter | ${site}`;
    head.noindex = true;
  } else if (path === '/blog') {
    head.title = `Blog | ${site}`;
  } else if ((m = path.match(/^\/blog\/([a-z0-9-]+)$/))) {
    const a = await Article.findOne({ ...visible(), slug: m[1] }).populate('author', 'name').populate('categories', 'name slug').lean();
    if (!a) return { ...head, status: 404, title: `Page not found | ${site}`, noindex: true, ld: [] };
    const url = `${base}/blog/${a.slug}`;
    const image = absUrl(base, a.featuredImage?.url);
    Object.assign(head, {
      title: `${a.seo?.title || a.title} | ${site}`,
      description: a.seo?.description || a.excerpt,
      ogTitle: a.seo?.ogTitle || a.seo?.title || a.title,
      ogDescription: a.seo?.ogDescription || a.seo?.description || a.excerpt,
      canonical: a.seo?.canonicalUrl || url,
      // A post without a cover photo is shared with the site's default image.
      image: image || head.image,
      imageAlt: image ? a.featuredImage?.alt || a.title : head.imageAlt,
      imageWidth: image ? a.featuredImage?.width || 0 : head.imageWidth,
      imageHeight: image ? a.featuredImage?.height || 0 : head.imageHeight,
      type: 'article',
      noindex: head.noindex || Boolean(a.seo?.noindex),
      publishedTime: a.publishedAt,
      modifiedTime: a.updatedAt,
      keywords: [a.seo?.focusKeyword, ...(a.seo?.secondaryKeywords || [])].filter(Boolean).join(', '),
      lang: a.translationOf ? a.language || 'en' : 'en',
    });
    // Other language versions (hreflang), with the English original as the default.
    const originalId = a.translationOf || a._id;
    const versions = await Article.find({ ...visible(), $or: [{ _id: originalId }, { translationOf: originalId }] }).select('slug language translationOf').lean();
    if (versions.length > 1) {
      head.alternates = versions.map((v) => ({ hreflang: v.translationOf ? v.language : 'en', href: `${base}/blog/${v.slug}` }));
      const original = versions.find((v) => !v.translationOf);
      if (original) head.alternates.push({ hreflang: 'x-default', href: `${base}/blog/${original.slug}` });
    }
    const cat = a.categories?.[0];
    const graph = [
      {
        '@type': 'Article',
        headline: a.title.slice(0, 110),
        inLanguage: head.lang,
        description: head.description,
        ...(image ? { image: [image] } : {}),
        datePublished: a.publishedAt,
        dateModified: a.updatedAt,
        ...(a.author ? { author: { '@type': 'Person', name: a.author.name, url: `${base}/author/${a.author._id}` } } : {}),
        publisher: org,
        mainEntityOfPage: url,
        ...(a.seo?.focusKeyword ? { keywords: head.keywords } : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${base}/blog` },
          ...(cat ? [{ '@type': 'ListItem', position: 3, name: cat.name, item: `${base}/category/${cat.slug}` }] : []),
          { '@type': 'ListItem', position: cat ? 4 : 3, name: a.title, item: url },
        ],
      },
    ];
    if ((a.seo?.faq || []).length >= 2) {
      graph.push({ '@type': 'FAQPage', mainEntity: a.seo.faq.map((q) => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } })) });
    }
    head.ld.push({ '@context': 'https://schema.org', '@graph': graph });
  } else if ((m = path.match(/^\/(category|tag)\/([a-z0-9-]+)$/))) {
    const Model = m[1] === 'category' ? Category : Tag;
    const doc = await Model.findOne({ slug: m[2] }).lean();
    if (!doc) return { ...head, status: 404, title: `Page not found | ${site}`, noindex: true, ld: [] };
    head.title = `${m[1] === 'tag' ? '#' : ''}${doc.name} | ${site}`;
    head.description = doc.description || `Articles about ${doc.name} on ${site}.`;
  } else if ((m = path.match(/^\/author\/([a-f0-9]{24})$/))) {
    const u = await User.findOne({ _id: m[1], active: true }).lean();
    if (!u) return { ...head, status: 404, title: `Page not found | ${site}`, noindex: true, ld: [] };
    head.title = `${u.name} | ${site}`;
    head.description = u.bio || `Articles by ${u.name}.`;
    head.ld.push({ '@context': 'https://schema.org', '@type': 'Person', name: u.name, url: `${base}/author/${u._id}` });
  } else if (['/about', '/contact', '/privacy', '/terms'].includes(path)) {
    head.title = `${{ '/about': 'About Us', '/contact': 'Contact Us', '/privacy': 'Privacy Policy', '/terms': 'Terms and Conditions' }[path]} | ${site}`;
  } else {
    return { ...head, status: 404, title: `Page not found | ${site}`, noindex: true, ld: [] };
  }
  return head;
}

export function headToHtml(h, siteName) {
  const tags = [
    `<title>${esc(h.title)}</title>`,
    h.googleVerification && `<meta name="google-site-verification" content="${esc(h.googleVerification)}" />`,
    h.bingVerification && `<meta name="msvalidate.01" content="${esc(h.bingVerification)}" />`,
    h.description && `<meta name="description" content="${esc(h.description)}" />`,
    h.noindex ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />',
    h.status === 200 && `<link rel="canonical" href="${esc(h.canonical)}" />`,
    ...(h.status === 200 && !h.noindex ? (h.alternates || []).map((x) => `<link rel="alternate" hreflang="${esc(x.hreflang)}" href="${esc(x.href)}" />`) : []),
    `<meta property="og:site_name" content="${esc(siteName)}" />`,
    `<meta property="og:type" content="${h.type}" />`,
    h.lang === 'hi' && '<meta property="og:locale" content="hi_IN" />',
    `<meta property="og:title" content="${esc(h.ogTitle || h.title)}" />`,
    h.description && `<meta property="og:description" content="${esc(h.ogDescription || h.description)}" />`,
    `<meta property="og:url" content="${esc(h.canonical)}" />`,
    h.image && `<meta property="og:image" content="${esc(h.image)}" />`,
    h.image && h.imageAlt && `<meta property="og:image:alt" content="${esc(h.imageAlt)}" />`,
    h.image && h.imageWidth > 0 && `<meta property="og:image:width" content="${Number(h.imageWidth)}" />`,
    h.image && h.imageHeight > 0 && `<meta property="og:image:height" content="${Number(h.imageHeight)}" />`,
    h.publishedTime && `<meta property="article:published_time" content="${new Date(h.publishedTime).toISOString()}" />`,
    h.modifiedTime && `<meta property="article:modified_time" content="${new Date(h.modifiedTime).toISOString()}" />`,
    `<meta name="twitter:card" content="${h.image ? 'summary_large_image' : 'summary'}" />`,
    h.twitterSite && `<meta name="twitter:site" content="@${esc(h.twitterSite)}" />`,
    `<meta name="twitter:title" content="${esc(h.ogTitle || h.title)}" />`,
    h.description && `<meta name="twitter:description" content="${esc(h.ogDescription || h.description)}" />`,
    h.image && `<meta name="twitter:image" content="${esc(h.image)}" />`,
    ...h.ld.map((obj) => `<script type="application/ld+json" id="page-jsonld">${jsonLd(obj)}</script>`),
  ];
  return tags.filter(Boolean).join('\n    ');
}
