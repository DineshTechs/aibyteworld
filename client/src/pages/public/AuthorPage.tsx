import { useParams, useSearchParams } from 'react-router-dom';
import { ArticleCard } from '../../components/ArticleCard';
import { Seo } from '../../components/Seo';
import { EmptyState, ErrorState, Pagination, Spinner } from '../../components/ui';
import { useFetch } from '../../hooks/useFetch';
import { api, qs } from '../../services/api';
import type { ArticleCardData, Paged } from '../../types';
import NotFoundPage from './NotFoundPage';

interface AuthorInfo {
  id: string;
  name: string;
  bio: string;
  avatarUrl: string;
  articleCount: number;
}

export default function AuthorPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const author = useFetch(() => api.get<{ author: AuthorInfo }>(`/public/authors/${id}`), [id]);
  const list = useFetch(() => api.get<Paged<ArticleCardData>>(`/public/articles${qs({ author: id, page })}`), [id, page]);

  if (author.status === 404) return <NotFoundPage />;
  if (author.loading && !author.data) return <Spinner />;
  if (author.error || !author.data) return <ErrorState message={author.error || 'Could not load this author'} onRetry={author.reload} />;
  const a = author.data.author;

  return (
    <div className="container-page py-10">
      <Seo title={a.name} description={a.bio || `Articles by ${a.name}`} />
      <header className="card mb-10 flex flex-col items-center gap-5 p-8 text-center sm:flex-row sm:text-left">
        {a.avatarUrl ? (
          <img src={a.avatarUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-100 font-serif text-4xl text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" aria-hidden>
            {a.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">Author</p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-900 dark:text-stone-50">{a.name}</h1>
          {a.bio && <p className="mt-2 max-w-2xl text-stone-600 dark:text-stone-400">{a.bio}</p>}
          <p className="mt-2 text-sm text-stone-500">
            {a.articleCount} published {a.articleCount === 1 ? 'article' : 'articles'}
          </p>
        </div>
      </header>
      {list.loading && !list.data ? (
        <Spinner />
      ) : list.error || !list.data ? (
        <ErrorState message={list.error || 'Could not load articles'} onRetry={list.reload} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No published articles yet" />
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.items.map((x) => (
              <ArticleCard key={x._id} article={x} />
            ))}
          </div>
          <Pagination page={list.data.page} pages={list.data.pages} onPage={(p) => setParams(p > 1 ? { page: String(p) } : {})} />
        </>
      )}
    </div>
  );
}
