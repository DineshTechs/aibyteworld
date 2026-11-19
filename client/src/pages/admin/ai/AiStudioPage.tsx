import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JobStatusBadge } from '../../../components/JobStatusBadge';
import { ErrorState, PageHeader, Spinner, formatDateTime } from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import { useUi } from '../../../context/UiContext';
import { useFetch } from '../../../hooks/useFetch';
import { api, errorMessage } from '../../../services/api';
import type { AiSettings, AiStatus, Category, Paged, ResearchJob } from '../../../types';

const STYLES = ['Professional and informative', 'Conversational and friendly', 'Expert and technical', 'Simple and beginner-friendly', 'Persuasive'];

export default function AiStudioPage() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { toast } = useUi();
  const status = useFetch(() => api.get<AiStatus>('/admin/ai/status'), []);
  const settings = useFetch(() => api.get<{ settings: AiSettings }>('/admin/ai/settings'), []);
  const categories = useFetch(() => api.get<{ items: Category[] }>('/admin/categories'), []);
  const recent = useFetch(() => api.get<Paged<ResearchJob>>('/admin/ai/jobs?limit=5'), []);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ topic: '', siteUrl: '', sponsored: false, primaryKeyword: '', secondaryKeywords: '', country: '', language: '', audience: '', length: 1500, style: '', category: '', instructions: '' });

  useEffect(() => {
    const s = settings.data?.settings;
    if (s) setF((x) => ({ ...x, country: x.country || s.defaultCountry, language: x.language || s.defaultLanguage, length: s.defaultLength, style: x.style || s.defaultStyle }));
  }, [settings.data]);

  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ item: ResearchJob }>('/admin/ai/jobs', {
        topic: f.topic,
        siteUrl: f.siteUrl.trim() && !/^https?:\/\//i.test(f.siteUrl.trim()) ? `https://${f.siteUrl.trim()}` : f.siteUrl.trim(),
        sponsored: Boolean(f.siteUrl.trim()) && f.sponsored,
        primaryKeyword: f.primaryKeyword,
        secondaryKeywords: f.secondaryKeywords.split(',').map((k) => k.trim()).filter(Boolean),
        country: f.country,
        language: f.language || 'English',
        audience: f.audience,
        length: Number(f.length),
        style: f.style,
        category: f.category || null,
        instructions: f.instructions,
      });
      toast('Research started');
      navigate(`/admin/ai/jobs/${r.item._id}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  };

  if (status.loading && !status.data) return <Spinner />;
  if (status.error || !status.data) return <ErrorState message={status.error || 'Could not load'} onRetry={status.reload} />;

  return (
    <div>
      <PageHeader title="AI Content Studio" subtitle="Give a topic. Gemini researches it with Google Search, checks the findings and writes a cited draft for you to review." />

      {!status.data.ready && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {status.data.reason}{' '}
          {isAdmin ? (
            <Link to="/admin/ai/providers" className="font-medium underline">
              Set it up in AI Providers
            </Link>
          ) : (
            'Ask an administrator to set it up in AI Providers.'
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div>
            <label htmlFor="s-site" className="label">
              Write about a website (optional)
            </label>
            <input id="s-site" type="text" inputMode="url" maxLength={500} className="input" value={f.siteUrl} onChange={(e) => set({ siteUrl: e.target.value })} placeholder="https://example.com" />
            <p className="mt-1 text-xs text-stone-500">
              The site's home page and pages about what it offers (pricing, features, products…) are read and used as sources. The article links to those pages, the cover is a screenshot of the site, and a note says when the site was read.
            </p>
            {f.siteUrl.trim() && (
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={f.sponsored} onChange={(e) => set({ sponsored: e.target.checked })} />
                <span>
                  Sponsored or affiliate post: adds a disclosure at the top and marks the links <code>rel="sponsored"</code>, as Google requires for paid links.
                </span>
              </label>
            )}
          </div>
          <div>
            <label htmlFor="s-topic" className="label">
              Topic{f.siteUrl.trim() ? ' (optional)' : ''}
            </label>
            <input
              id="s-topic"
              required={!f.siteUrl.trim()}
              minLength={f.siteUrl.trim() ? 0 : 5}
              maxLength={300}
              className="input"
              value={f.topic}
              onChange={(e) => set({ topic: e.target.value })}
              placeholder={f.siteUrl.trim() ? 'Leave empty to write an overview of the website' : 'Best AI tools for small businesses in 2026'}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="s-pk" className="label">
                Primary keyword
              </label>
              <input id="s-pk" maxLength={120} className="input" value={f.primaryKeyword} onChange={(e) => set({ primaryKeyword: e.target.value })} placeholder="AI tools for small businesses" />
            </div>
            <div>
              <label htmlFor="s-sk" className="label">
                Secondary keywords
              </label>
              <input id="s-sk" className="input" value={f.secondaryKeywords} onChange={(e) => set({ secondaryKeywords: e.target.value })} placeholder="Comma separated (optional)" />
            </div>
            <div>
              <label htmlFor="s-country" className="label">
                Target country
              </label>
              <input id="s-country" maxLength={80} className="input" value={f.country} onChange={(e) => set({ country: e.target.value })} placeholder="USA" />
            </div>
            <div>
              <label htmlFor="s-lang" className="label">
                Language
              </label>
              <input id="s-lang" maxLength={60} className="input" value={f.language} onChange={(e) => set({ language: e.target.value })} placeholder="English" />
            </div>
            <div>
              <label htmlFor="s-length" className="label">
                Article length (words)
              </label>
              <input id="s-length" type="number" min={300} max={5000} step={100} className="input" value={f.length} onChange={(e) => set({ length: Number(e.target.value) })} />
            </div>
            <div>
              <label htmlFor="s-style" className="label">
                Writing style
              </label>
              <input id="s-style" list="style-options" maxLength={120} className="input" value={f.style} onChange={(e) => set({ style: e.target.value })} />
              <datalist id="style-options">
                {STYLES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="s-audience" className="label">
                Target audience
              </label>
              <input id="s-audience" maxLength={300} className="input" value={f.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="Owners of businesses with under 50 staff" />
            </div>
            <div>
              <label htmlFor="s-cat" className="label">
                Category
              </label>
              <select id="s-cat" className="input" value={f.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="">Automatic (best match by topic)</option>
                {categories.data?.items.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="s-instr" className="label">
              Additional instructions
            </label>
            <textarea id="s-instr" rows={3} maxLength={3000} className="input" value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Anything the article must cover or avoid (optional)" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy || !status.data.ready || (f.topic.trim().length < 5 && !f.siteUrl.trim())}>
              {busy ? 'Starting…' : 'Research and write'}
            </button>
            <span className="text-xs text-stone-500">Usually takes 1–4 minutes. You can leave this page; the job keeps running.</span>
          </div>
        </form>

        <aside className="space-y-6">
          {status.data.ready && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-sans text-base font-semibold">Providers</h2>
              <p className="text-xs font-medium uppercase tracking-wider text-stone-500">Research</p>
              <ol className="mb-3 mt-1 list-decimal pl-5">
                {status.data.research.map((p) => (
                  <li key={p.key}>
                    {p.name} {p.model && <span className="text-stone-500">({p.model})</span>}
                  </li>
                ))}
              </ol>
              <p className="text-xs font-medium uppercase tracking-wider text-stone-500">Writing</p>
              <ol className="mt-1 list-decimal pl-5">
                {status.data.writer.map((p) => (
                  <li key={p.key}>
                    {p.name} <span className="text-stone-500">({p.model})</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs font-medium uppercase tracking-wider text-stone-500">Images</p>
              {status.data.images?.length ? (
                <ol className="mt-1 list-decimal pl-5">
                  {status.data.images.map((p) => (
                    <li key={p.key}>
                      {p.name} {p.model && <span className="text-stone-500">({p.model})</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-stone-500">
                  None set up, so articles get no photos.{' '}
                  <Link to="/admin/ai/providers" className="text-brand-700 hover:underline dark:text-brand-300">
                    Add a free photo library
                  </Link>
                </p>
              )}
              <p className="mt-2 text-xs text-stone-500">Each step starts with the best provider that is working. If it fails, the next one takes over.</p>
            </section>
          )}
          <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-sans text-base font-semibold">Recent jobs</h2>
            <Link to="/admin/ai/jobs" className="text-sm text-brand-700 hover:underline dark:text-brand-300">
              All
            </Link>
          </div>
          {recent.data?.items.length ? (
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {recent.data.items.map((j) => (
                <li key={j._id} className="py-3">
                  <Link to={`/admin/ai/jobs/${j._id}`} className="block text-sm font-medium hover:text-brand-700">
                    {j.input.topic}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
                    <JobStatusBadge status={j.status} />
                    {formatDateTime(j.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">No AI articles yet.</p>
          )}
          </section>
        </aside>
      </div>
    </div>
  );
}
