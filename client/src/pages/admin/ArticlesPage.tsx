import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatusBadge, formatDateTime } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useUi } from '../../context/UiContext';
import { useDebounced } from '../../hooks/useDebounced';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage, qs } from '../../services/api';
import type { Article, ArticleStatus, Paged } from '../../types';

const STATUSES: { value: '' | ArticleStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

export default function ArticlesPage() {
  const { user, isStaff } = useAuth();
  const { toast, confirm } = useUi();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const q = useDebounced(search, 350);
  const status = params.get('status') || '';
  const origin = params.get('origin') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [busyId, setBusyId] = useState('');

  const { data, error, loading, reload } = useFetch(() => api.get<Paged<Article>>(`/admin/articles${qs({ status, origin, q, page })}`), [status, origin, q, page]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const canEdit = (a: Article) => isStaff || (a.author?._id === user?.id && (a.status === 'draft' || a.status === 'pending_approval'));

  const act = async (a: Article, fn: () => Promise<unknown>, done: string) => {
    setBusyId(a._id);
    try {
      await fn();
      toast(done);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusyId('');
    }
  };

  const remove = async (a: Article) => {
    if (!(await confirm(`Delete “${a.title}”? This cannot be undone.`, { confirmLabel: 'Delete', danger: true }))) return;
    act(a, () => api.delete(`/admin/articles/${a._id}`), 'Article deleted');
  };

  const setStatus = (a: Article, next: ArticleStatus, done: string) => act(a, () => api.patch(`/admin/articles/${a._id}/status`, { status: next }), done);

  return (
    <div>
      <PageHeader
        title="Articles"
        subtitle={isStaff ? 'All articles on the site.' : 'Articles you have written.'}
        actions={
          <Link to="/admin/articles/new" className="btn btn-primary">
            + New article
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="search"
          className="input max-w-xs"
          placeholder="Search by title…"
          aria-label="Search articles by title"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (page !== 1) setParam('page', '');
          }}
        />
        <select className="input w-auto" aria-label="Filter by status" value={status} onChange={(e) => setParam('status', e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input w-auto" aria-label="Filter by origin" value={origin} onChange={(e) => setParam('origin', e.target.value)}>
          <option value="">All origins</option>
          <option value="manual">Manual</option>
          <option value="ai">AI-generated</option>
        </select>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message={error || 'Could not load articles'} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No articles found">
          <Link to="/admin/articles/new" className="text-brand-700 hover:underline">
            Write your first article
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wider text-stone-500 dark:border-stone-800">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                {data.items.map((a) => (
                  <tr key={a._id} className={busyId === a._id ? 'opacity-50' : ''}>
                    <td className="px-4 py-3">
                      {canEdit(a) ? (
                        <Link to={`/admin/articles/${a._id}/edit`} className="font-medium text-stone-900 hover:text-brand-700 dark:text-stone-100">
                          {a.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{a.title}</span>
                      )}
                      <p className="text-xs text-stone-500">
                        /{a.slug} · {a.origin === 'ai' ? 'AI' : 'Manual'}
                        {a.status === 'scheduled' && a.scheduledAt ? ` · goes live ${formatDateTime(a.scheduledAt)}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-3">{a.author?.name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-500">{formatDateTime(a.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {a.status === 'published' && (
                          <a href={`/blog/${a.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                            View
                          </a>
                        )}
                        {isStaff && a.status === 'pending_approval' && (
                          <button type="button" className="btn btn-sm btn-primary" disabled={!!busyId} onClick={() => setStatus(a, 'published', 'Article approved and published')}>
                            Approve
                          </button>
                        )}
                        {isStaff && a.status === 'published' && (
                          <button type="button" className="btn btn-sm" disabled={!!busyId} onClick={() => setStatus(a, 'draft', 'Article unpublished')}>
                            Unpublish
                          </button>
                        )}
                        {canEdit(a) && (
                          <>
                            <Link to={`/admin/articles/${a._id}/edit`} className="btn btn-sm">
                              Edit
                            </Link>
                            <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" disabled={!!busyId} onClick={() => remove(a)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={(p) => setParam('page', p > 1 ? String(p) : '')} />
        </>
      )}
    </div>
  );
}
