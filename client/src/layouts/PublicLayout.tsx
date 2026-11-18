import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NewsletterForm } from '../components/NewsletterForm';
import { CookieSettingsLink, SiteAnalytics } from '../components/SiteAnalytics';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/blog', label: 'Blog' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

function SearchBox({ onDone }: { onDone?: () => void }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
    setQ('');
    onDone?.();
  };
  return (
    <form onSubmit={submit} role="search" className="flex">
      <label htmlFor="site-search" className="sr-only">
        Search articles
      </label>
      <input id="site-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…" className="input w-full rounded-r-none sm:w-52" />
      <button type="submit" className="btn rounded-l-none border-l-0" aria-label="Search">
        Search
      </button>
    </form>
  );
}

export default function PublicLayout() {
  const { settings } = useSettings();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();

  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium transition ${isActive ? 'text-brand-700 dark:text-brand-300' : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-white'}`;
  const social = Object.entries(settings.social).filter(([, url]) => url);
  // A "हिन्दी" link appears once Hindi versions of posts are published.
  const hindi = settings.languages?.includes('hi');
  const nav = hindi ? [...NAV.slice(0, 2), { to: '/blog?lang=hi', label: 'हिन्दी', lang: 'hi' }, ...NAV.slice(2)] : NAV;
  const navClass = (n: { to: string; lang?: string }) => ({ isActive }: { isActive: boolean }) =>
    linkClass({ isActive: n.lang ? isActive && search.includes(`lang=${n.lang}`) : isActive && !(n.to === '/blog' && search.includes('lang=')) });

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link to="/" className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-white">
            {settings.siteName}
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : undefined} className={navClass(n)} lang={'lang' in n ? n.lang : undefined}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden lg:block">
              <SearchBox />
            </div>
            <button type="button" className="btn btn-sm" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
            <button type="button" className="btn btn-sm lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-menu">
              Menu
            </button>
          </div>
        </div>
        {open && (
          <div id="mobile-menu" className="border-t border-stone-200 px-4 py-3 dark:border-stone-800 lg:hidden">
            <nav className="mb-3 flex flex-col md:hidden" aria-label="Mobile">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : undefined} className={navClass(n)} lang={'lang' in n ? n.lang : undefined}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <SearchBox onDone={() => setOpen(false)} />
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-16 border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="container-page grid gap-10 py-12 md:grid-cols-3">
          <div>
            <p className="font-serif text-xl font-bold text-stone-900 dark:text-white">{settings.siteName}</p>
            {settings.description && <p className="mt-2 text-sm text-stone-500">{settings.description}</p>}
            {social.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-3 text-sm">
                {social.map(([name, url]) => (
                  <li key={name}>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="capitalize text-stone-600 hover:text-brand-700 dark:text-stone-300">
                      {name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <nav aria-label="Footer">
            <p className="text-sm font-semibold uppercase tracking-wider text-stone-500">Explore</p>
            <ul className="mt-3 space-y-2 text-sm">
              {[...NAV, { to: '/privacy', label: 'Privacy Policy' }, { to: '/terms', label: 'Terms and Conditions' }].map((n) => (
                <li key={n.to}>
                  <Link to={n.to} className="text-stone-600 hover:text-brand-700 dark:text-stone-300">
                    {n.label}
                  </Link>
                </li>
              ))}
              <CookieSettingsLink />
            </ul>
          </nav>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-stone-500">Newsletter</p>
            <p className="mb-3 mt-3 text-sm text-stone-500">New articles in your inbox. No spam.</p>
            <NewsletterForm />
          </div>
        </div>
        <div className="border-t border-stone-200 py-4 text-center text-xs text-stone-500 dark:border-stone-800">
          © {new Date().getFullYear()} {settings.siteName}. All rights reserved.
        </div>
      </footer>
      <SiteAnalytics />
    </div>
  );
}
