import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../services/api';

export function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ kind: 'busy' });
    try {
      const r = await api.post<{ message: string }>('/public/newsletter', { email });
      setState({ kind: 'ok', text: r.message });
      setEmail('');
    } catch (err) {
      setState({ kind: 'error', text: errorMessage(err) });
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input id="newsletter-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="input flex-1" autoComplete="email" />
        <button type="submit" className="btn btn-primary" disabled={state.kind === 'busy' || !email}>
          {state.kind === 'busy' ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      {state.text && (
        <p role="status" className={`mt-2 text-sm ${state.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {state.text}
        </p>
      )}
    </form>
  );
}
