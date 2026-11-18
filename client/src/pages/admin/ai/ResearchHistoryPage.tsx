import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { JobStatusBadge } from '../../../components/JobStatusBadge';
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatusBadge, formatDateTime } from '../../../components/ui';
import { useFetch } from '../../../hooks/useFetch';
import { api, qs } from '../../../services/api';
import type { Paged, ResearchJob } from '../../../types';

export default function ResearchHistoryPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const { data, error, loading, reload } = useFetch(() => api.get<Paged<ResearchJob>>(`/admin/ai/jobs${qs({ status, page })}`), [status, page]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div>
      <PageHeader
        title="Research History"
        subtitle="Every AI research and writing job, with its sources."
        actions={
          <>
            <select className="input w-auto" aria-label="Filter by status" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">All statuses</option>
              {['queued', 'running', 'completed', 'failed', 'cancelled'].map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
            <Link to="/admin/ai/studio" className="btn btn-primary">
              + New AI article
            </Link>
          </>
        }
      />
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message={error || 'Could not load jobs'} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No research jobs yet">
          <Link to="/admin/ai/studio" className="text-brand-700 hover:underline">
            Start one in the AI Content Studio
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wider text-stone-500 dark:border-stone-800">
                <tr>
                  <th className="px-4 py-3">Topic</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Article</th>
                  <th className="px-4 py-3">Started by</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                {data.items.map((j) => (
                  <tr key={j._id}>
                    <td className="px-4 py-3">
                      <Link to={`/admin/ai/jobs/${j._id}`} className="font-medium hover:text-brand-700">
                        {j.input.topic}
                      </Link>
                      {j.error && <p className="line-clamp-1 text-xs text-red-600 dark:text-red-400">{j.error}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={j.status} />
                    </td>
                    <td className="px-4 py-3">
                      {j.article ? (
                        <Link to={`/admin/articles/${j.article._id}/edit`} className="flex items-center gap-2 hover:text-brand-700">
                          <StatusBadge status={j.article.status} />
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">{j.createdBy?.name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-500">{formatDateTime(j.createdAt)}</td>
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
