import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, PageHeader, Pagination, Spinner, formatDate, formatDateTime } from '../../components/ui';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage, qs, tokenStore } from '../../services/api';
import type { Paged } from '../../types';
import type { GrowthView } from './growthTypes';

interface Subscriber {
  _id: string;
  email: string;
  status: 'pending' | 'subscribed' | 'unsubscribed';
  createdAt: string;
  confirmedAt?: string;
  lastSentAt?: string;
}

type Form = Omit<GrowthView['newsletter'], 'history' | 'subscribers' | 'ready' | 'hasKey' | 'last4' | 'lastOkAt' | 'lastError' | 'timezone'>;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function NewsletterAdminPage() {
  const { toast, confirm } = useUi();
  const growth = useFetch(() => api.get<GrowthView>('/admin/growth'), []);
  const [filter, setFilter] = useState<{ status: string; q: string; page: number }>({ status: 'subscribed', q: '', page: 1 });
  const subs = useFetch(() => api.get<Paged<Subscriber>>(`/admin/newsletter/subscribers${qs({ status: filter.status, q: filter.q, page: filter.page })}`), [filter.status, filter.q, filter.page]);
  const [form, setForm] = useState<Form | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (growth.data && !form) {
      const n = growth.data.newsletter;
      setForm({ provider: n.provider, fromEmail: n.fromEmail, fromName: n.fromName, replyTo: n.replyTo, doubleOptIn: n.doubleOptIn, digest: n.digest });
    }
  }, [growth.data, form]);

  if ((growth.loading && !growth.data) || (growth.data && !form)) return <Spinner />;
  if (growth.error || !growth.data || !form) return <ErrorState message={growth.error || 'Could not load the newsletter settings'} onRetry={growth.reload} />;
  const n = growth.data.newsletter;
  const base = growth.data.base;

  const save = async () => {
    setBusy('save');
    try {
      const v = await api.put<GrowthView>('/admin/growth', { newsletter: { ...form, digest: { enabled: form.digest.enabled, day: form.digest.day, time: form.digest.time, maxPosts: form.digest.maxPosts }, apiKey: apiKey.trim() || undefined } });
      growth.setData(v);
      setApiKey('');
      toast('Newsletter settings saved');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const action = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast(await fn());
      growth.reload();
      subs.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  // The export needs the login token, so it is downloaded with fetch rather than a plain link.
  const exportCsv = async () => {
    setBusy('csv');
    try {
      const res = await fetch('/api/admin/newsletter/subscribers.csv', { headers: { Authorization: `Bearer ${tokenStore.get() || ''}` } });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setDigest = (patch: Partial<Form['digest']>) => setForm({ ...form, digest: { ...form.digest, ...patch } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Newsletter"
        subtitle={`${n.subscribers.subscribed} subscribed · ${n.subscribers.pending} waiting to confirm · ${n.subscribers.unsubscribed} unsubscribed`}
        actions={
          <button type="button" className="btn" onClick={exportCsv} disabled={busy === 'csv'}>
            Export CSV
          </button>
        }
      />

      {!base && (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Emails can only be sent once your public Site URL is set in{' '}
          <Link to="/admin/settings" className="font-medium underline">
            Website Settings
          </Link>
          , because the links in them must open for readers. You can still send yourself a test.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card space-y-4 p-5">
          <h2 className="font-sans text-lg font-semibold">Email sending</h2>
          <div>
            <label htmlFor="nl-p" className="label">
              Email service
            </label>
            <select id="nl-p" className="input" value={form.provider} onChange={(e) => set({ provider: e.target.value as Form['provider'] })}>
              <option value="none">Not set up</option>
              <option value="brevo">Brevo (free: 300 emails a day)</option>
              <option value="resend">Resend (free: 3,000 emails a month)</option>
            </select>
          </div>
          {form.provider !== 'none' && (
            <>
              <div>
                <label htmlFor="nl-k" className="label">
                  API key{n.last4 ? ` (…${n.last4})` : ''}
                </label>
                <input id="nl-k" type="password" autoComplete="off" className="input font-mono" placeholder={n.hasKey ? 'Saved (encrypted) – paste to replace' : ''} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <p className="mt-1 text-xs text-stone-500">
                  {form.provider === 'brevo' ? (
                    <>
                      Brevo → {' '}
                      <a className="underline" href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noopener noreferrer">
                        SMTP &amp; API → API keys
                      </a>
                      . Add and verify your sender address under Senders &amp; IP.
                    </>
                  ) : (
                    <>
                      Resend →{' '}
                      <a className="underline" href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">
                        API Keys
                      </a>
                      . Verify your domain under Domains first.
                    </>
                  )}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="nl-from" className="label">
                    Sender address
                  </label>
                  <input id="nl-from" type="email" className="input" placeholder="news@yourblog.com" value={form.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="nl-name" className="label">
                    Sender name
                  </label>
                  <input id="nl-name" className="input" placeholder="Your blog name" value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="nl-reply" className="label">
                    Replies go to (optional)
                  </label>
                  <input id="nl-reply" type="email" className="input" value={form.replyTo} onChange={(e) => set({ replyTo: e.target.value })} />
                </div>
              </div>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={form.doubleOptIn} onChange={(e) => set({ doubleOptIn: e.target.checked })} />
                <span>Ask new subscribers to confirm by email (recommended: keeps fake addresses out and protects your sender reputation)</span>
              </label>
            </>
          )}
          {n.lastError && <p className="text-sm text-red-600">Last problem: {n.lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn" disabled={!n.ready || busy === 'test'} onClick={() => action('test', async () => (await api.post<{ message: string }>('/admin/newsletter/test')).message)}>
              {busy === 'test' ? 'Sending…' : 'Send me a test'}
            </button>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-sans text-lg font-semibold">Weekly digest</h2>
          <p className="text-sm text-stone-500">The most-read posts of the week, sent to every confirmed subscriber with a one-click unsubscribe link. Nothing is sent in a week without new posts.</p>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={form.digest.enabled} onChange={(e) => setDigest({ enabled: e.target.checked })} />
            <span>Send the digest automatically</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="dg-day" className="label">
                Day
              </label>
              <select id="dg-day" className="input" value={form.digest.day} onChange={(e) => setDigest({ day: Number(e.target.value) })}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dg-time" className="label">
                Time ({n.timezone})
              </label>
              <input id="dg-time" type="time" className="input" value={form.digest.time} onChange={(e) => setDigest({ time: e.target.value })} />
            </div>
            <div>
              <label htmlFor="dg-max" className="label">
                Posts per email
              </label>
              <input id="dg-max" type="number" min={1} max={12} className="input" value={form.digest.maxPosts} onChange={(e) => setDigest({ maxPosts: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy === 'save'}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              disabled={!n.ready || !base || busy === 'send'}
              onClick={async () => {
                if (!(await confirm(`Send this week's digest now to ${n.subscribers.subscribed} subscriber(s)?`, { confirmLabel: 'Send now' }))) return;
                action('send', async () => {
                  const r = await api.post<{ sent: number; failed: number; posts: number; error?: string }>('/admin/newsletter/send', {});
                  return r.posts ? `Sent to ${r.sent} subscriber(s)${r.failed ? `, ${r.failed} failed${r.error ? `: ${r.error}` : ''}` : ''}` : 'No new posts in the last 7 days, so nothing was sent';
                });
              }}
            >
              {busy === 'send' ? 'Sending…' : 'Send now'}
            </button>
          </div>
          {n.history.length > 0 && (
            <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
              {n.history.slice(0, 8).map((h) => (
                <li key={`${h.at}-${h.kind}`} className="py-2">
                  <span className="text-stone-500">{formatDateTime(h.at)}</span> · {h.kind === 'weekly' ? 'Weekly' : 'Sent by hand'}: {h.posts ? `${h.sent} sent${h.failed ? `, ${h.failed} failed` : ''} (${h.posts} posts)` : 'nothing sent'}
                  {h.note && <p className="text-xs text-stone-500">{h.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-sans text-lg font-semibold">Subscribers</h2>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Status" className="input w-auto" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value, page: 1 })}>
              <option value="subscribed">Subscribed</option>
              <option value="pending">Waiting to confirm</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="">All</option>
            </select>
            <input aria-label="Search email" type="search" className="input w-48" placeholder="Search email" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value, page: 1 })} />
          </div>
        </div>
        {subs.loading && !subs.data ? (
          <Spinner />
        ) : subs.error ? (
          <ErrorState message={subs.error} onRetry={subs.reload} />
        ) : !subs.data?.items.length ? (
          <p className="text-sm text-stone-500">No subscribers here yet. The signup box is in the site footer.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-stone-500">
                  <tr>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Signed up</th>
                    <th className="py-2 pr-4">Last email</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                  {subs.data.items.map((s) => (
                    <tr key={s._id}>
                      <td className="py-2 pr-4 font-mono text-xs">{s.email}</td>
                      <td className="py-2 pr-4">{s.status === 'pending' ? 'waiting to confirm' : s.status}</td>
                      <td className="py-2 pr-4">{formatDate(s.createdAt)}</td>
                      <td className="py-2 pr-4">{s.lastSentAt ? formatDate(s.lastSentAt) : '–'}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={async () => {
                            if (await confirm(`Delete ${s.email} from the list? Use this when someone asks to be removed.`, { confirmLabel: 'Delete', danger: true }))
                              action(`del-${s._id}`, async () => {
                                await api.delete(`/admin/newsletter/subscribers/${s._id}`);
                                return 'Subscriber deleted';
                              });
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={subs.data.page} pages={subs.data.pages} onPage={(p) => setFilter({ ...filter, page: p })} />
          </>
        )}
      </section>
    </div>
  );
}
