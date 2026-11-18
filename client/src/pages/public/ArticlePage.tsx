import DOMPurify from 'dompurify';
import { AuthorLinks } from '../../components/AuthorLinks';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArticleCard, ArticleMeta, ArticleRow, srcSetOf } from '../../components/ArticleCard';
import { Seo } from '../../components/Seo';
import { ErrorState, PROSE, Spinner, TagChip, formatDate } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { useFetch } from '../../hooks/useFetch';
import { api } from '../../services/api';
import { trackArticle } from '../../services/analytics';
import type { Article, ArticleCardData } from '../../types';
import NotFoundPage from './NotFoundPage';

interface ArticleResponse {
  article: Article;
  related: ArticleCardData[];
  popular?: ArticleCardData[];
  previous: { title: string; slug: string } | null;
  next: { title: string; slug: string } | null;
  translations?: { _id: string; title: string; slug: string; language: string }[];
}

const READ_IN: Record<string, string> = { en: 'Read in English', hi: 'हिन्दी में पढ़ें' };

// A thin bar at the top of the screen that fills as the reader scrolls through the post.
function ReadingProgress({ target }: { target: RefObject<HTMLElement> }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = target.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      setPct(total <= 0 ? 100 : Math.min(100, Math.max(0, (-rect.top / total) * 100)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1" aria-hidden>
      <div className="h-full bg-brand-600 transition-[width] duration-150 ease-out dark:bg-brand-400" style={{ width: `${pct}%` }} />
    </div>
  );
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

// Sanitizes the stored HTML again in the browser, gives each heading an id and
// returns the table of contents.
export function prepareContent(rawHtml: string): { html: string; toc: TocItem[] } {
  const clean = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] });
  const doc = new DOMParser().parseFromString(`<div id="root">${clean}</div>`, 'text/html');
  const root = doc.getElementById('root');
  const toc: TocItem[] = [];
  const used = new Set<string>();
  root?.querySelectorAll('h2, h3').forEach((h) => {
    const text = (h.textContent || '').trim();
    if (!text) return;
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';
    let id = base;
    for (let i = 2; used.has(id); i += 1) id = `${base}-${i}`;
    used.add(id);
    h.id = id;
    toc.push({ id, text, level: h.tagName === 'H2' ? 2 : 3 });
  });
  return { html: root?.innerHTML || '', toc };
}

function ShareLinks({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    { name: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}` },
    { name: 'Telegram', href: `https://t.me/share/url?url=${u}&text=${t}` },
    { name: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: 'Email', href: `mailto:?subject=${t}&body=${u}` },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const nativeShare = async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      /* the reader closed the share sheet */
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-stone-500">Share:</span>
      {canShare && (
        <button type="button" className="btn btn-sm btn-primary" onClick={nativeShare}>
          Share…
        </button>
      )}
      {links.map((l) => (
        <a key={l.name} href={l.href} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
          {l.name}
        </a>
      ))}
      <button type="button" className="btn btn-sm" onClick={copy}>
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  );
}

