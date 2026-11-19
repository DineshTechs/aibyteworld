import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { JobStatusBadge } from '../../../components/JobStatusBadge';
import { SearchSuggestions } from '../../../components/SearchSuggestions';
import { ErrorState, StatusBadge, Spinner, formatDate, formatDateTime } from '../../../components/ui';
import { useUi } from '../../../context/UiContext';
import { useFetch } from '../../../hooks/useFetch';
import { api, errorMessage } from '../../../services/api';
import type { Finding, JobStep, ResearchJob, ResearchSource } from '../../../types';

const STEP_ICON: Record<JobStep['status'], string> = { pending: '○', running: '◐', completed: '✓', failed: '✕', skipped: '–' };
const STEP_COLOR: Record<JobStep['status'], string> = {
  pending: 'text-stone-400',
  running: 'text-sky-600 animate-pulse',
  completed: 'text-emerald-600',
  failed: 'text-red-600',
  skipped: 'text-stone-400',
};

function Badge({ children, tone }: { children: string; tone: 'green' | 'grey' | 'amber' | 'red' | 'blue' }) {
  const cls = {
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    grey: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  }[tone];
  return <span className={`badge ${cls}`}>{children}</span>;
}

function FindingRow({ f, sources }: { f: Finding; sources: Map<string, ResearchSource> }) {
  return (
    <li className="py-3">
      <div className="flex gap-3">
        <span className="w-9 shrink-0 font-mono text-xs text-stone-400">{f.fid}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">{f.text}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={f.corroboration === 'multiple' ? 'green' : 'grey'}>{f.corroboration === 'multiple' ? `Corroborated (${f.domains.length} sites)` : 'Single source'}</Badge>
            {f.used && <Badge tone="blue">Cited in article</Badge>}
            {f.conflict && <Badge tone="red">Conflict</Badge>}
            {f.outdated && <Badge tone="amber">Possibly outdated</Badge>}
            {f.sources.map((id) => {
              const s = sources.get(id);
              return s ? (
                <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline dark:text-brand-300">
                  {s.domain}
                </a>
              ) : null;
            })}
          </div>
          {f.conflict && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{f.conflict}</p>}
          {f.outdated && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{f.outdated}</p>}
        </div>
      </div>
    </li>
  );
}

