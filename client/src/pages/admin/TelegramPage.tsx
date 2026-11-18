import { useEffect, useState, type FormEvent } from 'react';
import { ErrorState, PageHeader, Spinner, formatDateTime } from '../../components/ui';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage } from '../../services/api';

interface TelegramView {
  enabled: boolean;
  hasToken: boolean;
  tokenLast4: string;
  botUsername: string;
  botLink: string;
  chats: { chatId: string; title: string; user: { name: string; role: string } | null; linkedAt: string }[];
  notify: Record<NotifyKey, boolean>;
  summaryTime: string;
  timezone: string;
  linkCode: { code: string; expiresAt: string; link: string } | null;
  lastPollAt: string | null;
  lastError: string;
}
type NotifyKey = 'held' | 'review' | 'submitted' | 'published' | 'failed' | 'dailySummary';

const NOTIFY: { key: NotifyKey; label: string; help: string }[] = [
  { key: 'held', label: 'Autopilot post waiting for approval', help: 'With the reasons it was held, and Publish / Reject buttons.' },
  { key: 'published', label: 'Autopilot published a post', help: 'When all quality checks passed.' },
  { key: 'review', label: 'AI Studio article ready for review', help: 'Articles you started in AI Content Studio, with buttons.' },
  { key: 'submitted', label: 'An author submitted a post', help: 'Posts sent for approval by authors, with buttons.' },
  { key: 'failed', label: 'Problems', help: 'An AI article failed, or Autopilot skipped a scheduled post.' },
  { key: 'dailySummary', label: 'Daily summary', help: 'Posts published, posts waiting, and visitors.' },
];

