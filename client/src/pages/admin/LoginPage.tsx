import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { errorMessage } from '../../services/api';

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const { settings } = useSettings();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith('/admin') ? from : '/admin'} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <p className="font-serif text-2xl font-bold text-stone-900 dark:text-white">{settings.siteName}</p>
        <h1 className="mt-1 font-sans text-sm text-stone-500">Sign in to the admin dashboard</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <Link to="/" className="mt-5 block text-center text-sm text-stone-500 hover:text-brand-700">
          ← Back to website
        </Link>
      </div>
    </div>
  );
}