export default function ResearchJobPage() {
  const { id } = useParams();
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useFetch(() => api.get<{ item: ResearchJob; sources: ResearchSource[] }>(`/admin/ai/jobs/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'findings' | 'sources' | 'searches' | 'plan'>('findings');

  const active = data?.item.status === 'queued' || data?.item.status === 'running';
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [active, reload]);

  const sourceMap = useMemo(() => new Map((data?.sources || []).map((s) => [s._id, s])), [data?.sources]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error || 'Could not load this job'} onRetry={reload} />;
  const job = data.item;
  const done = job.steps.filter((s) => s.status === 'completed').length;

  const act = async (path: 'cancel' | 'retry') => {
    if (path === 'cancel' && !(await confirm('Stop this job? Work finished so far is kept and it can be retried later.', { confirmLabel: 'Stop job', danger: true }))) return;
    setBusy(true);
    try {
      await api.post(`/admin/ai/jobs/${job._id}/${path}`);
      toast(path === 'cancel' ? (job.status === 'running' ? 'Stopping after the current step…' : 'Job cancelled') : 'Job queued again');
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/ai/jobs" className="text-sm text-stone-500 hover:text-brand-700">
            ← Research History
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900 dark:text-stone-50">{job.input.topic}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            <JobStatusBadge status={job.status} />
            {job.cancelRequested && job.status === 'running' && <span>Stopping…</span>}
            <span>
              started {formatDateTime(job.createdAt)}
              {job.createdBy ? ` by ${job.createdBy.name}` : ''}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {job.article && (
            <Link to={`/admin/articles/${job.article._id}/edit`} className="btn btn-primary">
              Review article
            </Link>
          )}
          {active && !job.cancelRequested && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('cancel')}>
              Stop
            </button>
          )}
          {(job.status === 'failed' || job.status === 'cancelled') && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('retry')}>
              Retry from where it stopped
            </button>
          )}
        </div>
      </div>

      {job.error && (
        <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {job.error}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-sans text-base font-semibold">Progress</h2>
              <span className="text-sm text-stone-500">
                {done}/{job.steps.length}
              </span>
            </div>
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={job.steps.length}>
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${(done / job.steps.length) * 100}%` }} />
            </div>
            <ol className="space-y-3">
              {job.steps.map((s) => (
                <li key={s.key} className="flex gap-3 text-sm">
                  <span className={`w-4 text-center font-bold ${STEP_COLOR[s.status]}`} aria-hidden>
                    {STEP_ICON[s.status]}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">
                      {s.label}
                      <span className="sr-only"> ({s.status})</span>
                      {s.attempts > 1 && <span className="ml-1 text-xs text-stone-400">attempt {s.attempts}</span>}
                    </p>
                    {s.provider && <p className="text-xs text-stone-400">{s.provider}</p>}
                    {s.message && <p className="break-words text-xs text-stone-500">{s.message}</p>}
                    {s.error && <p className="break-words text-xs text-red-600 dark:text-red-400">{s.error}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="card space-y-2 p-5 text-sm">
            <h2 className="font-sans text-base font-semibold">Brief</h2>
            {job.input.siteUrl && (
              <div>
                <p>
                  About the website:{' '}
                  <a href={job.input.siteUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                    {job.input.siteUrl}
                  </a>
                  {job.input.sponsored ? ' · sponsored' : ''}
                </p>
                {job.website?.pages?.length ? (
                  <details className="mt-1 text-xs text-stone-500">
                    <summary className="cursor-pointer">{job.website.pages.length} page{job.website.pages.length === 1 ? '' : 's'} read</summary>
                    <ul className="mt-1 space-y-0.5">
                      {job.website.pages.map((pg) => (
                        <li key={pg.url} className="truncate">
                          <a href={pg.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {pg.title || pg.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
            {job.input.primaryKeyword && <p>Primary keyword: {job.input.primaryKeyword}</p>}
            {job.input.secondaryKeywords.length > 0 && <p>Secondary: {job.input.secondaryKeywords.join(', ')}</p>}
            <p>
              {job.input.length} words · {job.input.language}
              {job.input.country ? ` · ${job.input.country}` : ''}
            </p>
            {job.input.style && <p>Style: {job.input.style}</p>}
            {job.input.audience && <p>Audience: {job.input.audience}</p>}
            {job.input.category && <p>Category: {job.input.category.name}</p>}
            {job.input.instructions && <p className="whitespace-pre-line text-stone-500">{job.input.instructions}</p>}
            <p className="border-t border-stone-200 pt-2 text-xs text-stone-500 dark:border-stone-800">
              {job.usage.calls} AI calls · {job.usage.searchQueries} web searches · {(job.usage.promptTokens + job.usage.outputTokens).toLocaleString()} tokens
            </p>
          </section>

          {job.article && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-sans text-base font-semibold">Article</h2>
              <Link to={`/admin/articles/${job.article._id}/edit`} className="font-medium hover:text-brand-700">
                {job.article.title}
              </Link>
              <div className="mt-2">
                <StatusBadge status={job.article.status} />
              </div>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {(job.switches?.length || 0) > 0 && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-sans text-base font-semibold">Provider switches</h2>
              <ul className="space-y-2">
                {job.switches!.map((x, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {x.from} → {x.to}
                    </span>{' '}
                    <span className="text-stone-500">
                      during {job.steps.find((st) => st.key === x.step)?.label.toLowerCase() || x.step}, {formatDateTime(x.at)}
                    </span>
                    <p className="text-xs text-stone-500">{x.reason}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {job.warnings.filter((w) => !w.startsWith('Switched')).length > 0 && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <h2 className="mb-2 font-sans text-base font-semibold">Check before publishing</h2>
              <ul className="list-disc space-y-1 pl-5">
                {job.warnings.filter((w) => !w.startsWith('Switched')).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          {job.autopilot?.enabled && (
            <section className={`rounded-xl border p-5 text-sm ${job.autopilot.published ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950' : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'}`}>
              <h2 className="mb-1 font-sans text-base font-semibold">Autopilot</h2>
              {job.autopilot.trend && <p>Trending story: {job.autopilot.trend}</p>}
              {job.autopilot.gate ? (
                job.autopilot.published ? (
                  <p className="mt-1 font-medium text-emerald-800 dark:text-emerald-200">Published automatically: every quality check passed.</p>
                ) : (
                  <>
                    <p className="mt-1 font-medium">Held for your approval because:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {job.autopilot.gate.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </>
                )
              ) : (
                <p className="mt-1 text-stone-500">Quality checks run when the article is finished.</p>
              )}
            </section>
          )}

          {job.quality && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-sans text-base font-semibold">Writing quality</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-stone-500">Words</dt>
                  <dd>{job.quality.words}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Avg. sentence</dt>
                  <dd>
                    {job.quality.avgSentenceLength} words (±{job.quality.sentenceLengthVariation})
                  </dd>
                </div>
                {job.quality.readingEase !== null && (
                  <div>
                    <dt className="text-xs text-stone-500">Reading ease</dt>
                    <dd>{job.quality.readingEase} / 100</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-stone-500">Cited facts / sources</dt>
                  <dd>
                    {job.quality.citedFindings} / {job.quality.citedSources}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Uncited figures</dt>
                  <dd>{job.quality.uncitedFigureParagraphs}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">AI-style phrases</dt>
                  <dd>{job.quality.aiPhraseCount}</dd>
                </div>
              </dl>
              {job.quality.aiPhrases.length > 0 && <p className="mt-2 text-xs text-stone-500">Phrases found: {job.quality.aiPhrases.map((p) => `${p.phrase} (${p.count})`).join(', ')}</p>}
            </section>
          )}

          {job.seo && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-sans text-base font-semibold">SEO</h2>
              <p className="text-base text-sky-800 dark:text-sky-300">{job.seo.title}</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">/blog/{job.seo.slug}</p>
              <p className="mt-1 text-stone-600 dark:text-stone-400">{job.seo.description}</p>
              <p className="mt-2 text-xs text-stone-500">
                Keyword: {job.seo.focusKeyword}
                {job.seo.secondaryKeywords.length ? ` · also: ${job.seo.secondaryKeywords.join(', ')}` : ''} · {job.seo.faq.length} FAQ for structured data
              </p>
            </section>
          )}

          {job.images && job.images.length > 0 && (
            <section className="card p-5 text-sm">
              <h2 className="mb-3 font-sans text-base font-semibold">Photos</h2>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {job.images.map((img) => (
                  <li key={img.url}>
                    <img src={img.url} alt={img.alt} width={img.width} height={img.height} loading="lazy" className="aspect-video w-full rounded-lg bg-stone-100 object-cover dark:bg-stone-800" />
                    <p className="mt-1.5 text-xs font-medium">{img.role === 'cover' ? 'Cover image' : `Section: ${img.heading}`}</p>
                    <p className="text-xs text-stone-500">Alt: {img.alt}</p>
                    <p className="text-xs text-stone-500">
                      {img.provider}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-stone-500">Change or remove any photo in the article editor or the media library before publishing.</p>
            </section>
          )}

          {job.analysis && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-sans text-base font-semibold">Topic analysis</h2>
              <p>
                <span className="font-medium capitalize">{job.analysis.searchIntent}</span> intent: {job.analysis.intentSummary}
              </p>
              <p className="mt-1 text-stone-500">Audience: {job.analysis.audience}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[job.analysis.primaryKeyword, ...job.analysis.secondaryKeywords].filter(Boolean).map((k, i) => (
                  <Badge key={`${k}-${i}`} tone={i === 0 ? 'blue' : 'grey'}>
                    {k}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {job.summary && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-sans text-base font-semibold">Research summary</h2>
              <p className="whitespace-pre-line leading-relaxed">{job.summary}</p>
            </section>
          )}

          {(job.findings.length > 0 || job.research.length > 0) && (
            <section className="card p-5">
              <div className="mb-3 flex flex-wrap gap-2" role="tablist">
                {(
                  [
                    ['findings', `Findings (${job.findings.length})`],
                    ['sources', `Sources (${data.sources.length})`],
                    ['searches', `Searches (${job.research.length})`],
                    ...(job.plan ? ([['plan', 'Outline']] as const) : []),
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} className={`btn btn-sm ${tab === key ? 'btn-primary' : ''}`} onClick={() => setTab(key)}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'findings' && (
                <ul className="divide-y divide-stone-200 dark:divide-stone-800">
                  {job.findings.map((f) => (
                    <FindingRow key={f.fid} f={f} sources={sourceMap} />
                  ))}
                  {job.findings.length === 0 && <li className="py-3 text-sm text-stone-500">No findings yet.</li>}
                </ul>
              )}

              {tab === 'sources' && (
                <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
                  {data.sources.map((s) => (
                    <li key={s._id} className="py-3">
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                        {s.title || s.domain}
                      </a>
                      <p className="break-all text-xs text-stone-500">{s.url}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone="grey">{s.domain}</Badge>
                        <Badge tone={s.publishedAt ? 'grey' : 'amber'}>{s.publishedAt ? `Published ${formatDate(s.publishedAt)}` : 'Publication date unknown'}</Badge>
                        {s.reachable === false && <Badge tone="red">{s.httpStatus ? `Returned ${s.httpStatus}` : 'Could not be checked'}</Badge>}
                        <Badge tone="blue">{`${s.findingCount} finding${s.findingCount === 1 ? '' : 's'}`}</Badge>
                      </div>
                    </li>
                  ))}
                  {data.sources.length === 0 && <li className="py-3 text-stone-500">No sources yet.</li>}
                </ul>
              )}

              {tab === 'searches' && (
                <ul className="space-y-5">
                  {job.research.map((r, i) => (
                    <li key={i} className="text-sm">
                      <p className="font-medium">{r.question}</p>
                      {r.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{r.error}</p>}
                      {r.queries.length > 0 && <p className="mt-1 text-xs text-stone-500">Searched: {r.queries.join(' · ')}</p>}
                      <div className="mt-2">
                        <SearchSuggestions html={r.suggestionsHtml} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {tab === 'plan' && job.plan && (
                <div className="text-sm">
                  <p className="font-serif text-lg font-semibold">{job.plan.title}</p>
                  <ol className="mt-3 list-decimal space-y-2 pl-5">
                    {job.plan.sections.map((s) => (
                      <li key={s.heading}>
                        {s.heading}
                        {s.findings.length > 0 && <span className="ml-2 font-mono text-xs text-stone-400">{s.findings.join(' ')}</span>}
                        {s.subheadings.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-stone-500">
                            {s.subheadings.map((h) => (
                              <li key={h}>{h}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                  {job.plan.faq.length > 0 && (
                    <>
                      <p className="mt-4 font-medium">FAQ</p>
                      <ul className="mt-1 list-disc pl-5 text-stone-500">
                        {job.plan.faq.map((q) => (
                          <li key={q.question}>{q.question}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
