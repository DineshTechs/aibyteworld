import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, PageHeader, Spinner, formatDateTime } from '../../components/ui';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage } from '../../services/api';
import type { GrowthView } from './growthTypes';

type Channel = 'telegram' | 'x' | 'linkedin' | 'facebook';

function StatusLine({ okAt, error }: { okAt: string | null; error: string }) {
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">Last problem: {error}</p>;
  if (okAt) return <p className="text-xs text-emerald-700 dark:text-emerald-400">Last shared {formatDateTime(okAt)}</p>;
  return null;
}

function Secret({ id, label, saved, value, onChange }: { id: string; label: string; saved: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} type="password" autoComplete="off" className="input font-mono" placeholder={saved ? 'Saved (encrypted) – paste to replace' : ''} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

const ext = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">
    {text}
  </a>
);

export default function GrowthPage() {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload, setData } = useFetch(() => api.get<GrowthView>('/admin/growth'), []);
  const [busy, setBusy] = useState('');
  const [share, setShare] = useState<GrowthView['share'] | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<GrowthView['links'] | null>(null);
  const [translation, setTranslation] = useState({ hindi: true, autoPublish: true });

  const fill = (v: GrowthView) => {
    setShare(v.share);
    setLinks(v.links);
    setTranslation({ hindi: v.translation.hindi, autoPublish: v.translation.autoPublish });
  };
  useEffect(() => {
    if (data && !share) fill(data);
  }, [data, share]);

  // Translations run in the background: refresh while some are waiting.
  useEffect(() => {
    if (!data?.translation.queued) return undefined;
    const t = window.setInterval(() => api.get<GrowthView>('/admin/growth').then(setData).catch(() => {}), 8000);
    return () => window.clearInterval(t);
  }, [data?.translation.queued, setData]);

  if ((loading && !data) || (data && (!share || !links))) return <Spinner />;
  if (error || !data || !share || !links) return <ErrorState message={error || 'Could not load growth settings'} onRetry={reload} />;
  const d = data;

  const run = async (key: string, fn: () => Promise<GrowthView>, ok?: string) => {
    setBusy(key);
    try {
      const v = await fn();
      setData(v);
      fill(v);
      if (ok) toast(ok);
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  const sec = (k: string) => secrets[k] || '';
  const setSec = (k: string) => (v: string) => setSecrets({ ...secrets, [k]: v });
  const setCh = <C extends Channel>(ch: C, patch: Partial<GrowthView['share'][C]>) => setShare({ ...share, [ch]: { ...share[ch], ...patch } });

  const saveShare = async () => {
    const opt = (k: string) => sec(k).trim() || undefined;
    const ok = await run(
      'share',
      () =>
        api.put<GrowthView>('/admin/growth', {
          share: {
            telegram: { enabled: share.telegram.enabled, channel: share.telegram.channel.trim() },
            x: { enabled: share.x.enabled, apiKey: opt('xApiKey'), apiSecret: opt('xApiSecret'), accessToken: opt('xAccessToken'), accessSecret: opt('xAccessSecret') },
            linkedin: { enabled: share.linkedin.enabled, token: opt('liToken'), author: share.linkedin.author.trim(), version: share.linkedin.version.trim() },
            facebook: { enabled: share.facebook.enabled, pageId: share.facebook.pageId.trim(), token: opt('fbToken') },
            hashtags: share.hashtags,
            includeTranslations: share.includeTranslations,
          },
        }),
      'Sharing settings saved',
    );
    if (ok) setSecrets({});
  };

  const check = async (ch: Channel) => {
    setBusy(`check-${ch}`);
    try {
      const r = await api.post<{ ok: boolean; message: string; growth: GrowthView }>(`/admin/growth/check/${ch}`);
      setData(r.growth);
      setShare({ ...share, [ch]: { ...share[ch], lastError: r.growth.share[ch].lastError }, ...(ch === 'linkedin' ? { linkedin: { ...share.linkedin, author: r.growth.share.linkedin.author, lastError: r.growth.share.linkedin.lastError } } : {}) });
      toast(r.message, r.ok ? 'success' : 'error');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const removeKeys = async (name: 'x' | 'linkedin' | 'facebook') => {
    if (await confirm('Remove the saved keys? Sharing to this network stops until you add them again.', { confirmLabel: 'Remove', danger: true })) run(`rm-${name}`, () => api.delete<GrowthView>(`/admin/growth/keys/${name}`), 'Keys removed');
  };

  const checkBtn = (ch: Channel, ready: boolean) => (
    <button type="button" className="btn btn-sm" disabled={!ready || busy === `check-${ch}`} onClick={() => check(ch)} title={ready ? 'Checks the connection without posting anything' : 'Save the details first'}>
      {busy === `check-${ch}` ? 'Checking…' : 'Check connection'}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Growth & Sharing" subtitle="Get each new post in front of more people: share it automatically, tell search engines straight away, link it to your other posts, and publish a Hindi version." />

      {!d.base && (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Your Site URL is {d.siteUrl ? <code>{d.siteUrl}</code> : 'empty'}, which only works on this computer. Sharing, IndexNow and newsletter links start working once you set your public address (for example https://yourblog.com) in{' '}
          <Link to="/admin/settings" className="font-medium underline">
            Website Settings
          </Link>
          . Until then nothing is posted.
        </p>
      )}

      {/* ---------- Auto-share ---------- */}
      <section className="card space-y-5 p-5">
        <div>
          <h2 className="font-sans text-lg font-semibold">Auto-share new posts</h2>
          <p className="text-sm text-stone-500">Every post is shared once to each network that is switched on, when it is published (by you, by the scheduler or by Autopilot). The message uses the post's title, summary, photo and tags.</p>
        </div>

        <div className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <Toggle checked={share.telegram.enabled} onChange={(v) => setCh('telegram', { enabled: v })}>
            <strong>Telegram channel</strong> (free, quickest to set up)
          </Toggle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tg-ch" className="label">
                Channel
              </label>
              <input id="tg-ch" className="input" placeholder="@yourchannel" value={share.telegram.channel} onChange={(e) => setCh('telegram', { channel: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">{checkBtn('telegram', Boolean(d.share.telegram.channel && d.share.telegram.botReady))}</div>
          </div>
          <p className="text-xs text-stone-500">
            {d.share.telegram.botReady ? (
              <>
                Create a public channel in Telegram, then add your bot <strong>@{d.share.telegram.botUsername}</strong> as a channel admin with “Post messages”.
              </>
            ) : (
              <>
                Uses your blog bot: set it up first under{' '}
                <Link to="/admin/telegram" className="underline">
                  Telegram
                </Link>
                .
              </>
            )}
          </p>
          <StatusLine okAt={d.share.telegram.lastOkAt} error={d.share.telegram.lastError} />
        </div>

        <div className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <Toggle checked={share.x.enabled} onChange={(v) => setCh('x', { enabled: v })}>
            <strong>X (Twitter)</strong>
          </Toggle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Secret id="x-ak" label="API key (consumer key)" saved={d.share.x.has.apiKey} value={sec('xApiKey')} onChange={setSec('xApiKey')} />
            <Secret id="x-as" label="API key secret" saved={d.share.x.has.apiSecret} value={sec('xApiSecret')} onChange={setSec('xApiSecret')} />
            <Secret id="x-at" label="Access token" saved={d.share.x.has.accessToken} value={sec('xAccessToken')} onChange={setSec('xAccessToken')} />
            <Secret id="x-ts" label="Access token secret" saved={d.share.x.has.accessSecret} value={sec('xAccessSecret')} onChange={setSec('xAccessSecret')} />
          </div>
          <p className="text-xs text-stone-500">
            In the {ext('https://developer.x.com/en/portal/dashboard', 'X developer portal')}, create an app with “Read and write” permission, then generate the access token and secret for your account. X may charge for API posts depending on your plan.
          </p>
          <div className="flex flex-wrap gap-2">
            {checkBtn('x', d.share.x.ready || Object.values(d.share.x.has).every(Boolean))}
            {d.share.x.has.apiKey && (
              <button type="button" className="btn btn-sm" onClick={() => removeKeys('x')} disabled={busy === 'rm-x'}>
                Remove keys
              </button>
            )}
          </div>
          <StatusLine okAt={d.share.x.lastOkAt} error={d.share.x.lastError} />
        </div>

        <div className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <Toggle checked={share.linkedin.enabled} onChange={(v) => setCh('linkedin', { enabled: v })}>
            <strong>LinkedIn</strong>
          </Toggle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Secret id="li-t" label={`Access token${d.share.linkedin.last4 ? ` (…${d.share.linkedin.last4})` : ''}`} saved={d.share.linkedin.hasToken} value={sec('liToken')} onChange={setSec('liToken')} />
            <div>
              <label htmlFor="li-a" className="label">
                Post as
              </label>
              <input id="li-a" className="input font-mono text-xs" placeholder="Filled in by Check connection" value={share.linkedin.author} onChange={(e) => setCh('linkedin', { author: e.target.value })} />
            </div>
            <div>
              <label htmlFor="li-v" className="label">
                API version
              </label>
              <input id="li-v" className="input" placeholder={`Automatic (${d.share.linkedin.versionUsed})`} value={share.linkedin.version} onChange={(e) => setCh('linkedin', { version: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-stone-500">
            Create an app at {ext('https://www.linkedin.com/developers/apps', 'LinkedIn Developers')} with the “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect” products, then generate a token with the <code>w_member_social</code>, <code>openid</code> and <code>profile</code> scopes. “Check connection” fills in your profile. To post as a company page use <code>urn:li:organization:ID</code> (needs page admin rights). Tokens last about 60 days.
          </p>
          <div className="flex flex-wrap gap-2">
            {checkBtn('linkedin', d.share.linkedin.hasToken)}
            {d.share.linkedin.hasToken && (
              <button type="button" className="btn btn-sm" onClick={() => removeKeys('linkedin')} disabled={busy === 'rm-linkedin'}>
                Remove token
              </button>
            )}
          </div>
          <StatusLine okAt={d.share.linkedin.lastOkAt} error={d.share.linkedin.lastError} />
        </div>

        <div className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <Toggle checked={share.facebook.enabled} onChange={(v) => setCh('facebook', { enabled: v })}>
            <strong>Facebook Page</strong>
          </Toggle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="fb-id" className="label">
                Page ID
              </label>
              <input id="fb-id" className="input" inputMode="numeric" value={share.facebook.pageId} onChange={(e) => setCh('facebook', { pageId: e.target.value })} />
            </div>
            <Secret id="fb-t" label={`Page access token${d.share.facebook.last4 ? ` (…${d.share.facebook.last4})` : ''}`} saved={d.share.facebook.hasToken} value={sec('fbToken')} onChange={setSec('fbToken')} />
          </div>
          <p className="text-xs text-stone-500">
            Create a Business app at {ext('https://developers.facebook.com/apps', 'Meta for Developers')}, then use the {ext('https://developers.facebook.com/tools/explorer', 'Graph API Explorer')} to get a long-lived <em>Page</em> token with <code>pages_manage_posts</code> and <code>pages_read_engagement</code>. The Page ID is under your Page's About → Page transparency.
          </p>
          <div className="flex flex-wrap gap-2">
            {checkBtn('facebook', Boolean(d.share.facebook.pageId && d.share.facebook.hasToken))}
            {d.share.facebook.hasToken && (
              <button type="button" className="btn btn-sm" onClick={() => removeKeys('facebook')} disabled={busy === 'rm-facebook'}>
                Remove token
              </button>
            )}
          </div>
          <StatusLine okAt={d.share.facebook.lastOkAt} error={d.share.facebook.lastError} />
        </div>

        <div className="grid gap-3 border-t border-stone-200 pt-4 dark:border-stone-800 sm:grid-cols-2">
          <div>
            <label htmlFor="sh-tags" className="label">
              Hashtags from the post's tags
            </label>
            <input id="sh-tags" type="number" min={0} max={5} className="input" value={share.hashtags} onChange={(e) => setShare({ ...share, hashtags: Number(e.target.value) })} />
          </div>
          <div className="self-end">
            <Toggle checked={share.includeTranslations} onChange={(v) => setShare({ ...share, includeTranslations: v })}>
              Also share Hindi versions
            </Toggle>
          </div>
        </div>
        {d.share.lastSkipped && <p className="text-xs text-amber-700 dark:text-amber-300">{d.share.lastSkipped}</p>}
        <button type="button" className="btn btn-primary" onClick={saveShare} disabled={busy === 'share'}>
          {busy === 'share' ? 'Saving…' : 'Save sharing settings'}
        </button>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ---------- IndexNow ---------- */}
        <section className="card space-y-3 p-5">
          <h2 className="font-sans text-lg font-semibold">Instant indexing (IndexNow)</h2>
          <p className="text-sm text-stone-500">Tells Bing, Yandex, Seznam, Naver and others the moment a post is published, changed or removed, so they visit it within minutes instead of days. Google does not use IndexNow; it reads your sitemap.</p>
          <Toggle checked={d.indexnow.enabled} onChange={(v) => run('indexnow', () => api.put<GrowthView>('/admin/growth', { indexnow: { enabled: v } }), v ? 'IndexNow on' : 'IndexNow off')}>
            Send new and changed posts to IndexNow
          </Toggle>
          <p className="text-xs text-stone-500">
            Key file: {d.indexnow.keyUrl ? ext(d.indexnow.keyUrl, d.indexnow.keyUrl) : <code>/{d.indexnow.key}.txt</code>} (served automatically).
          </p>
          {d.indexnow.lastResult && (
            <p className={`text-xs ${/^Failed/.test(d.indexnow.lastResult) ? 'text-red-600' : 'text-stone-500'}`}>
              {d.indexnow.lastPingAt ? `${formatDateTime(d.indexnow.lastPingAt)}: ` : ''}
              {d.indexnow.lastResult}
            </p>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={!d.base || !d.indexnow.enabled || busy === 'ping'}
            onClick={async () => {
              setBusy('ping');
              try {
                const r = await api.post<{ result: { ok?: boolean; urls?: number; skipped?: string; error?: string }; growth: GrowthView }>('/admin/growth/indexnow');
                setData(r.growth);
                toast(r.result.ok ? `Sent ${r.result.urls} addresses` : r.result.skipped || r.result.error || 'Not sent', r.result.ok ? 'success' : 'error');
              } catch (err) {
                toast(errorMessage(err), 'error');
              } finally {
                setBusy('');
              }
            }}
          >
            {busy === 'ping' ? 'Sending…' : 'Send my latest 50 posts now'}
          </button>
        </section>

        {/* ---------- Internal links ---------- */}
        <section className="card space-y-3 p-5">
          <h2 className="font-sans text-lg font-semibold">Automatic internal links</h2>
          <p className="text-sm text-stone-500">When a post mentions another post's main keyword word for word, that phrase links to it. Readers find more to read, and search engines understand your site better. Headings, captions and existing links are never changed.</p>
          <Toggle checked={links.enabled} onChange={(v) => setLinks({ ...links, enabled: v })}>
            Add links to related posts in new AI articles
          </Toggle>
          <Toggle checked={links.backfill} onChange={(v) => setLinks({ ...links, backfill: v })}>
            When a post is published, link up to 3 older posts to it
          </Toggle>
          <div className="max-w-xs">
            <label htmlFor="ln-max" className="label">
              Most links to add per article
            </label>
            <input id="ln-max" type="number" min={1} max={8} className="input" value={links.maxPerArticle} onChange={(e) => setLinks({ ...links, maxPerArticle: Number(e.target.value) })} />
          </div>
          <p className="text-xs text-stone-500">Links use each post's focus keyword and secondary keywords (set in the editor's SEO panel; AI articles fill them in).</p>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'links'} onClick={() => run('links', () => api.put<GrowthView>('/admin/growth', { links }), 'Link settings saved')}>
            Save
          </button>
        </section>

        {/* ---------- Hindi ---------- */}
        <section className="card space-y-3 p-5">
          <h2 className="font-sans text-lg font-semibold">Hindi versions (हिन्दी)</h2>
          <p className="text-sm text-stone-500">Each post can get a Hindi version at its own address (for example /blog/post-name-hi). Both versions point to each other for search engines (hreflang), and a “हिन्दी” menu link appears on the site once the first one is published.</p>
          <Toggle checked={translation.hindi} onChange={(v) => setTranslation({ ...translation, hindi: v })}>
            Translate every newly published post into Hindi automatically
          </Toggle>
          <Toggle checked={translation.autoPublish} onChange={(v) => setTranslation({ ...translation, autoPublish: v })}>
            Publish the Hindi version straight away when the original is published and the checks pass (same structure, links, citations and numbers). Otherwise it waits for approval.
          </Toggle>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'tr'} onClick={() => run('tr', () => api.put<GrowthView>('/admin/growth', { translation }), 'Translation settings saved')}>
            Save
          </button>
          <p className="text-xs text-stone-500">Translations use your writing providers (AI Providers), one post at a time. You can also translate any post from its editor.</p>
          {d.translation.recent.length > 0 && (
            <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
              {d.translation.recent.map((t) => (
                <li key={t._id} className="py-2">
                  {t.article ? (
                    <Link to={`/admin/articles/${t.article._id}/edit`} className="font-medium hover:text-brand-700">
                      {t.article.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{t.source?.title || 'Deleted post'}</span>
                  )}
                  <span className={`ml-2 text-xs ${t.status === 'failed' ? 'text-red-600' : 'text-stone-500'}`}>
                    {t.status === 'queued' ? 'waiting' : t.status === 'running' ? 'translating…' : t.status === 'completed' ? t.article?.status.replace('_', ' ') : 'failed'}
                    {t.error ? `: ${t.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- Photos ---------- */}
        <section className="card space-y-3 p-5">
          <h2 className="font-sans text-lg font-semibold">Faster photos</h2>
          <p className="text-sm text-stone-500">New photos get smaller WebP copies (480, 960 and 1600 pixels wide), and phones download the size they need. Faster pages rank better and keep visitors. Covers of 1200 pixels or more are preferred so posts can show as large cards in Google Discover.</p>
          {d.photos.available ? (
            <>
              <p className="text-sm">{d.photos.missing ? `${d.photos.missing} existing photo(s) have no smaller copies yet.` : 'All photos are optimised.'}</p>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!d.photos.missing || busy === 'photos'}
                onClick={async () => {
                  setBusy('photos');
                  try {
                    const r = await api.post<{ result: { optimised: number; posts: number }; growth: GrowthView }>('/admin/media/optimize');
                    setData(r.growth);
                    toast(`Optimised ${r.result.optimised} photo(s) in ${r.result.posts} post(s)`);
                  } catch (err) {
                    toast(errorMessage(err), 'error');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                {busy === 'photos' ? 'Optimising…' : 'Optimise existing photos (40 at a time)'}
              </button>
            </>
          ) : (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">The optimiser is not installed yet. Run setup.bat again (it installs the “sharp” image library), then restart the server.</p>
          )}
        </section>
      </div>
    </div>
  );
}
