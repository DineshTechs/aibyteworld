import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { Seo } from '../../components/Seo';
import { PROSE, Spinner } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';

const TITLES = { about: 'About Us', privacy: 'Privacy Policy', terms: 'Terms and Conditions' } as const;

// About / Privacy / Terms. Content is edited in Admin → Website Settings.
export default function StaticPage({ page }: { page: keyof typeof TITLES }) {
  const { settings, loaded } = useSettings();
  const html = useMemo(() => DOMPurify.sanitize(settings.pages[page] || ''), [settings.pages, page]);

  return (
    <div className="container-page max-w-3xl py-12">
      <Seo title={TITLES[page]} />
      <h1 className="mb-8 text-4xl font-semibold text-stone-900 dark:text-stone-50">{TITLES[page]}</h1>
      {!loaded ? (
        <Spinner />
      ) : html ? (
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-stone-500">This page has not been written yet.</p>
      )}
    </div>
  );
}
