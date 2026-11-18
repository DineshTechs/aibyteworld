import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { JobStatusBadge } from '../../../components/JobStatusBadge';
import { ErrorState, PageHeader, Spinner, StatusBadge, formatDateTime } from '../../../components/ui';
import { useUi } from '../../../context/UiContext';
import { useFetch } from '../../../hooks/useFetch';
import { api, errorMessage } from '../../../services/api';
import type { ArticleStatus, Category, JobStatus } from '../../../types';

interface AutopilotSettings {
  enabled: boolean;
  postsPerDay: number;
  startTime: string;
  timezone: string;
  niche: string;
  keywords: string[];
  country: string;
  language: string;
  category?: string | null;
  length: number;
  style: string;
  publishMode: 'auto_if_checks_pass' | 'approval';
  minSources: number;
  minCitedFindings: number;
  requireImage: boolean;
  evergreenPerDay: number;
  evergreenTopics: string[];
  lastResult: string;
}

interface AutopilotJob {
  _id: string;
  input: { topic: string };
  status: JobStatus;
  error: string;
  createdAt: string;
  autopilot: { kind?: 'trending' | 'evergreen'; trend: string; gate?: { passed: boolean; reasons: string[] }; published: boolean };
  article?: { _id: string; title: string; slug: string; status: ArticleStatus } | null;
}

interface View {
  settings: AutopilotSettings;
  slots: string[];
  slotKinds?: ('trending' | 'evergreen')[];
  nextKind?: string;
  nextRunLocal: string;
  lastRunLocal: string;
  jobs: AutopilotJob[];
  imagesReady: boolean;
  imageSources: string[];
}

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Dubai', 'Australia/Sydney'];

