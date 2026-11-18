import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { JobStatusBadge } from '../../components/JobStatusBadge';
import { ErrorState, PageHeader, Spinner, formatDate, formatDateTime } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage } from '../../services/api';
import type { JobStatus } from '../../types';
import type { GrowthView } from './growthTypes';

interface Candidate {
  _id: string;
  title: string;
  slug: string;
  publishedAt: string;
  refreshedAt?: string;
  views28: number;
  viewsPrev28: number;
  score: number;
  reasons: string[];
}

interface Overview {
  candidates: Candidate[];
  waiting: { _id: string; title: string; slug: string; refresh: { createdAt: string; title: string; words?: number } }[];
  jobs: { _id: string; input: { topic: string; refreshOf: string }; status: JobStatus; error: string; createdAt: string }[];
  settings: { perWeek: number; minAgeDays: number; lastStartedAt?: string; lastResult: string };
}

export default function RefreshPage() {
  const { toast } = useUi();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data, error, loading, reload } = useFetch(() => api.get<Overview>('/admin/refresh'), []);
  const [form, setForm] = useState<{ perWeek: number; minAgeDays: number } | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (data && !form) setForm({ perWeek: data.settings.perWeek, minAgeDays: data.settings.minAgeDays });
  }, [data, form]);

  useEffect(() => {
    if (!data?.jobs.some((j) => j.status === 'queued' || j.status === 'running')) return undefined;
    const t = window.setInterval(reload, 6000);
    return () => window.clearInterval(t);
  }, [data, reload]);

  if ((loading && !data) || (data && !form)) return <Spinner />;
  if (error || !data || !form) return <ErrorState message={error || 'Could not load post refresh'} onRetry={reload} />;

  const start = async (c: Candidate) => {
    setBusy(c._id);
    try {
      await api.post(`/admin/articles/${c._id}/refresh`);
      toast(`Refreshing "${c.title}". The updated version will wait for your approval.`);
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await api.put<GrowthView>('/admin/growth', { refresh: form });
      toast('Refresh settings saved');
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Refresh old posts" subtitle="Older posts lose visitors as facts change. A refresh researches the topic again and writes an updated version at the same address, so its rankings and links are kept. You approve every update." />

      {data.waiting.length > 0 && (
        <section className="card border-brand-300 p-5 dark:border-brand-800">
          <h2 className="mb-2 font-sans text-lg font-semibold">Updates waiting for you</h2>
          <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
            {data.waiting.map((w) => (
              <li key={w._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{w.title}</strong>
                  <span className="ml-2 text-stone-500">
                    updated version from {formatDateTime(w.refresh.createdAt)}
                    {w.refresh.words ? ` · ${w.refresh.words} words` : ''}
                  </span>
                </span>
                <Link to={`/admin/articles/${w._id}/edit`} className="btn btn-sm btn-primary">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <section className="card p-5">
          <h2 className="mb-1 font-sans text-lg font-semibold">Posts that would benefit</h2>
          <p className="mb-3 text-sm text-stone-500">Published at least {data.settings.minAgeDays} days ago, ranked by falling visits (last 4 weeks against the 4 before) and age.</p>
          {data.candidates.length === 0 ? (
            <p className="text-sm text-stone-500">No posts are old enough yet. Posts become candidates {data.settings.minAgeDays} days after publishing.</p>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {data.candidates.map((c) => (
                <li key={c._id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/articles/${c._id}/edit`} className="font-medium hover:text-brand-700">
                      {c.title}
                    </Link>
                    <p className="text-xs text-stone-500">
                      {c.reasons.join(' · ')} · published {formatDate(c.publishedAt)}
                    </p>
                  </div>
                  <button type="button" className="btn btn-sm" disabled={busy === c._id} onClick={() => start(c)}>
                    {busy === c._id ? 'Starting…' : 'Refresh now'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section className="card space-y-3 p-5">
            <h2 className="font-sans text-lg font-semibold">Automatic refreshes</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="rf-n" className="label">
                  Per week
                </label>
                <input id="rf-n" type="number" min={0} max={7} className="input" disabled={!isAdmin} value={form.perWeek} onChange={(e) => setForm({ ...form, perWeek: Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="rf-age" className="label">
                  Minimum age (days)
                </label>
                <input id="rf-age" type="number" min={30} max={730} className="input" disabled={!isAdmin} value={form.minAgeDays} onChange={(e) => setForm({ ...form, minAgeDays: Number(e.target.value) })} />
              </div>
            </div>
            <p className="text-xs text-stone-500">0 per week turns automatic refreshes off. The top post in the list is refreshed; you get a Telegram message with Apply / Discard buttons when the update is ready.</p>
            {data.settings.lastResult && <p className="text-xs text-stone-500">Last: {data.settings.lastResult}</p>}
            {isAdmin && (
              <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy === 'save'}>
                Save
              </button>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 font-sans text-lg font-semibold">Recent refreshes</h2>
            {data.jobs.length === 0 ? (
              <p className="text-sm text-stone-500">None yet.</p>
            ) : (
              <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
                {data.jobs.map((j) => (
                  <li key={j._id} className="py-2">
                    <Link to={`/admin/ai/jobs/${j._id}`} className="font-medium hover:text-brand-700">
                      {j.input.topic}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <JobStatusBadge status={j.status} />
                      {formatDateTime(j.createdAt)}
                    </div>
                    {j.error && <p className="text-xs text-red-600">{j.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
