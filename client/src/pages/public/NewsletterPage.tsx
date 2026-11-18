import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NewsletterForm } from '../../components/NewsletterForm';
import { Seo } from '../../components/Seo';
import { Spinner } from '../../components/ui';
import { api, errorMessage } from '../../services/api';

// Opened from the links in newsletter emails: confirms a signup or unsubscribes.
export default function NewsletterPage() {
  const [params] = useSearchParams();
  const confirm = params.get('confirm') || '';
  const unsubscribe = params.get('unsubscribe') === '1';
  const email = params.get('e') || '';
  const token = params.get('t') || '';
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({ kind: confirm ? 'busy' : 'idle' });
  const done = useRef(false);

  useEffect(() => {
    if (!confirm || done.current) return;
    done.current = true;
    api
      .post<{ message: string }>('/public/newsletter/confirm', { token: confirm })
      .then((r) => setState({ kind: 'ok', text: r.message }))
      .catch((err) => setState({ kind: 'error', text: errorMessage(err) }));
  }, [confirm]);

  // Unsubscribing waits for a click, so link scanners in email apps cannot unsubscribe people by accident.
  const leave = async () => {
    setState({ kind: 'busy' });
    try {
      const r = await api.post<{ message: string }>('/public/newsletter/unsubscribe', { e: email, t: token });
      setState({ kind: 'ok', text: r.message });
    } catch (err) {
      setState({ kind: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div className="container-page max-w-xl py-16">
      <Seo title="Newsletter" noindex />
      <h1 className="text-3xl font-semibold text-stone-900 dark:text-stone-50">Newsletter</h1>
      <div className="mt-6">
        {state.kind === 'busy' && <Spinner label="One moment…" />}
        {state.text && (
          <p role="status" className={`rounded-lg p-4 ${state.kind === 'error' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>
            {state.text}
          </p>
        )}
        {unsubscribe && state.kind === 'idle' && (
          <div className="card space-y-4 p-5">
            <p>
              Stop sending newsletter emails to <strong>{email}</strong>?
            </p>
            <button type="button" className="btn btn-primary" onClick={leave} disabled={!email || !token}>
              Unsubscribe
            </button>
          </div>
        )}
        {!confirm && !unsubscribe && (
          <div className="space-y-3">
            <p className="text-stone-600 dark:text-stone-400">Get the best new posts by email, once a week.</p>
            <NewsletterForm />
          </div>
        )}
        <p className="mt-8 text-sm">
          <Link to="/" className="text-brand-700 hover:underline dark:text-brand-300">
            ← Back to the home page
          </Link>
        </p>
      </div>
    </div>
  );
}
