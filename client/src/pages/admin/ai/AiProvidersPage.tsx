import { useEffect, useState, type FormEvent } from 'react';
import { ErrorState, PageHeader, Spinner, formatDateTime } from '../../../components/ui';
import { useUi } from '../../../context/UiContext';
import { useFetch } from '../../../hooks/useFetch';
import { api, errorMessage } from '../../../services/api';
import type { AiModel, AiProvider, AiSettings } from '../../../types';

const ROLE_NAMES = { research: 'research', writer: 'writing', image: 'images' } as const;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isUsable = (p: AiProvider) => Boolean(p.keyless || p.hasKey || p.keySource === 'env' || p.keySource.startsWith('shared:'));
const isReady = (p: AiProvider) => Boolean(p.enabled && (p.model || p.modelless) && isUsable(p));

// Suggested model when none is chosen yet; the admin still confirms it.
function suggestModel(key: string, models: AiModel[]) {
  const patterns: Record<string, RegExp> = {
    gemini: /^gemini-\d+(\.\d+)?-flash$/,
    openai: /^gpt-[\d.]+-mini$|^gpt-[\d.]+$/,
    anthropic: /sonnet/,
    nous: /hermes/i,
    groq: /llama-3\.3-70b|gpt-oss-120b|llama/i,
    cerebras: /gpt-oss-120b|llama/i,
    mistral: /mistral-small-latest|mistral-medium-latest|small/i,
    openrouter: /:free$/,
  };
  return models.find((m) => patterns[key]?.test(m.id))?.id || models[0]?.id || '';
}

