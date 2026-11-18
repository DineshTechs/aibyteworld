import { useParams, useSearchParams } from 'react-router-dom';
import { ArticleCard } from '../../components/ArticleCard';
import { Seo } from '../../components/Seo';
import { EmptyState, ErrorState, Pagination, Spinner } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { useFetch } from '../../hooks/useFetch';
import { api, qs } from '../../services/api';
import type { ArticleCardData, Category, Paged, Tag } from '../../types';
import NotFoundPage from './NotFoundPage';

type Mode = 'all' | 'category' | 'tag' | 'search';
type ListResponse = Paged<ArticleCardData> & { category?: Category; tag?: Tag };

// One listing page for the blog index, category pages, tag pages and search results.
export default function ArticleListPage({ mode }: { mode: Mode }) {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const { settings, loaded } = useSettings();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = mode === 'search' ? (params.get('q') || '').trim() : '';
  const sortParam = params.get('sort');
  const sort = sortParam === 'popular' || sortParam === 'most-read' ? sortParam : 'latest';
  // Posts in another language (e.g. /blog?lang=hi for Hindi versions).
  const lang = mode === 'all' && params.get('lang') === 'hi' ? 'hi' : '';

  const { data, error, status, loading, reload } = useFetch<ListResponse | null>(
    () => {
      if (!loaded) return Promise.resolve(null);
      if (mode === 'search' && !q) return Promise.resolve({ items: [], page: 1, limit: 0, total: 0, pages: 1 });
      return api.get<ListResponse>(
        `/public/articles${qs({
          page,
          limit: settings.postsPerPage,
          q,
          sort: mode === 'search' ? undefined : sort,
          category: mode === 'category' ? slug : undefined,
          tag: mode === 'tag' ? slug : undefined,
          lang: lang || undefined,
        })}`,
      );
    },
    [mode, slug, page, q, sort, lang, loaded, settings.postsPerPage],
  );

  if (status === 404) return <NotFoundPage />;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  let title = 'Blog';
  let subtitle = sort === 'most-read' ? 'All articles, most read first.' : sort === 'popular' ? 'All articles, most viewed first.' : 'All articles, newest first.';
  if (lang === 'hi') {
    title = 'हिन्दी में पढ़ें';
    subtitle = 'हमारे लेख हिन्दी में।';
  }
  if (mode === 'category') {
    title = data?.category?.name || 'Category';
    subtitle = data?.category?.description || `Articles in ${title}.`;
  } else if (mode === 'tag') {
    title = data?.tag ? `#${data.tag.name}` : 'Tag';
    subtitle = `Articles tagged ${data?.tag?.name || ''}.`;
  } else if (mode === 'search') {
    title = q ? `Search results for “${q}”` : 'Search';
    subtitle = data && q ? `${data.total} ${data.total === 1 ? 'article' : 'articles'} found.` : 'Type a search term in the box above.';
  }

  return (
    <div className="container-page py-10">
      <Seo title={title} description={subtitle} noindex={mode === 'search'} lang={lang || 'en'} />
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
            {mode === 'all' ? 'Archive' : mode === 'search' ? 'Search' : mode}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-900 dark:text-stone-50 sm:text-4xl">{title}</h1>
          <p className="mt-2 text-stone-500">{subtitle}</p>
        </div>
        {mode !== 'search' && (
          <div>
            <label htmlFor="sort" className="sr-only">
              Sort articles
            </label>
            <select id="sort" className="input w-auto" value={sort} onChange={(e) => setParam('sort', e.target.value === 'latest' ? '' : e.target.value)}>
              <option value="latest">Latest</option>
              <option value="most-read">Most read</option>
              <option value="popular">Most viewed</option>
            </select>
          </div>
        )}
      </header>

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        mode === 'search' && !q ? null : (
          <EmptyState title={mode === 'search' ? 'No articles match your search' : 'No articles here yet'}>
            {mode === 'search' ? 'Try different or fewer keywords.' : 'Check back soon.'}
          </EmptyState>
        )
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((a) => (
              <ArticleCard key={a._id} article={a} />
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={(p) => setParam('page', p > 1 ? String(p) : '')} />
        </>
      )}
    </div>
  );
}
