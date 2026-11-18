import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, PageHeader, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { api } from '../../services/api';
import type { AnalyticsOverview, AnalyticsPost } from '../../types';

const PERIODS = [7, 30, 90, 365];
const num = (n: number) => n.toLocaleString();
const pct = (n: number) => `${Math.round(n * 100)}%`;
const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);

function change(now: number, before: number) {
  if (!before) return now ? 'new' : '';
  const d = (now - before) / before;
  return `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}%`;
}

function Tile({ label, value, delta, help }: { label: string; value: string; delta?: string; help: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-stone-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-stone-900 dark:text-stone-50">{value}</p>
      <p className="mt-1 text-xs text-stone-500">
        {delta && <span className={delta.startsWith('▼') ? 'text-red-600' : 'text-green-700 dark:text-green-400'}>{delta} vs previous period · </span>}
        {help}
      </p>
    </div>
  );
}

// Daily views (bars) and reads (darker bars inside), drawn as plain SVG.
function DailyChart({ series }: { series: AnalyticsOverview['series'] }) {
  const max = Math.max(1, ...series.map((d) => d.views));
  const w = 100 / series.length;
  const labelEvery = Math.ceil(series.length / 8);
  return (
    <figure>
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" className="h-48 w-full" role="img" aria-label="Daily views and reads">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2="100" y1={40 - f * 38} y2={40 - f * 38} className="stroke-stone-200 dark:stroke-stone-800" strokeWidth="0.15" />
        ))}
        {series.map((d, i) => {
          const hv = (d.views / max) * 38;
          const hr = (d.reads / max) * 38;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${d.views} views, ${d.reads} reads`}</title>
              <rect x={i * w + w * 0.15} width={w * 0.7} y={40 - hv} height={hv} className="fill-brand-200 dark:fill-brand-900" />
              <rect x={i * w + w * 0.15} width={w * 0.7} y={40 - hr} height={hr} className="fill-brand-600 dark:fill-brand-400" />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-stone-500">
        {series
          .filter((_, i) => i % labelEvery === 0)
          .map((d) => (
            <span key={d.day}>{new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
          ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-xs text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-200 dark:bg-brand-900" /> Views
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-600 dark:bg-brand-400" /> Reads
        </span>
        <span>Peak day: {num(max)} views</span>
      </figcaption>
    </figure>
  );
}

function PostTable({ title, posts, empty }: { title: string; posts: AnalyticsPost[]; empty: string }) {
  return (
    <section className="card overflow-x-auto p-5">
      <h2 className="mb-3 font-sans text-base font-semibold">{title}</h2>
      {posts.length === 0 ? (
        <p className="text-sm text-stone-500">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-stone-500">
              <th className="py-2 pr-3 font-medium">Post</th>
              <th className="py-2 pr-3 text-right font-medium">Views</th>
              <th className="py-2 pr-3 text-right font-medium">Reads</th>
              <th className="py-2 pr-3 text-right font-medium">Read rate</th>
              <th className="py-2 text-right font-medium">Avg. time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
            {posts.map((p) => (
              <tr key={p._id}>
                <td className="py-2 pr-3">
                  <Link to={`/admin/articles/${p._id}/edit`} className="font-medium text-stone-900 hover:text-brand-700 dark:text-stone-100">
                    {p.title}
                  </Link>{' '}
                  {p.status === 'published' && (
                    <a href={`/blog/${p.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-stone-500 hover:underline" aria-label={`Open ${p.title} on the site`}>
                      ↗
                    </a>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(p.views)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(p.reads)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{pct(p.readRate)}</td>
                <td className="py-2 text-right tabular-nums">{p.avgReadSeconds ? duration(p.avgReadSeconds) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useFetch(() => api.get<AnalyticsOverview>(`/admin/analytics?days=${days}`), [days]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error || 'Could not load analytics'} onRetry={reload} />;
  const { totals: t, previous: p } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Visitors to your posts, counted on this site without cookies. Each visitor counts once per post per day; bots and signed-in staff are not counted."
        actions={
          <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
            {PERIODS.map((d) => (
              <button key={d} type="button" className={`btn btn-sm ${days === d ? 'btn-primary' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>
                {d === 365 ? '12 months' : `${d} days`}
              </button>
            ))}
          </div>
        }
      />

      {!data.tracking && (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Built-in tracking is turned off, so new visits are not being counted.{' '}
          {user?.role === 'admin' && (
            <Link to="/admin/settings" className="font-medium underline">
              Turn it on in Website Settings
            </Link>
          )}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Views" value={num(t.views)} delta={change(t.views, p.views)} help="unique visitors per post per day" />
        <Tile label="Reads" value={num(t.reads)} delta={change(t.reads, p.reads)} help="scrolled through and stayed to read" />
        <Tile label="Read rate" value={pct(t.readRate)} help="share of views that became reads" />
        <Tile label="Avg. reading time" value={duration(t.avgReadSeconds)} help="active time on a post" />
      </div>

      <section className="card p-5">
        <h2 className="mb-3 font-sans text-base font-semibold">Daily views and reads</h2>
        {t.views === 0 ? <p className="text-sm text-stone-500">No visits in this period yet. Numbers appear here as soon as readers open your published posts.</p> : <DailyChart series={data.series} />}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <PostTable title="Most viewed posts" posts={data.mostViewed} empty="No views yet in this period." />
        <PostTable title="Most read posts" posts={data.mostRead} empty="No reads yet in this period." />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-sans text-base font-semibold">Where visitors came from</h2>
          {data.referrers.length === 0 ? (
            <p className="text-sm text-stone-500">No visits yet in this period.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.referrers.map((r) => {
                const share = t.views ? r.views / t.views : 0;
                return (
                  <li key={r.host}>
                    <div className="flex justify-between">
                      <span>{r.host === '(direct)' ? 'Direct, bookmarks and apps' : r.host}</span>
                      <span className="tabular-nums text-stone-500">
                        {num(r.views)} · {pct(share)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-stone-100 dark:bg-stone-800">
                      <div className="h-1.5 rounded bg-brand-500" style={{ width: `${Math.max(2, share * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="font-sans text-base font-semibold">More detail</h2>
          <p>
            All time: <strong>{num(data.allTime.views)}</strong> views and <strong>{num(data.allTime.reads)}</strong> reads.
          </p>
          <p>
            Google Analytics:{' '}
            {data.googleAnalytics ? (
              <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                open Google Analytics ↗
              </a>
            ) : (
              <span className="text-stone-500">not set up</span>
            )}
            . It adds countries, devices and visitor journeys, for visitors who accept cookies.
          </p>
          <p>
            Google Search Console:{' '}
            {data.searchConsole ? (
              <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                open Search Console ↗
              </a>
            ) : (
              <span className="text-stone-500">not verified</span>
            )}
            . It shows the Google searches that bring readers here and any indexing problems.
          </p>
          {user?.role === 'admin' && (!data.googleAnalytics || !data.searchConsole) && (
            <Link to="/admin/settings" className="btn btn-sm">
              Set up in Website Settings
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
