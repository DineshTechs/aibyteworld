import { useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';

interface SeoProps {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  image?: string;
  canonical?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
  lang?: string;
  alternates?: { hreflang: string; href: string }[];
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!content) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// Sets the document title and per-page meta tags (description, canonical,
// Open Graph, Twitter card, robots, JSON-LD).
export function Seo({ title, description, ogTitle, ogDescription, image, canonical, type = 'website', noindex, jsonLd, lang = 'en', alternates }: SeoProps) {
  const { settings } = useSettings();
  const jsonLdText = jsonLd ? JSON.stringify(jsonLd) : '';
  const altText = alternates ? JSON.stringify(alternates) : '';

  useEffect(() => {
    const fullTitle = title ? `${title} | ${settings.siteName}` : settings.tagline ? `${settings.siteName} – ${settings.tagline}` : settings.siteName;
    const desc = description || settings.description;
    const origin = settings.siteUrl || window.location.origin;
    const url = canonical || `${origin}${window.location.pathname}`;
    const img = image ? (image.startsWith('http') ? image : `${origin}${image}`) : '';

    document.title = fullTitle;
    setMeta('name', 'description', desc);
    setMeta('name', 'robots', noindex || !settings.allowIndexing ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    document.documentElement.lang = lang;
    setMeta('property', 'og:locale', lang === 'hi' ? 'hi_IN' : '');
    // Other language versions of this page (hreflang).
    document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove());
    if (altText && !noindex) {
      for (const a of JSON.parse(altText) as { hreflang: string; href: string }[]) {
        const l = document.createElement('link');
        l.rel = 'alternate';
        l.hreflang = a.hreflang;
        l.href = a.href;
        document.head.appendChild(l);
      }
    }
    setMeta('property', 'og:title', ogTitle || fullTitle);
    setMeta('property', 'og:description', ogDescription || desc);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:site_name', settings.siteName);
    setMeta('property', 'og:image', img);
    setMeta('name', 'twitter:card', img ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', ogTitle || fullTitle);
    setMeta('name', 'twitter:description', ogDescription || desc);
    setMeta('name', 'twitter:image', img);

    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = url;

    document.querySelectorAll('script#page-jsonld').forEach((el) => el.remove());
    if (jsonLdText) {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.id = 'page-jsonld';
      s.textContent = jsonLdText;
      document.head.appendChild(s);
    }
  }, [title, description, ogTitle, ogDescription, image, canonical, type, noindex, jsonLdText, settings, lang, altText]);

  return null;
}
