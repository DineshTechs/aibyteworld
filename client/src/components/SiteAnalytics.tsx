import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { gaPageView, getConsent, gtmPageView, loadGoogleAnalytics, loadTagManager, setConsent, stopGoogleAnalytics, type Consent } from '../services/analytics';

// Google Analytics and/or Tag Manager with a cookie banner. Without either ID
// nothing is loaded and no banner is shown (the built-in analytics use no cookies).
export function SiteAnalytics() {
  const { settings, loaded } = useSettings();
  const { pathname, search } = useLocation();
  const [consent, setLocal] = useState<Consent>(getConsent());
  const id = settings.analytics?.gaMeasurementId || '';
  const gtm = settings.analytics?.gtmContainerId || '';
  const askFirst = settings.analytics?.consentBanner !== false;
  const allowed = Boolean(id || gtm) && (!askFirst || consent === 'granted');

  useEffect(() => {
    const onChange = () => setLocal(getConsent());
    window.addEventListener('consent:change', onChange);
    return () => window.removeEventListener('consent:change', onChange);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    if (id) loadGoogleAnalytics(id);
    if (gtm) loadTagManager(gtm);
  }, [allowed, id, gtm]);

  useEffect(() => {
    if (!allowed) return undefined;
    // Wait for the new page to set its title.
    const t = window.setTimeout(() => {
      gaPageView(pathname + search);
      gtmPageView(pathname + search);
    }, 300);
    return () => window.clearTimeout(t);
  }, [allowed, pathname, search]);

  if (!loaded || !(id || gtm) || !askFirst || consent) return null;
  return (
    <div role="dialog" aria-live="polite" aria-label="Cookie consent" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border border-stone-200 bg-white p-4 shadow-lg dark:border-stone-700 dark:bg-stone-900 sm:inset-x-6">
      <p className="text-sm text-stone-700 dark:text-stone-200">
        We use Google Analytics cookies to understand which articles readers find useful. You can say no; the site works the same either way.{' '}
        <Link to="/privacy" className="font-medium text-brand-700 underline dark:text-brand-300">
          Privacy policy
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setConsent('denied');
            stopGoogleAnalytics();
          }}
        >
          Decline
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setConsent('granted')}>
          Accept
        </button>
      </div>
    </div>
  );
}

// Footer link that lets visitors change their answer.
export function CookieSettingsLink() {
  const { settings } = useSettings();
  if (!(settings.analytics?.gaMeasurementId || settings.analytics?.gtmContainerId) || settings.analytics?.consentBanner === false) return null;
  return (
    <li>
      <button
        type="button"
        className="text-stone-600 hover:text-brand-700 dark:text-stone-300"
        onClick={() => {
          stopGoogleAnalytics();
          setConsent(null);
        }}
      >
        Cookie settings
      </button>
    </li>
  );
}
