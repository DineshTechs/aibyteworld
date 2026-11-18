import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUi } from '../context/UiContext';
import { useFetch } from '../hooks/useFetch';
import { prepareContent } from '../pages/public/ArticlePage';
import { api, errorMessage } from '../services/api';
import type { Article, ArticleStatus } from '../types';
import { Modal, PROSE, StatusBadge, formatDateTime } from './ui';

interface Extra {
  article: Article;
  translations: { _id: string; title: string; slug: string; status: ArticleStatus; language?: string; translationOf?: string }[];
  translationTask: { status: 'queued' | 'running' | 'completed' | 'failed'; error: string; createdAt: string } | null;
}

const CHANNEL: Record<string, string> = { telegram: 'Telegram channel', x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook' };

// Editor side panel: the waiting refreshed version, the Hindi version, and sharing.
export function ArticleGrowthPanel({ articleId, dirty, onApplied }: { articleId: string; dirty: boolean; onApplied: () => void }) {
  const { toast, confirm } = useUi();
  const { data, reload } = useFetch(() => api.get<Extra>(`/admin/articles/${articleId}`), [articleId]);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  const refresh = data?.article.refresh;
  const previewHtml = useMemo(() => (preview && refresh ? prepareContent(refresh.content).html : ''), [preview, refresh]);
  const translating = data?.translationTask?.status === 'queued' || data?.translationTask?.status === 'running';

  useEffect(() => {
    if (!translating) return undefined;
    const t = window.setInterval(reload, 8000);
    return () => window.clearInterval(t);
  }, [translating, reload]);

  if (!data) return null;
  const a = data.article;
  const published = a.status === 'published';
  const isTranslation = Boolean(a.translationOf);
  const hindi = data.translations.find((t) => t.language === 'hi');

  const act = async (key: string, fn: () => Promise<string>, after?: () => void) => {
    setBusy(key);
    try {
      toast(await fn());
      reload();
      after?.();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <section id="growth-panel" className="card space-y-4 p-5">
      <h2 className="font-sans text-base font-semibold">Reach</h2>

      {refresh && (
        <div className="space-y-2 rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm dark:border-brand-800 dark:bg-brand-950">
          <p className="font-medium">An updated version is ready</p>
          <p className="text-xs text-stone-600 dark:text-stone-300">
            From {formatDateTime(refresh.createdAt)}
            {refresh.words ? ` · ${refresh.words} words` : ''} · {refresh.sources?.length || 0} sources. Applying it keeps this address.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setPreview(true)}>
              Preview
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy === 'apply'}
              onClick={async () => {
                const msg = dirty ? 'Apply the updated version? Your unsaved changes in the editor will be lost.' : 'Replace the post with the updated version? The address stays the same.';
                if (!(await confirm(msg, { confirmLabel: 'Apply update' }))) return;
                act('apply', async () => {
                  await api.post(`/admin/articles/${articleId}/refresh/apply`);
                  return 'Update applied';
                }, onApplied);
              }}
            >
              Apply update
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy === 'discard'}
              onClick={async () => {
                if (await confirm('Discard the updated version? The post stays as it is.', { confirmLabel: 'Discard', danger: true }))
                  act('discard', async () => {
                    await api.delete(`/admin/articles/${articleId}/refresh`);
                    return 'Update discarded';
                  });
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 text-sm">
        <p className="font-medium">Hindi version</p>
        {isTranslation ? (
          <p className="text-stone-500">
            This is the Hindi version of{' '}
            {data.translations[0] ? (
              <Link to={`/admin/articles/${data.translations[0]._id}/edit`} className="text-brand-700 underline dark:text-brand-300">
                {data.translations[0].title}
              </Link>
            ) : (
              'a deleted post'
            )}
            .
          </p>
        ) : (
          <>
            {hindi ? (
              <p className="flex flex-wrap items-center gap-2">
                <Link to={`/admin/articles/${hindi._id}/edit`} className="text-brand-700 underline dark:text-brand-300" lang="hi">
                  {hindi.title}
                </Link>
                <StatusBadge status={hindi.status} />
              </p>
            ) : (
              <p className="text-stone-500">No Hindi version yet.</p>
            )}
            {translating && <p className="text-xs text-stone-500">Translating… (this takes a minute or two)</p>}
            {data.translationTask?.status === 'failed' && <p className="text-xs text-red-600">Last attempt failed: {data.translationTask.error}</p>}
            <button
              type="button"
              className="btn btn-sm"
              disabled={translating || busy === 'tr' || !a.content}
              onClick={() =>
                act('tr', async () => {
                  await api.post(`/admin/articles/${articleId}/translate`, { lang: 'hi' });
                  return hindi ? 'Updating the Hindi version' : 'Translating into Hindi';
                })
              }
            >
              {hindi ? 'Update Hindi version' : 'Translate into Hindi'}
            </button>
          </>
        )}
      </div>

      {published && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Sharing</p>
          {a.shares?.length ? (
            <ul className="space-y-1 text-xs">
              {a.shares.map((s) => (
                <li key={s.channel} className={s.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}>
                  {CHANNEL[s.channel] || s.channel}: {s.ok ? `shared ${formatDateTime(s.at)}` : s.error || 'failed'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-stone-500">
              Not shared yet. Set up channels in{' '}
              <Link to="/admin/growth" className="underline">
                Growth &amp; Sharing
              </Link>
              .
            </p>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy === 'share'}
            onClick={() =>
              act('share', async () => {
                const r = await api.post<{ results: Record<string, { ok?: boolean; skipped?: string; error?: string }> }>(`/admin/articles/${articleId}/share`);
                const sent = Object.entries(r.results || {}).filter(([, v]) => v.ok).map(([k]) => CHANNEL[k] || k);
                return sent.length ? `Shared to ${sent.join(', ')}` : 'Nothing new to share';
              })
            }
          >
            Share now (new or failed channels)
          </button>
        </div>
      )}

      {published && !isTranslation && !refresh && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Refresh</p>
          <p className="text-xs text-stone-500">Research the topic again and write an updated version. It waits here for your approval.</p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy === 'refresh'}
            onClick={async () => {
              if (await confirm('Start a refresh? It uses the same AI providers and limits as a new article.', { confirmLabel: 'Start refresh' }))
                act('refresh', async () => {
                  await api.post(`/admin/articles/${articleId}/refresh`);
                  return 'Refresh started. Check Refresh Old Posts for progress.';
                });
            }}
          >
            Refresh with new research
          </button>
        </div>
      )}

      {preview && refresh && (
        <Modal title="Updated version" onClose={() => setPreview(false)} wide>
          <article>
            <h1 className="text-3xl font-bold text-stone-900 dark:text-stone-50">{refresh.title}</h1>
            <div className={`${PROSE} mt-6`} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </article>
        </Modal>
      )}
    </section>
  );
}