export default function TelegramPage() {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload, setData } = useFetch(() => api.get<TelegramView>('/admin/telegram'), []);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');

  // While a link code is open, refresh so the new chat appears without reloading.
  useEffect(() => {
    if (!data?.linkCode) return undefined;
    const t = window.setInterval(() => api.get<TelegramView>('/admin/telegram').then(setData).catch(() => {}), 4000);
    return () => window.clearInterval(t);
  }, [data?.linkCode, setData]);

  const run = async (key: string, fn: () => Promise<TelegramView>, ok?: string) => {
    setBusy(key);
    try {
      setData(await fn());
      if (ok) toast(ok);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error || 'Could not load Telegram settings'} onRetry={reload} />;
  const d = data;

  const saveToken = (e: FormEvent) => {
    e.preventDefault();
    run('token', () => api.put<TelegramView>('/admin/telegram', { token: token.trim() }), 'Bot connected').then(() => setToken(''));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Telegram"
        subtitle="Get notified on Telegram and approve or reject posts from your phone. The bot only answers chats you link here."
      />

      <section className="card space-y-4 p-5">
        <h2 className="font-sans text-base font-semibold">1. Connect your bot</h2>
        {d.hasToken ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Connected to{' '}
              <a href={d.botLink} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                @{d.botUsername}
              </a>{' '}
              (token ending ••••{d.tokenLast4}, stored encrypted).
            </span>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={d.enabled} disabled={busy === 'enable'} onChange={(e) => run('enable', () => api.put<TelegramView>('/admin/telegram', { enabled: e.target.checked }), e.target.checked ? 'Bot turned on' : 'Bot turned off')} />
              Bot on
            </label>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                if (await confirm('Remove the bot? Notifications stop and linked chats are removed. You can connect a bot again later.', { confirmLabel: 'Remove', danger: true }))
                  run('remove', () => api.delete<TelegramView>('/admin/telegram/token'), 'Bot removed');
              }}
            >
              Remove bot
            </button>
          </div>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
            <li>
              In Telegram, open{' '}
              <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                @BotFather
              </a>{' '}
              and send <code>/newbot</code>. Choose a name and a username ending in “bot”.
            </li>
            <li>Copy the token it gives you (it looks like 123456789:AAH…) and paste it below.</li>
          </ol>
        )}
        <form onSubmit={saveToken} className="flex flex-wrap gap-2">
          <label htmlFor="tg-token" className="sr-only">
            Bot token
          </label>
          <input id="tg-token" type="password" autoComplete="off" className="input max-w-md font-mono" placeholder={d.hasToken ? 'Paste a new token to replace it' : '123456789:AAH...'} value={token} onChange={(e) => setToken(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!token.trim() || busy === 'token'}>
            {busy === 'token' ? 'Checking…' : d.hasToken ? 'Replace token' : 'Connect bot'}
          </button>
        </form>
        {d.lastError && <p className="text-sm text-red-600">Last problem: {d.lastError}</p>}
        {d.enabled && d.lastPollAt && <p className="text-xs text-stone-500">Listening for messages (last check {formatDateTime(d.lastPollAt)}). The blog server must be running for the bot to answer.</p>}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-sans text-base font-semibold">2. Link your Telegram</h2>
        {!d.hasToken ? (
          <p className="text-sm text-stone-500">Connect a bot first.</p>
        ) : (
          <>
            {d.linkCode ? (
              <div className="rounded-lg bg-brand-50 p-4 text-sm dark:bg-stone-800">
                <p>
                  <a href={d.linkCode.link} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                    Open @{d.botUsername} in Telegram
                  </a>
                </p>
                <p className="mt-2">
                  Then tap <strong>Start</strong>. Or send the bot: <code className="select-all">/start {d.linkCode.code}</code>
                </p>
                <p className="mt-1 text-xs text-stone-500">This code works once and expires at {formatDateTime(d.linkCode.expiresAt)}. This page updates when the chat is linked.</p>
              </div>
            ) : (
              <button type="button" className="btn btn-primary" disabled={busy === 'link'} onClick={() => run('link', () => api.post<TelegramView>('/admin/telegram/link'))}>
                Link my Telegram
              </button>
            )}
            {d.chats.length > 0 && (
              <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
                {d.chats.map((c) => (
                  <li key={c.chatId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <strong>{c.title}</strong> · linked by {c.user?.name || 'a removed user'} on {formatDateTime(c.linkedAt)}
                      <span className="block text-xs text-stone-500">Approvals from this chat are recorded as {c.user?.name || 'that user'}. Only the person who linked it can press the buttons.</span>
                    </span>
                    <button type="button" className="btn btn-sm" onClick={() => run(`chat-${c.chatId}`, () => api.delete<TelegramView>(`/admin/telegram/chats/${c.chatId}`), 'Chat unlinked')}>
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {d.chats.length > 0 && (
              <button type="button" className="btn btn-sm" disabled={busy === 'test' || !d.enabled} onClick={() => run('test', () => api.post<TelegramView>('/admin/telegram/test'), 'Test message sent')}>
                Send a test message
              </button>
            )}
          </>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-sans text-base font-semibold">3. What to send</h2>
        <ul className="space-y-3">
          {NOTIFY.map((n) => (
            <li key={n.key}>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={d.notify[n.key]} disabled={busy === n.key} onChange={(e) => run(n.key, () => api.put<TelegramView>('/admin/telegram', { notify: { [n.key]: e.target.checked } }))} />
                <span>
                  <strong>{n.label}</strong>
                  <span className="block text-xs text-stone-500">{n.help}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="tg-time" className="label">
              Daily summary time ({d.timezone})
            </label>
            <input
              id="tg-time"
              type="time"
              className="input w-36"
              defaultValue={d.summaryTime}
              key={d.summaryTime}
              onBlur={(e) => e.target.value && e.target.value !== d.summaryTime && run('time', () => api.put<TelegramView>('/admin/telegram', { summaryTime: e.target.value }), 'Summary time saved')}
            />
          </div>
        </div>
      </section>

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="font-sans text-base font-semibold">Commands you can send the bot</h2>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li><code>/pending</code> – posts waiting for approval, with buttons</li>
          <li><code>/status</code> – Autopilot and AI providers</li>
          <li><code>/stats</code> – visitors today and this week</li>
          <li><code>/run</code> – start an Autopilot post now</li>
          <li><code>/autopilot_on</code>, <code>/autopilot_off</code></li>
          <li><code>/unlink</code> – stop messages to that chat</li>
        </ul>
        <p className="text-xs text-stone-500">Publish puts the post live straight away. Reject moves it back to drafts so you can edit or delete it here.</p>
      </section>
    </div>
  );
}
