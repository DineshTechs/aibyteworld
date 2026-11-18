import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ErrorState, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  roles?: ('admin' | 'editor' | 'author')[];
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/analytics', label: 'Analytics', roles: ['admin', 'editor'] },
  { to: '/admin/ai/studio', label: 'AI Content Studio', roles: ['admin', 'editor'] },
  { to: '/admin/ai/jobs', label: 'Research History', roles: ['admin', 'editor'] },
  { to: '/admin/articles', label: 'Articles', end: true },
  { to: '/admin/articles/new', label: 'Manual Editor' },
  { to: '/admin/categories', label: 'Categories', roles: ['admin', 'editor'] },
  { to: '/admin/tags', label: 'Tags', roles: ['admin', 'editor'] },
  { to: '/admin/media', label: 'Media Library' },
  { to: '/admin/refresh', label: 'Refresh Old Posts', roles: ['admin', 'editor'] },
  { to: '/admin/growth', label: 'Growth & Sharing', roles: ['admin'] },
  { to: '/admin/newsletter', label: 'Newsletter', roles: ['admin'] },
  { to: '/admin/ai/autopilot', label: 'Autopilot', roles: ['admin'] },
  { to: '/admin/ai/providers', label: 'AI Providers', roles: ['admin'] },
  { to: '/admin/telegram', label: 'Telegram', roles: ['admin'] },
  { to: '/admin/settings', label: 'Website Settings', roles: ['admin'] },
  { to: '/admin/users', label: 'User Management', roles: ['admin'] },
  { to: '/admin/activity', label: 'Activity Logs', roles: ['admin'] },
];

export default function AdminLayout() {
  const { user, loading, logout, sessionError, retrySession } = useAuth();
  const { settings } = useSettings();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    document.title = `Admin | ${settings.siteName}`;
    // Keep search engines out of the dashboard.
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow';
  }, [location.pathname, settings.siteName]);

  if (loading) return <Spinner label="Checking your session…" />;
  if (sessionError) return <ErrorState message={`Could not reach the server to check your session. ${sessionError}`} onRetry={retrySession} />;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));

  return (
    <div className="min-h-screen lg:flex">
      <aside className={`${open ? 'block' : 'hidden'} fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 lg:static lg:block lg:shrink-0`}>
        <div className="flex h-16 items-center border-b border-stone-200 px-5 dark:border-stone-800">
          <Link to="/admin" className="font-serif text-xl font-bold text-stone-900 dark:text-white">
            {settings.siteName}
          </Link>
        </div>
        <nav className="space-y-1 p-3" aria-label="Admin">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-200 p-3 dark:border-stone-800">
          <a href="/" target="_blank" rel="noopener noreferrer" className="block rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
            View website ↗
          </a>
        </div>
      </aside>
      {open && <button type="button" className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-stone-200 bg-stone-50/90 px-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90 sm:px-6">
          <button type="button" className="btn btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰ Menu
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
            <Link to="/admin/profile" className="btn btn-sm">
              {user.name} <span className="text-stone-400">({user.role})</span>
            </Link>
            <button type="button" className="btn btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// Route guard for sections limited to certain roles.
export function RequireRole({ roles }: { roles: ('admin' | 'editor' | 'author')[] }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return (
      <div className="card mx-auto mt-10 max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-stone-500">Your account does not have permission to view this section.</p>
      </div>
    );
  }
  return <Outlet />;
}
