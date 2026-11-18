import { useState } from 'react';
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, formatDateTime } from '../../components/ui';
import { useFetch } from '../../hooks/useFetch';
import { api, qs } from '../../services/api';
import type { ActivityItem, Paged } from '../../types';

const FILTERS = [
  { value: '', label: 'All activity' },
  { value: 'article', label: 'Articles' },
  { value: 'auth', label: 'Sign-ins' },
  { value: 'user', label: 'Users' },
  { value: 'media', label: 'Media' },
  { value: 'category', label: 'Categories' },
  { value: 'tag', label: 'Tags' },
  { value: 'settings', label: 'Settings' },
];

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, error, loading, reload } = useFetch(() => api.get<Paged<ActivityItem>>(`/admin/activity${qs({ page, action })}`), [page, action]);

  return (
    <div>
      <PageHeader
        title="Activity Logs"
        subtitle="Audit trail of sign-ins and changes."
        actions={
          <>
            <select
              className="input w-auto"
              aria-label="Filter activity"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={reload}>
              Refresh
            </button>
          </>
        }
      />
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message={error || 'Could not load activity'} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No activity recorded" />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wider text-stone-500 dark:border-stone-800">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                {data.items.map((a) => (
                  <tr key={a._id}>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-500">{formatDateTime(a.createdAt)}</td>
                    <td className="px-4 py-3">{a.actorName}</td>
                    <td className="px-4 py-3">
                      <code className={`rounded px-1.5 py-0.5 text-xs ${a.action.includes('failed') ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-stone-100 dark:bg-stone-800'}`}>{a.action}</code>
                    </td>
                    <td className="px-4 py-3">{a.summary}</td>
                    <td className="px-4 py-3 text-xs text-stone-500">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
