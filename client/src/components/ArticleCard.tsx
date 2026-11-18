import { Link } from 'react-router-dom';
import type { ArticleCardData } from '../types';
import { formatDate } from './ui';

// "url 480w, url 960w, …" for the browser to pick the right size.
export const srcSetOf = (variants?: { width: number; url: string }[]) => (variants?.length ? variants.map((v) => `${v.url} ${v.width}w`).join(', ') : undefined);

export function ArticleMeta({ article }: { article: ArticleCardData }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500 dark:text-stone-400">
      {article.author && (
        <Link to={`/author/${article.author._id}`} className="font-medium text-stone-700 hover:text-brand-700 dark:text-stone-300">
          {article.author.name}
        </Link>
      )}
      {article.author && <span aria-hidden>·</span>}
      <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
      <span aria-hidden>·</span>
      <span>{article.readingTime} min read</span>
    </p>
  );
}

// The large lead card is the first thing visitors see, so its photo loads
// straight away (faster first paint, better Core Web Vitals); others load lazily.
function Thumb({ article, className, eager }: { article: ArticleCardData; className: string; eager?: boolean }) {
  const img = article.featuredImage;
  return img?.url ? (
    <img
      src={img.url}
      srcSet={srcSetOf(img.variants)}
      sizes={eager ? '(min-width: 1024px) 66vw, 100vw' : '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'}
      alt={img.alt || article.title}
      width={img.width || undefined}
      height={img.height || undefined}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      className={`${className} object-cover`}
    />
  ) : (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-brand-100 to-stone-200 font-serif text-4xl text-brand-700/60 dark:from-brand-900/40 dark:to-stone-800 dark:text-brand-300/50`} aria-hidden>
      {article.title.charAt(0).toUpperCase()}
    </div>
  );
}

export function ArticleCard({ article, large }: { article: ArticleCardData; large?: boolean }) {
  const category = article.categories[0];
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-lg dark:border-stone-800 dark:bg-stone-900">
      <Link to={`/blog/${article.slug}`} className="block overflow-hidden" tabIndex={-1} aria-hidden>
        <Thumb article={article} eager={large} className={`w-full transition duration-500 group-hover:scale-[1.03] ${large ? 'aspect-[16/9]' : 'aspect-[16/10]'}`} />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        {category && (
          <Link to={`/category/${category.slug}`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-700 hover:underline dark:text-brand-300">
            {category.name}
          </Link>
        )}
        <h3 className={`font-serif font-semibold leading-snug text-stone-900 dark:text-stone-50 ${large ? 'text-2xl sm:text-3xl' : 'text-xl'}`}>
          <Link to={`/blog/${article.slug}`} className="hover:text-brand-700 dark:hover:text-brand-300">
            {article.title}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{article.excerpt}</p>
        <div className="mt-4">
          <ArticleMeta article={article} />
        </div>
      </div>
    </article>
  );
}

export function ArticleRow({ article, rank, note }: { article: ArticleCardData; rank?: number; note?: string }) {
  return (
    <li className="flex gap-3 py-3">
      {rank !== undefined && <span className="w-6 shrink-0 font-serif text-2xl leading-none text-stone-300 dark:text-stone-600">{rank}</span>}
      <div>
        <Link to={`/blog/${article.slug}`} className="font-serif font-semibold leading-snug text-stone-900 hover:text-brand-700 dark:text-stone-100 dark:hover:text-brand-300">
          {article.title}
        </Link>
        <p className="mt-1 text-xs text-stone-500">
          {note || `${formatDate(article.publishedAt)} · ${article.readingTime} min read`}
        </p>
      </div>
    </li>
  );
}