export default function AutopilotPage() {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload, setData } = useFetch(() => api.get<View>('/admin/autopilot'), []);
  const categories = useFetch(() => api.get<{ items: Category[] }>('/admin/categories'), []);
  const [form, setForm] = useState<AutopilotSettings | null>(null);
  const [keywords, setKeywords] = useState('');
  const [topics, setTopics] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (data && !form) {
      setForm({ ...data.settings, category: data.settings.category || '' });
      setKeywords(data.settings.keywords.join(', '));
      setTopics((data.settings.evergreenTopics || []).join('\n'));
    }
  }, [data, form]);

  useEffect(() => {
    const running = data?.jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!running) return undefined;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [data, reload]);

  if ((loading && !data) || !form) return error ? <ErrorState message={error} onRetry={reload} /> : <Spinner />;
  if (error || !data) return <ErrorState message={error || 'Could not load Autopilot'} onRetry={reload} />;

  const set = (patch: Partial<AutopilotSettings>) => setForm({ ...form, ...patch });

  const save = async (e?: FormEvent, override?: Partial<AutopilotSettings>) => {
    e?.preventDefault();
    const body = { ...form, ...override };
    if (body.enabled && !data.settings.enabled && body.publishMode === 'auto_if_checks_pass') {
      const ok = await confirm(`Turn on Autopilot? It will write ${body.postsPerDay} post(s) a day and publish each one automatically only if it passes every quality check. Posts that fail wait for your approval.`, { confirmLabel: 'Turn on' });
      if (!ok) return;
    }
    setBusy('save');
    try {
      const r = await api.put<View>('/admin/autopilot', {
        ...body,
        keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        evergreenPerDay: Math.min(body.evergreenPerDay ?? 0, body.postsPerDay),
        evergreenTopics: topics.split('\n').map((t) => t.trim()).filter((t) => t.length >= 5).slice(0, 50),
        category: body.category || null,
        runAs: null,
      });
      setData(r);
      setForm({ ...r.settings, category: r.settings.category || '' });
      setTopics((r.settings.evergreenTopics || []).join('\n'));
      toast(r.settings.enabled ? `Autopilot is on. Next post: ${r.nextRunLocal}` : 'Autopilot settings saved');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const runNow = async (kind: 'trending' | 'evergreen') => {
    setBusy(`run-${kind}`);
    try {
      const r = await api.post<{ job: { _id: string; topic: string } }>('/admin/autopilot/run', { kind });
      toast(`Started: ${r.job.topic}`);
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const num = (k: keyof AutopilotSettings) => (e: { target: { value: string } }) => set({ [k]: Number(e.target.value) } as Partial<AutopilotSettings>);

  return (
    <div>
      <PageHeader
        title="Autopilot"
        subtitle="Writes trending posts and evergreen guides on a daily schedule."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => runNow('trending')} disabled={busy.startsWith('run')}>
              {busy === 'run-trending' ? 'Finding a topic…' : 'Run trending now'}
            </button>
            <button type="button" className="btn" onClick={() => runNow('evergreen')} disabled={busy.startsWith('run')}>
              {busy === 'run-evergreen' ? 'Planning a guide…' : 'Run evergreen now'}
            </button>
          </div>
        }
      />

      <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${data.settings.enabled ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950' : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'}`}>
        <div className="text-sm">
          <p className="font-semibold">{data.settings.enabled ? `On · ${data.settings.postsPerDay} post(s) a day at ${data.slots.map((t, i) => `${t}${data.slotKinds?.[i] === 'evergreen' ? ' (guide)' : ''}`).join(', ')} (${data.settings.timezone})` : 'Off'}</p>
          {data.settings.enabled && <p>Next post: {data.nextRunLocal}{data.nextKind ? ` · ${data.nextKind === 'evergreen' ? 'evergreen guide' : 'trending story'}` : ''}</p>}
          {data.lastRunLocal && (
            <p className="text-stone-500">
              Last run {data.lastRunLocal}
              {data.settings.lastResult ? `: ${data.settings.lastResult}` : ''}
            </p>
          )}
        </div>
        {data.imagesReady ? (
          <p className="w-full text-xs text-stone-500 sm:order-last">Photos from: {data.imageSources.join(' → ')}</p>
        ) : (
          <p className="w-full rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100 sm:order-last">
            No photo library is set up, so posts get no photos{form.requireImage ? ' and will wait for approval' : ''}. Add a free key under{' '}
            <Link to="/admin/ai/providers" className="font-medium underline">
              AI Providers → Image sources
            </Link>{' '}
            (Unsplash, Pexels or Pixabay).
          </p>
        )}
        <button type="button" className={`btn ${data.settings.enabled ? '' : 'btn-primary'}`} disabled={busy === 'save'} onClick={() => save(undefined, { enabled: !data.settings.enabled })}>
          {data.settings.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={save} className="card space-y-4 p-5">
          <h2 className="font-sans text-lg font-semibold">Schedule and topics</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="ap-n" className="label">
                Posts per day
              </label>
              <input id="ap-n" type="number" min={1} max={12} className="input" value={form.postsPerDay} onChange={num('postsPerDay')} />
            </div>
            <div>
              <label htmlFor="ap-start" className="label">
                First post at
              </label>
              <input id="ap-start" type="time" className="input" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </div>
            <div>
              <label htmlFor="ap-tz" className="label">
                Time zone
              </label>
              <select id="ap-tz" className="input" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                {[...new Set([form.timezone, ...TIMEZONES])].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-stone-500">Posts are spread evenly through the day, starting at the first time.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="ap-ev" className="label">
                Evergreen guides per day
              </label>
              <input id="ap-ev" type="number" min={0} max={form.postsPerDay} className="input" value={form.evergreenPerDay ?? 0} onChange={num('evergreenPerDay')} />
            </div>
            <p className="text-xs text-stone-500 sm:col-span-2 sm:self-end">
              Trending news gets a burst of readers, then fades. Evergreen guides (“how to…”, “best … for …”) keep getting search visitors for months. With 4 posts and 2 guides, the day goes: trending, guide, trending, guide.
            </p>
          </div>
          <div>
            <label htmlFor="ap-topics" className="label">
              Your evergreen topic ideas (optional, one per line)
            </label>
            <textarea id="ap-topics" rows={4} className="input" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={'How to choose a laptop for coding\nBest free AI tools for students'} />
            <p className="mt-1 text-xs text-stone-500">Used first, top to bottom; each idea leaves the list once it is written. When the list is empty, Autopilot picks a guide topic your blog has not covered yet.</p>
          </div>
          <div>
            <label htmlFor="ap-niche" className="label">
              Niche
            </label>
            <input id="ap-niche" maxLength={120} className="input" value={form.niche} onChange={(e) => set({ niche: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ap-kw" className="label">
              Topics to watch
            </label>
            <input id="ap-kw" className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Comma separated" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ap-country" className="label">
                Country focus
              </label>
              <input id="ap-country" maxLength={80} className="input" value={form.country} onChange={(e) => set({ country: e.target.value })} placeholder="Empty = worldwide" />
            </div>
            <div>
              <label htmlFor="ap-cat" className="label">
                Category for posts
              </label>
              <select id="ap-cat" className="input" value={form.category || ''} onChange={(e) => set({ category: e.target.value })}>
                <option value="">No category</option>
                {categories.data?.items.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ap-len" className="label">
                Length (words)
              </label>
              <input id="ap-len" type="number" min={600} max={4000} step={100} className="input" value={form.length} onChange={num('length')} />
            </div>
            <div>
              <label htmlFor="ap-style" className="label">
                Writing style
              </label>
              <input id="ap-style" maxLength={120} className="input" value={form.style} onChange={(e) => set({ style: e.target.value })} />
            </div>
          </div>

          <h2 className="border-t border-stone-200 pt-4 font-sans text-lg font-semibold dark:border-stone-800">Publishing</h2>
          <fieldset className="space-y-2 text-sm">
            <legend className="sr-only">Publishing mode</legend>
            <label className="flex gap-2">
              <input type="radio" name="mode" checked={form.publishMode === 'auto_if_checks_pass'} onChange={() => set({ publishMode: 'auto_if_checks_pass' })} />
              <span>
                <strong>Publish automatically when every check passes.</strong> Posts that fail any check wait in Pending approval with the reasons.
              </span>
            </label>
            <label className="flex gap-2">
              <input type="radio" name="mode" checked={form.publishMode === 'approval'} onChange={() => set({ publishMode: 'approval' })} />
              <span>
                <strong>Always wait for my approval.</strong>
              </span>
            </label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ap-ms" className="label">
                Minimum cited sources
              </label>
              <input id="ap-ms" type="number" min={1} max={20} className="input" value={form.minSources} onChange={num('minSources')} />
            </div>
            <div>
              <label htmlFor="ap-mf" className="label">
                Minimum cited facts
              </label>
              <input id="ap-mf" type="number" min={1} max={40} className="input" value={form.minCitedFindings} onChange={num('minCitedFindings')} />
            </div>
          </div>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={form.requireImage} onChange={(e) => set({ requireImage: e.target.checked })} />
            <span>Only publish posts that have a cover photo</span>
          </label>
          <p className="text-xs text-stone-500">
            A post is published only if it also has no figures without a citation, cites no conflicting or outdated facts, reaches 70% of the target length, has all cited pages reachable, has no leftover AI-style phrases, and has SEO title and description. Uses about {form.postsPerDay * 6} web searches a day; the AI and article limits in AI Providers still apply.
          </p>
          <button type="submit" className="btn btn-primary" disabled={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : 'Save settings'}
          </button>
        </form>

        <section className="card p-5">
          <h2 className="mb-3 font-sans text-lg font-semibold">Recent Autopilot posts</h2>
          {data.jobs.length === 0 ? (
            <p className="text-sm text-stone-500">No posts yet. Click “Run trending now” or “Run evergreen now” to try it.</p>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {data.jobs.map((j) => (
                <li key={j._id} className="py-3 text-sm">
                  <Link to={`/admin/ai/jobs/${j._id}`} className="font-medium hover:text-brand-700">
                    {j.article?.title || j.input.topic}
                  </Link>
                  {j.autopilot.kind === 'evergreen' ? <p className="text-xs text-stone-500">Evergreen guide</p> : j.autopilot.trend && <p className="text-xs text-stone-500">Trend: {j.autopilot.trend}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <JobStatusBadge status={j.status} />
                    {j.article && <StatusBadge status={j.article.status} />}
                    {j.autopilot.gate && (
                      <span className={`badge ${j.autopilot.gate.passed ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>
                        {j.autopilot.published ? 'Auto-published' : j.autopilot.gate.passed ? 'Checks passed' : 'Held for approval'}
                      </span>
                    )}
                    {formatDateTime(j.createdAt)}
                  </div>
                  {j.autopilot.gate && !j.autopilot.published && j.autopilot.gate.reasons.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Why: {j.autopilot.gate.reasons.join('; ')}</p>}
                  {j.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{j.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
