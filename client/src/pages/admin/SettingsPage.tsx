import { useEffect, useState, type FormEvent } from 'react';
import { RichTextEditor } from '../../components/RichTextEditor';
import { ErrorState, PageHeader, Spinner } from '../../components/ui';
import { DEFAULT_SETTINGS, useSettings } from '../../context/SettingsContext';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage } from '../../services/api';
import type { SiteSettings } from '../../types';

type PageKey = keyof SiteSettings['pages'];
const PAGES: { key: PageKey; label: string }[] = [
  { key: 'about', label: 'About Us' },
  { key: 'privacy', label: 'Privacy Policy' },
  { key: 'terms', label: 'Terms and Conditions' },
];
const SOCIAL = ['twitter', 'facebook', 'linkedin', 'instagram'] as const;

export default function SettingsPage() {
  const { toast } = useUi();
  const { refresh } = useSettings();
  const { data, error, loading, reload } = useFetch(() => api.get<{ settings: SiteSettings }>('/admin/settings'), []);
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [tab, setTab] = useState<PageKey>('about');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data)
      setForm({
        ...DEFAULT_SETTINGS,
        ...data.settings,
        social: { ...DEFAULT_SETTINGS.social, ...data.settings.social },
        pages: { ...DEFAULT_SETTINGS.pages, ...data.settings.pages },
        analytics: { ...DEFAULT_SETTINGS.analytics, googleVerification: '', bingVerification: '', ...data.settings.analytics },
      });
  }, [data]);

  if (loading && !form) return <Spinner />;
  if (error || !form) return <ErrorState message={error || 'Could not load settings'} onRetry={reload} />;

  const set = (patch: Partial<SiteSettings>) => setForm({ ...form, ...patch });
  const setA = (patch: Partial<SiteSettings['analytics']>) => setForm({ ...form, analytics: { ...form.analytics, ...patch } });
  const base = (form.siteUrl || window.location.origin).replace(/\/+$/, '');

  const starterPrivacy = () => {
    if (form.pages.privacy.replace(/<[^>]+>/g, '').trim() && !window.confirm('Replace the current Privacy Policy text with the starter text?')) return;
    setForm({ ...form, pages: { ...form.pages, privacy: privacyTemplate(form) } });
    setTab('privacy');
    toast('Starter privacy policy added below. Review it, then save settings.');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { siteName, tagline, description, siteUrl, contactEmail, contactAddress, social, pages, postsPerPage, allowIndexing, analytics } = form;
      const { enabled, gaMeasurementId, gtmContainerId = '', consentBanner, googleVerification = '', bingVerification = '' } = analytics;
      const res = await api.put<{ settings: SiteSettings }>('/admin/settings', {
        siteName,
        tagline,
        description,
        siteUrl,
        contactEmail,
        contactAddress,
        social,
        pages,
        postsPerPage: Number(postsPerPage),
        allowIndexing,
        analytics: { enabled, gaMeasurementId, gtmContainerId, consentBanner, googleVerification, bingVerification },
      });
      // Show the cleaned-up values (e.g. the code taken out of a pasted <meta> tag).
      setForm((f) => (f ? { ...f, analytics: { ...f.analytics, ...res.settings.analytics } } : f));
      toast('Settings saved');
      refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <PageHeader
        title="Website Settings"
        subtitle="Site identity, contact details and static pages."
        actions={
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card space-y-4 p-5">
          <h2 className="font-sans text-base font-semibold">General</h2>
          <div>
            <label htmlFor="siteName" className="label">
              Site name
            </label>
            <input id="siteName" required maxLength={80} className="input" value={form.siteName} onChange={(e) => set({ siteName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="tagline" className="label">
              Tagline
            </label>
            <input id="tagline" maxLength={200} className="input" value={form.tagline} onChange={(e) => set({ tagline: e.target.value })} />
          </div>
          <div>
            <label htmlFor="description" className="label">
              Site description (default meta description)
            </label>
            <textarea id="description" rows={3} maxLength={400} className="input" value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div>
            <label htmlFor="siteUrl" className="label">
              Public site URL
            </label>
            <input id="siteUrl" type="url" maxLength={300} className="input" value={form.siteUrl} onChange={(e) => set({ siteUrl: e.target.value })} placeholder="https://www.example.com" />
            <p className="mt-1 text-xs text-stone-500">Used for canonical and sharing links.</p>
          </div>
          <div>
            <label htmlFor="postsPerPage" className="label">
              Articles per page
            </label>
            <input id="postsPerPage" type="number" min={3} max={30} className="input w-28" value={form.postsPerPage} onChange={(e) => set({ postsPerPage: Number(e.target.value) })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.allowIndexing} onChange={(e) => set({ allowIndexing: e.target.checked })} />
            Allow search engines to index the site
          </label>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-sans text-base font-semibold">Contact &amp; social</h2>
          <div>
            <label htmlFor="contactEmail" className="label">
              Contact email
            </label>
            <input id="contactEmail" type="email" maxLength={200} className="input" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
          </div>
          <div>
            <label htmlFor="contactAddress" className="label">
              Address
            </label>
            <textarea id="contactAddress" rows={2} maxLength={400} className="input" value={form.contactAddress} onChange={(e) => set({ contactAddress: e.target.value })} />
          </div>
          {SOCIAL.map((name) => (
            <div key={name}>
              <label htmlFor={`social-${name}`} className="label capitalize">
                {name} URL
              </label>
              <input id={`social-${name}`} type="url" maxLength={300} className="input" value={form.social[name]} onChange={(e) => set({ social: { ...form.social, [name]: e.target.value } })} placeholder="https://…" />
            </div>
          ))}
        </section>
      </div>

      <section className="card mt-6 space-y-5 p-5">
        <div>
          <h2 className="font-sans text-base font-semibold">Analytics and search engines</h2>
          <p className="mt-1 text-sm text-stone-500">
            Built-in analytics need no setup. Google Analytics and Search Console are optional and free. See the numbers under{' '}
            <a href="/admin/analytics" className="text-brand-700 hover:underline dark:text-brand-300">
              Analytics
            </a>
            .
          </p>
        </div>
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.analytics.enabled} onChange={(e) => setA({ enabled: e.target.checked })} />
          <span>
            <strong>Built-in analytics:</strong> count views, real reads and reading time for each post. No cookies; IP addresses are never stored. Most read posts are shown first on the home page.
          </span>
        </label>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="ga-id" className="label">
              Google Analytics 4 measurement ID
            </label>
            <input id="ga-id" className="input font-mono" maxLength={30} value={form.analytics.gaMeasurementId} onChange={(e) => setA({ gaMeasurementId: e.target.value.trim() })} placeholder="G-ABC123XYZ" />
            <p className="text-xs text-stone-500">
              In{' '}
              <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                Google Analytics
              </a>
              : Admin → Data streams → Add stream → Web, enter {base}, then copy the Measurement ID. Leave empty to not use Google Analytics.
            </p>
            <label htmlFor="gtm-id" className="label pt-2">
              Google Tag Manager container ID (optional)
            </label>
            <input id="gtm-id" className="input font-mono" maxLength={4000} value={form.analytics.gtmContainerId || ''} onChange={(e) => setA({ gtmContainerId: e.target.value })} placeholder="GTM-ABC1234" />
            <p className="text-xs text-stone-500">
              Paste the ID or the snippet from{' '}
              <a href="https://tagmanager.google.com/" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                Tag Manager
              </a>
              . Each page change is sent as the event <code>page_view</code>: use a Custom Event trigger with that name for page tags. Custom HTML tags are blocked by the site's security rules; use Google's built-in tag types.
            </p>
            <label className="flex gap-2 text-sm">
              <input type="checkbox" checked={form.analytics.consentBanner} onChange={(e) => setA({ consentBanner: e.target.checked })} />
              <span>Ask visitors before loading Google Analytics or Tag Manager (cookie banner). Recommended, and required for visitors from the EU and UK.</span>
            </label>
          </div>

          <div className="space-y-2">
            <label htmlFor="gsc" className="label">
              Google Search Console verification
            </label>
            <input id="gsc" className="input font-mono" maxLength={400} value={form.analytics.googleVerification || ''} onChange={(e) => setA({ googleVerification: e.target.value })} placeholder='<meta name="google-site-verification" content="…" />' />
            <p className="text-xs text-stone-500">
              In{' '}
              <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                Search Console
              </a>
              : Add property → URL prefix → {base} → HTML tag. Paste the tag here, save, run the site with start-prod.bat on its public address, then click Verify. After that, submit the sitemap: <code>{base}/sitemap.xml</code>
            </p>
            <label htmlFor="bing" className="label pt-2">
              Bing Webmaster Tools verification (optional)
            </label>
            <input id="bing" className="input font-mono" maxLength={400} value={form.analytics.bingVerification || ''} onChange={(e) => setA({ bingVerification: e.target.value })} placeholder='<meta name="msvalidate.01" content="…" />' />
            <p className="text-xs text-stone-500">
              <a href="https://www.bing.com/webmasters" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                Bing Webmaster Tools
              </a>{' '}
              can also import your site straight from Search Console.
            </p>
          </div>
        </div>
        {!form.siteUrl && <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Set the Public site URL above first: search engines and Google Analytics need your real web address.</p>}
        {(form.analytics.gaMeasurementId || form.analytics.gtmContainerId) && !form.pages.privacy.replace(/<[^>]+>/g, '').trim() && (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Google Analytics requires a privacy policy that mentions it. Your Privacy Policy page is empty.</p>
        )}
        <button type="button" className="btn btn-sm" onClick={starterPrivacy}>
          Write a starter privacy policy
        </button>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-sans text-base font-semibold">Static pages</h2>
        <div className="my-4 flex flex-wrap gap-2" role="tablist">
          {PAGES.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={tab === p.key} className={`btn btn-sm ${tab === p.key ? 'btn-primary' : ''}`} onClick={() => setTab(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <RichTextEditor key={tab} value={form.pages[tab]} onChange={(html) => setForm((f) => (f ? { ...f, pages: { ...f.pages, [tab]: html } } : f))} placeholder={`Write the ${PAGES.find((p) => p.key === tab)?.label} page…`} />
      </section>
    </form>
  );
}

// A plain starting point covering what this site actually does. The owner
// should review it (and get legal advice where needed) before relying on it.
function privacyTemplate(f: SiteSettings): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const site = esc(f.siteName || 'this website');
  const contact = f.contactEmail ? `<a href="mailto:${esc(f.contactEmail)}">${esc(f.contactEmail)}</a>` : 'the contact page';
  const ga = f.analytics.gaMeasurementId || f.analytics.gtmContainerId
    ? `<h2>Google Analytics</h2><p>If you accept cookies, we also use Google Analytics, a service by Google, to understand how visitors use the site (for example which pages are visited and roughly which country visitors come from). Google Analytics sets cookies and processes your IP address; we ask Google not to use the data for advertising. You can decline or change your choice at any time with “Cookie settings” at the bottom of every page. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google's privacy policy</a>.</p>`
    : '';
  return `<p>This policy explains what information ${site} collects and how it is used. Last updated: ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
<h2>Visitor statistics</h2><p>To see which articles are read, we count page views, whether an article was read through, and the time spent reading. This uses no cookies. Your IP address and browser details are turned into a code that changes every day and cannot be traced back to you; the IP address itself is not stored. Only daily totals are kept.</p>
${ga}
<h2>Newsletter</h2><p>If you subscribe to the newsletter, we store your email address to send you new articles. You can ask us to remove it at any time.</p>
<h2>Contact</h2><p>If you contact us, we use your message and details only to reply.</p>
<h2>Images and links</h2><p>Some photos are shown from or credited to photo libraries such as Openverse, Unsplash and Pixabay. Links to other websites are governed by their own privacy policies.</p>
<h2>Your rights</h2><p>You can ask what information we hold about you, and ask us to correct or delete it, by writing to ${contact}.</p>`;
}