export default function ArticlePage() {
  const { slug } = useParams();
  const { settings } = useSettings();
  const { data, error, status, loading, reload } = useFetch(() => api.get<ArticleResponse>(`/public/articles/${slug}`), [slug]);
  const prepared = useMemo(() => prepareContent(data?.article.content || ''), [data?.article.content]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const articleId = data?.article._id;
  const readingTime = data?.article.readingTime || 1;
  const trackingOn = settings.analytics?.enabled !== false;

  // Counts the visit and whether the post was actually read (see services/analytics.ts).
  useEffect(() => {
    if (!articleId || !trackingOn) return undefined;
    return trackArticle(articleId, readingTime, bodyRef.current);
  }, [articleId, readingTime, trackingOn]);

  if (status === 404) return <NotFoundPage />;
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error || 'Could not load this article'} onRetry={reload} />;

  const { article, related, popular = [], previous, next, translations = [] } = data;
  const origin = settings.siteUrl || window.location.origin;
  const url = `${origin}/blog/${article.slug}`;
  const category = article.categories[0];
  const image = article.featuredImage?.url;
  const lang = article.language || 'en';
  const alternates = translations.length
    ? [
        { hreflang: lang, href: url },
        ...translations.map((x) => ({ hreflang: x.language || 'en', href: `${origin}/blog/${x.slug}` })),
        { hreflang: 'x-default', href: lang === 'en' ? url : `${origin}/blog/${translations.find((x) => (x.language || 'en') === 'en')?.slug || article.slug}` },
      ]
    : undefined;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: article.title,
        description: article.seo?.description || article.excerpt,
        image: image ? [image.startsWith('http') ? image : `${origin}${image}`] : undefined,
        datePublished: article.publishedAt,
        dateModified: article.updatedAt,
        inLanguage: lang,
        author: article.author ? { '@type': 'Person', name: article.author.name, url: `${origin}/author/${article.author._id}` } : undefined,
        publisher: { '@type': 'Organization', name: settings.siteName },
        mainEntityOfPage: url,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${origin}/blog` },
          ...(category ? [{ '@type': 'ListItem', position: 3, name: category.name, item: `${origin}/category/${category.slug}` }] : []),
          { '@type': 'ListItem', position: category ? 4 : 3, name: article.title, item: url },
        ],
      },
      ...((article.seo?.faq?.length || 0) >= 2
        ? [
            {
              '@type': 'FAQPage',
              mainEntity: article.seo!.faq!.map((q) => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } })),
            },
          ]
        : []),
    ],
  };

  return (
    <div className="container-page py-8">
      <Seo
        title={article.seo?.title || article.title}
        description={article.seo?.description || article.excerpt}
        ogTitle={article.seo?.ogTitle || undefined}
        ogDescription={article.seo?.ogDescription || undefined}
        image={image}
        canonical={article.seo?.canonicalUrl || url}
        type="article"
        noindex={article.seo?.noindex}
        jsonLd={jsonLd}
        lang={lang}
        alternates={alternates}
      />
      <ReadingProgress target={bodyRef} />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone-500">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="hover:text-brand-700">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link to="/blog" className="hover:text-brand-700">
              Blog
            </Link>
          </li>
          {category && (
            <>
              <li aria-hidden>/</li>
              <li>
                <Link to={`/category/${category.slug}`} className="hover:text-brand-700">
                  {category.name}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden>/</li>
          <li aria-current="page" className="max-w-[16rem] truncate text-stone-700 dark:text-stone-300">
            {article.title}
          </li>
        </ol>
      </nav>

      <article lang={lang}>
        <header className="mx-auto max-w-3xl">
          <div className="mb-3 flex flex-wrap gap-2">
            {article.categories.map((c) => (
              <Link key={c._id} to={`/category/${c.slug}`} className="text-xs font-semibold uppercase tracking-wider text-brand-700 hover:underline dark:text-brand-300">
                {c.name}
              </Link>
            ))}
          </div>
          <h1 className="text-3xl font-bold leading-tight text-stone-900 dark:text-stone-50 sm:text-5xl">{article.title}</h1>
          {article.excerpt && <p className="mt-4 text-lg text-stone-600 dark:text-stone-400">{article.excerpt}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <ArticleMeta article={article} />
            {article.refreshedAt && (
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Updated <time dateTime={article.refreshedAt}>{formatDate(article.refreshedAt)}</time>
              </p>
            )}
            {translations.map((x) => (
              <Link key={x._id} to={`/blog/${x.slug}`} hrefLang={x.language} lang={x.language} className="badge bg-brand-50 text-brand-800 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-200">
                {READ_IN[x.language] || x.title}
              </Link>
            ))}
          </div>
        </header>

        {image && (
          <figure className="mx-auto mt-8 max-w-5xl">
            <img src={image} srcSet={srcSetOf(article.featuredImage.variants)} sizes="(min-width: 1024px) 1024px, 100vw" alt={article.featuredImage.alt || article.title} width={article.featuredImage.width || 1600} height={article.featuredImage.height || 800} fetchPriority="high" className="aspect-[16/8] w-full rounded-2xl object-cover" />
            {article.featuredImage.credit && (
              // Credit HTML is generated and sanitized on the server ("Photo by X on Unsplash").
              <figcaption className="mt-2 text-right text-xs text-stone-500 [&_a]:underline" dangerouslySetInnerHTML={{ __html: article.featuredImage.credit }} />
            )}
          </figure>
        )}

        <div className="mx-auto mt-10 grid max-w-5xl gap-10 lg:grid-cols-[1fr_16rem]">
          <div className="min-w-0">
            <div ref={bodyRef} className={PROSE} dangerouslySetInnerHTML={{ __html: prepared.html }} />

            {article.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-2">
                {article.tags.map((t) => (
                  <TagChip key={t._id} slug={t.slug} name={t.name} />
                ))}
              </div>
            )}

            <div className="mt-8 border-y border-stone-200 py-5 dark:border-stone-800">
              <ShareLinks title={article.title} url={url} />
            </div>

            {article.author && (
              <aside className="card mt-8 flex gap-4 p-5" aria-label="About the author">
                {article.author.avatarUrl ? (
                  <img src={article.author.avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 font-serif text-2xl text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" aria-hidden>
                    {article.author.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-xs uppercase tracking-wider text-stone-500">Written by</p>
                  <Link to={`/author/${article.author._id}`} className="font-serif text-lg font-semibold text-stone-900 hover:text-brand-700 dark:text-stone-50">
                    {article.author.name}
                  </Link>
                  {article.author.jobTitle && <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{article.author.jobTitle}</p>}
                  {article.author.bio && <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{article.author.bio}</p>}
                  <AuthorLinks links={article.author.links} className="mt-2" />
                </div>
              </aside>
            )}

            {(previous || next) && (
              <nav className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="More articles">
                {previous ? (
                  <Link to={`/blog/${previous.slug}`} className="card p-4 transition hover:border-brand-500">
                    <span className="text-xs text-stone-500">← Previous article</span>
                    <span className="mt-1 block font-serif font-semibold">{previous.title}</span>
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link to={`/blog/${next.slug}`} className="card p-4 text-right transition hover:border-brand-500">
                    <span className="text-xs text-stone-500">Next article →</span>
                    <span className="mt-1 block font-serif font-semibold">{next.title}</span>
                  </Link>
                )}
              </nav>
            )}
          </div>

          {prepared.toc.length > 1 && (
            <aside className="order-first lg:order-none">
              <nav className="card p-5 lg:sticky lg:top-24" aria-label="Table of contents">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-500">In this article</p>
                <ul className="space-y-2 text-sm">
                  {prepared.toc.map((item) => (
                    <li key={item.id} className={item.level === 3 ? 'pl-4' : ''}>
                      <a href={`#${item.id}`} className="text-stone-600 hover:text-brand-700 dark:text-stone-300 dark:hover:text-brand-300">
                        {item.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          )}
        </div>
      </article>

      {popular.length > 0 && (
        <section className="mt-16" aria-label="Most read articles">
          <h2 className="mb-2 border-b border-stone-200 pb-2 text-2xl font-semibold text-stone-900 dark:border-stone-800 dark:text-stone-50">Most read</h2>
          <ol className="grid gap-x-8 divide-y divide-stone-200 dark:divide-stone-800 sm:grid-cols-2 sm:divide-y-0">
            {popular.map((a, i) => (
              <ArticleRow key={a._id} article={a} rank={i + 1} />
            ))}
          </ol>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-5 border-b border-stone-200 pb-2 text-2xl font-semibold text-stone-900 dark:border-stone-800 dark:text-stone-50">Related articles</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((a) => (
              <ArticleCard key={a._id} article={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
