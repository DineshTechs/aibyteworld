import { tokenStore } from './api';

// ---------- Built-in, cookie-free analytics ----------
// Sends "view", "read" and "time" events for a post. Nothing is sent for
// signed-in staff (so writing and previewing do not count) or for automated
// browsers. The server counts each visitor once per post per day.

const skip = () => Boolean(tokenStore.get()) || (typeof navigator !== 'undefined' && navigator.webdriver);

function send(body: Record<string, unknown>, beacon = false) {
  const json = JSON.stringify(body);
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/public/track', new Blob([json], { type: 'application/json' }));
      return;
    }
    fetch('/api/public/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
  } catch {
    /* analytics must never break the page */
  }
}

/**
 * Tracks one visit to a post. A visit counts as a "read" once the reader has
 * reached 60% of the article and been active for at least 30% of its reading
 * time (between 15 seconds and 2 minutes). Active time stops while the tab is
 * hidden or the reader has been idle for 30 seconds. Returns a cleanup function.
 */
export function trackArticle(articleId: string, readingMinutes: number, body: HTMLElement | null): () => void {
  if (skip()) return () => {};
  send({ articleId, type: 'view', referrer: document.referrer.slice(0, 500) });

  const needSeconds = Math.min(120, Math.max(15, Math.round(readingMinutes * 60 * 0.3)));
  let active = 0;
  let lastActivity = Date.now();
  let maxDepth = 0;
  let readSent = false;
  let timeSent = false;

  const depth = () => {
    if (!body) return 1;
    const rect = body.getBoundingClientRect();
    const seen = window.innerHeight - rect.top;
    return rect.height > 0 ? Math.max(0, Math.min(1, seen / rect.height)) : 1;
  };
  const onActivity = () => {
    lastActivity = Date.now();
    maxDepth = Math.max(maxDepth, depth());
  };
  const tick = window.setInterval(() => {
    if (document.visibilityState !== 'visible' || Date.now() - lastActivity > 30000) return;
    active += 1;
    maxDepth = Math.max(maxDepth, depth());
    if (!readSent && active >= needSeconds && maxDepth >= 0.6) {
      readSent = true;
      send({ articleId, type: 'read' });
    }
  }, 1000);
  const sendTime = () => {
    if (timeSent || active < 1) return;
    timeSent = true;
    send({ articleId, type: 'time', seconds: active }, true);
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') sendTime();
  };
  const events = ['scroll', 'mousemove', 'keydown', 'touchstart', 'click'] as const;
  events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', sendTime);
  onActivity();

  return () => {
    sendTime();
    window.clearInterval(tick);
    events.forEach((e) => window.removeEventListener(e, onActivity));
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', sendTime);
  };
}

// ---------- Cookie consent (for Google Analytics) ----------
const CONSENT_KEY = 'blogsite_consent';
export type Consent = 'granted' | 'denied' | null;

export function getConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(value: Consent) {
  try {
    if (value) localStorage.setItem(CONSENT_KEY, value);
    else localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event('consent:change'));
}

// ---------- Google Analytics 4 ----------
// Loaded only when a measurement ID is set and (with the consent banner on)
// the visitor has accepted. Page views are sent on every route change.
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
let gaLoadedId = '';

export function loadGoogleAnalytics(id: string) {
  if (!/^G-[A-Z0-9]{4,20}$/.test(id) || gaLoadedId === id || skip()) return;
  gaLoadedId = id;
  window.dataLayer = window.dataLayer || [];
  // gtag must push the arguments object itself.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
  window.gtag('js', new Date());
  window.gtag('config', id, { send_page_view: false, anonymize_ip: true });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

export function gaPageView(path: string) {
  if (!gaLoadedId || !window.gtag) return;
  window.gtag('event', 'page_view', { page_path: path, page_location: window.location.href, page_title: document.title });
}

// Withdrawing consent: stop sending and remove Google Analytics cookies.
export function stopGoogleAnalytics() {
  if (window.gtag) window.gtag('consent', 'update', { analytics_storage: 'denied' });
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name === '_ga' || name.startsWith('_ga_')) {
      const host = window.location.hostname;
      for (const domain of ['', host, `.${host.replace(/^www\./, '')}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
      }
    }
  }
}