function ProviderCard({ provider, secretsOk, onChange }: { provider: AiProvider; secretsOk: boolean; onChange: (p: AiProvider) => void }) {
  const { toast, confirm } = useUi();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [model, setModel] = useState(provider.model);
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(provider.lastTest);
  const usable = isUsable(provider);
  const sharedFrom = provider.keySource.startsWith('shared:') ? provider.keySource.slice(7) : '';
  const path = `/admin/ai/providers/${provider.key}`;

  const loadModels = async (quiet = false) => {
    setBusy('models');
    try {
      const r = await api.get<{ items: AiModel[] }>(`${path}/models`);
      setModels(r.items);
      if (!model && r.items.length) setModel(suggestModel(provider.key, r.items));
    } catch (e) {
      if (!quiet) toast(errorMessage(e), 'error');
      else setTestResult({ ok: false, message: errorMessage(e) });
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (usable && !models && !provider.keyless && !provider.modelless) loadModels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable]);

  const save = async (body: Record<string, unknown>, done: string) => {
    const r = await api.put<{ item: AiProvider }>(path, body);
    onChange(r.item);
    toast(done);
    return r.item;
  };

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('key');
    try {
      await save({ apiKey: apiKey.trim() }, 'API key saved (encrypted on the server)');
      setApiKey('');
      setModels(null);
      setTestResult(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const saveBaseUrl = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('url');
    try {
      await save({ baseUrl: baseUrl.trim() }, 'Address saved');
      setModels(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const tryNow = async () => {
    setBusy('reset');
    try {
      const r = await api.post<{ item: AiProvider }>(`${path}/reset-health`);
      onChange(r.item);
      toast(`${provider.name} will be tried first again`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const removeKey = async () => {
    if (!(await confirm(`Remove the saved ${provider.name} API key?`, { confirmLabel: 'Remove key', danger: true }))) return;
    try {
      const r = await api.delete<{ item: AiProvider }>(`${path}/key`);
      onChange(r.item);
      setModels(null);
      toast('API key removed');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const saveModel = async () => {
    setBusy('model');
    try {
      await save({ model }, `Model set to ${model}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.post<{ ok: boolean; message: string; item: AiProvider }>(`${path}/test`);
      setTestResult({ ok: r.ok, message: r.message });
      onChange(r.item);
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy('');
    }
  };

  const toggleEnabled = async () => {
    try {
      await save({ enabled: !provider.enabled }, provider.enabled ? `${provider.name} disabled` : `${provider.name} enabled`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const ready = isReady(provider);
  const role =
    provider.kind === 'image'
      ? 'Images: free photos'
      : provider.searchOnly
        ? 'Research (web search)'
        : provider.supportsWebSearch
          ? 'Research + writing'
          : 'Writing only';

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 font-sans text-lg font-semibold">
            {provider.name}
            <span className={`badge ${ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>{ready ? 'Ready' : 'Not set up'}</span>
            <span className={`badge ${provider.supportsWebSearch ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200' : 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>{role}</span>
            {provider.free && <span className="badge bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200">{provider.free}</span>}
            {ready && <span className="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200" title="Used to pick the best provider first">{provider.quality.label}</span>}
          </h2>
          <p className="text-sm text-stone-500">{provider.description}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={provider.enabled} onChange={toggleEnabled} />
          Enabled
        </label>
      </div>

      {provider.health.length > 0 && (
        <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {provider.health.map((h) => (
            <p key={h.role}>
              <strong>Paused for {ROLE_NAMES[h.role]} until {timeOf(h.until)}</strong> after a failure ({h.message}). Other providers are used meanwhile; this one is tried first again after that.
            </p>
          ))}
          <button type="button" className="btn btn-sm mt-2" onClick={tryNow} disabled={busy === 'reset'}>
            {busy === 'reset' ? 'Clearing…' : 'Try now'}
          </button>
        </div>
      )}

      {provider.keyless && provider.key !== 'ollama' ? (
        <p className="text-sm text-stone-500">
          No API key needed.{' '}
          <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
            About {provider.name.split(' (')[0]}
          </a>
        </p>
      ) : provider.keyless ? (
        <form onSubmit={saveBaseUrl}>
          <h3 className="font-sans text-sm font-semibold">Ollama address</h3>
          <p className="mt-1 text-sm text-stone-500">
            No API key needed. Install{' '}
            <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
              Ollama
            </a>{' '}
            on this computer, then pull a model in a terminal, for example <code>ollama pull llama3.1</code>.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label htmlFor={`${provider.key}-url`} className="sr-only">
              Ollama address
            </label>
            <input id={`${provider.key}-url`} className="input max-w-sm" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434" />
            <button type="submit" className="btn" disabled={busy === 'url' || baseUrl === provider.baseUrl}>
              Save address
            </button>
          </div>
        </form>
      ) : (
        <div>
          <h3 className="font-sans text-sm font-semibold">API key</h3>
          <p className="mt-1 text-sm text-stone-500">
            {provider.hasKey
              ? `A key ending in ••••${provider.apiKeyLast4} is saved (encrypted).`
              : sharedFrom
                ? `Uses the ${sharedFrom} key saved above.`
                : provider.keySource === 'env'
                  ? 'Using the key from server\\.env.'
                  : 'No key yet.'}{' '}
            <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
              Get a key
            </a>
            . Keys are never shown again or sent to the browser.
          </p>
          <form onSubmit={saveKey} className="mt-2 flex flex-wrap gap-2" autoComplete="off">
            <label htmlFor={`${provider.key}-key`} className="sr-only">
              {provider.name} API key
            </label>
            <input id={`${provider.key}-key`} type="password" autoComplete="off" className="input max-w-sm" placeholder={provider.hasKey ? 'Paste a new key to replace it' : 'Paste the API key'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={!apiKey.trim() || busy === 'key' || !secretsOk}>
              {busy === 'key' ? 'Saving…' : 'Save key'}
            </button>
            {provider.hasKey && (
              <button type="button" className="btn text-red-600 dark:text-red-400" onClick={removeKey}>
                Remove
              </button>
            )}
          </form>
        </div>
      )}

      {!provider.modelless && (
      <div>
        <h3 className="font-sans text-sm font-semibold">Model</h3>
        {!usable ? (
          <p className="mt-1 text-sm text-stone-500">Add a key to see the models available to it.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            <label htmlFor={`${provider.key}-model`} className="sr-only">
              {provider.name} model
            </label>
            <select id={`${provider.key}-model`} className="input max-w-sm" value={model} onChange={(e) => setModel(e.target.value)} disabled={!models}>
              {!models && <option value={model}>{busy === 'models' ? 'Loading models…' : model || 'Load models first'}</option>}
              {models && !model && <option value="">Choose a model</option>}
              {models?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name === m.id ? m.id : `${m.name} (${m.id})`}
                </option>
              ))}
            </select>
            {!models && (
              <button type="button" className="btn" onClick={() => loadModels()} disabled={busy === 'models'}>
                Load models
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={saveModel} disabled={!model || model === provider.model || busy === 'model'}>
              {busy === 'model' ? 'Saving…' : 'Use this model'}
            </button>
          </div>
        )}
        {provider.model && <p className="mt-1 text-xs text-stone-500">Current: {provider.model}</p>}
      </div>
      )}

      <div className="border-t border-stone-200 pt-3 dark:border-stone-800">
        <button type="button" className="btn btn-sm" onClick={test} disabled={!usable || busy === 'test'}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        {testResult && (
          <p role="status" className={`mt-2 text-sm ${testResult.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {testResult.ok ? '✓ ' : '✕ '}
            {testResult.message}
            {provider.lastTest?.at && <span className="ml-2 text-xs text-stone-500">({formatDateTime(provider.lastTest.at)})</span>}
          </p>
        )}
      </div>
    </section>
  );
}

// Ordered list of providers with include/exclude controls. In "best quality
// first" mode the order is worked out from quality (shown read-only);
// in custom mode the up/down buttons set it.
function OrderEditor({ label, help, all, value, onChange, byQuality }: { label: string; help: string; all: AiProvider[]; value: string[]; onChange: (v: string[]) => void; byQuality: boolean }) {
  const included = value.filter((k) => all.some((p) => p.key === k));
  const excluded = all.filter((p) => !included.includes(p.key));
  const find = (k: string) => all.find((p) => p.key === k);
  const name = (k: string) => find(k)?.name || k;
  const shown = byQuality ? [...included].sort((a, b) => (find(b)?.quality.score || 0) - (find(a)?.quality.score || 0)) : included;
  const move = (i: number, d: number) => {
    const next = [...included];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mb-2 text-xs text-stone-500">{help}</p>
      <ol className="space-y-1.5">
        {shown.map((k, i) => {
          const p = find(k);
          const ready = p && isReady(p);
          return (
            <li key={k} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-sm dark:border-stone-700">
              <span className="w-5 text-stone-400">{i + 1}.</span>
              <span className="flex-1">
                {name(k)}
                {byQuality && p && ready && <span className="ml-2 text-xs text-stone-500">{p.quality.label}</span>}
                {!ready && <span className="ml-2 text-xs text-amber-600">not set up, skipped</span>}
                {ready && p && p.health.length > 0 && <span className="ml-2 text-xs text-amber-600">paused until {timeOf(p.health[0].until)}</span>}
              </span>
              {!byQuality && (
                <>
                  <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${name(k)} up`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-sm" disabled={i === included.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${name(k)} down`}>
                    ↓
                  </button>
                </>
              )}
              <button type="button" className="btn btn-sm" disabled={included.length === 1 && label !== 'Image sources'} onClick={() => onChange(included.filter((x) => x !== k))} aria-label={`Remove ${name(k)}`}>
                ✕
              </button>
            </li>
          );
        })}
      </ol>
      {excluded.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {excluded.map((p) => (
            <button key={p.key} type="button" className="btn btn-sm" onClick={() => onChange([...included, p.key])}>
              + {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsCard({ initial, providers }: { initial: AiSettings; providers: AiProvider[] }) {
  const { toast } = useUi();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof AiSettings) => (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.put<{ settings: AiSettings }>('/admin/ai/settings', s);
      setS(r.settings);
      toast('AI settings saved');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const field = (id: keyof AiSettings, label: string, min: number, max: number, help?: string) => (
    <div>
      <label htmlFor={`ai-${id}`} className="label">
        {label}
      </label>
      <input id={`ai-${id}`} type="number" min={min} max={max} className="input w-32" value={s[id] as number} onChange={num(id)} />
      {help && <p className="mt-1 text-xs text-stone-500">{help}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="card space-y-5 p-5">
      <h2 className="font-sans text-lg font-semibold">Fallback order and generation settings</h2>
      <fieldset className="space-y-1.5 text-sm">
        <legend className="label">Which provider goes first</legend>
        <label className="flex gap-2">
          <input type="radio" name="orderMode" checked={s.orderMode !== 'custom'} onChange={() => setS({ ...s, orderMode: 'quality' })} />
          <span>
            <strong>Best quality first (recommended).</strong> Every step starts with the best ready provider. If it fails, the next best takes over, and the better one is used again as soon as it works (after a short pause, or an hour for a used-up quota).
          </span>
        </label>
        <label className="flex gap-2">
          <input type="radio" name="orderMode" checked={s.orderMode === 'custom'} onChange={() => setS({ ...s, orderMode: 'custom' })} />
          <span>
            <strong>My own order.</strong> Use the lists below exactly as ordered.
          </span>
        </label>
      </fieldset>
      <div className="grid gap-5 lg:grid-cols-3">
        <OrderEditor
          label="Research providers (web search)"
          help="If one runs out of quota or fails, research switches to the next. Tavily is free; a writing model pulls out facts and only facts quoted word for word from a result are kept."
          all={providers.filter((p) => p.supportsWebSearch)}
          value={s.researchProviders}
          onChange={(v) => setS({ ...s, researchProviders: v })}
          byQuality={s.orderMode !== 'custom'}
        />
        <OrderEditor
          label="Writing providers"
          help="Used for analysis, verification, planning, writing, editing and SEO. Free options (Groq, Cerebras, Mistral, OpenRouter, Ollama) are fallbacks."
          all={providers.filter((p) => p.kind !== 'image' && !p.searchOnly)}
          value={s.writerProviders}
          onChange={(v) => setS({ ...s, writerProviders: v })}
          byQuality={s.orderMode !== 'custom'}
        />
        <OrderEditor
          label="Image sources"
          help="Free photo libraries. Photos are credited to the photographer, and no photo is used twice on the site. Images are never generated by AI."
          all={providers.filter((p) => p.kind === 'image')}
          value={s.imageProviders}
          onChange={(v) => setS({ ...s, imageProviders: v })}
          byQuality={s.orderMode !== 'custom'}
        />
      </div>
      <div className="grid gap-4 border-t border-stone-200 pt-4 dark:border-stone-800 sm:grid-cols-2">
        <label className="flex gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={s.imagesEnabled} onChange={(e) => setS({ ...s, imagesEnabled: e.target.checked })} />
          <span>
            <strong>Add photos to AI articles:</strong> a cover photo plus photos inside the article, from the image sources above, each with alt text and credit.
          </span>
        </label>
        {field('inlineImages', 'Photos inside each article', 0, 4, 'Besides the cover photo. Placed after the first paragraph of evenly spread sections.')}
      </div>
      <div className="grid gap-4 border-t border-stone-200 pt-4 dark:border-stone-800 sm:grid-cols-2">
        {field('maxResearchQuestions', 'Research questions per article', 1, 10, 'Each question is one web search call.')}
        {field('maxSources', 'Maximum sources per article', 3, 40)}
        {field('defaultLength', 'Default length (words)', 300, 5000)}
        {field('dailyJobLimit', 'Articles per day (limit)', 1, 200)}
        {field('outdatedAfterMonths', 'Flag sources older than (months)', 1, 120)}
        <div>
          <label htmlFor="ai-resultStatus" className="label">
            Finished AI articles become
          </label>
          <select id="ai-resultStatus" className="input" value={s.resultStatus} onChange={(e) => setS({ ...s, resultStatus: e.target.value as AiSettings['resultStatus'] })}>
            <option value="pending_approval">Pending approval</option>
            <option value="draft">Draft</option>
          </select>
          <p className="mt-1 text-xs text-stone-500">AI articles are never published without a person approving them.</p>
        </div>
        <div>
          <label htmlFor="ai-defaultStyle" className="label">
            Default writing style
          </label>
          <input id="ai-defaultStyle" maxLength={120} className="input" value={s.defaultStyle} onChange={(e) => setS({ ...s, defaultStyle: e.target.value })} />
        </div>
        <div>
          <label htmlFor="ai-defaultLanguage" className="label">
            Default language
          </label>
          <input id="ai-defaultLanguage" required maxLength={60} className="input" value={s.defaultLanguage} onChange={(e) => setS({ ...s, defaultLanguage: e.target.value })} />
        </div>
        <div>
          <label htmlFor="ai-defaultCountry" className="label">
            Default target country
          </label>
          <input id="ai-defaultCountry" maxLength={80} className="input" value={s.defaultCountry} onChange={(e) => setS({ ...s, defaultCountry: e.target.value })} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}

export default function AiProvidersPage() {
  const providers = useFetch(() => api.get<{ items: AiProvider[]; secretsKeyConfigured: boolean }>('/admin/ai/providers'), []);
  const settings = useFetch(() => api.get<{ settings: AiSettings }>('/admin/ai/settings'), []);

  if ((providers.loading && !providers.data) || (settings.loading && !settings.data)) return <Spinner />;
  if (providers.error || !providers.data) return <ErrorState message={providers.error || 'Could not load providers'} onRetry={providers.reload} />;
  if (settings.error || !settings.data) return <ErrorState message={settings.error || 'Could not load settings'} onRetry={settings.reload} />;

  const update = (p: AiProvider) => providers.setData({ ...providers.data!, items: providers.data!.items.map((x) => (x.key === p.key ? p : x)) });

  return (
    <div>
      <PageHeader title="AI Providers" subtitle="API keys, models, fallback order and limits for the AI Content Studio." />
      {!providers.data.secretsKeyConfigured && (
        <p className="mb-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          SECRETS_KEY is missing from server\.env, so API keys cannot be stored. Run setup.bat, then restart start-dev.bat.
        </p>
      )}
      <div className="space-y-6">
        <SettingsCard initial={settings.data.settings} providers={providers.data.items} />
        <h2 className="pt-2 font-sans text-xl font-semibold">Text AI providers</h2>
        <div className="grid gap-6 xl:grid-cols-2">
          {providers.data.items
            .filter((p) => p.kind !== 'image')
            .map((p) => (
              <ProviderCard key={p.key} provider={p} secretsOk={providers.data!.secretsKeyConfigured} onChange={update} />
            ))}
        </div>
        <div className="pt-2">
          <h2 className="font-sans text-xl font-semibold">Image sources</h2>
          <p className="text-sm text-stone-500">
            Free photos for AI articles, credited to the photographer. One free key is enough to start; add more so another library takes over when one is busy. Images are never generated by AI.
          </p>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          {providers.data.items
            .filter((p) => p.kind === 'image')
            .map((p) => (
              <ProviderCard key={p.key} provider={p} secretsOk={providers.data!.secretsKeyConfigured} onChange={update} />
            ))}
        </div>
        <p className="text-xs text-stone-500">Web search is billed by each provider per search on top of normal usage once any free allowance is used. Check each provider's current pricing before generating many articles.</p>
      </div>
    </div>
  );
}
