import { Seo } from '../../components/Seo';
import { useSettings } from '../../context/SettingsContext';

export default function ContactPage() {
  const { settings } = useSettings();
  const social = Object.entries(settings.social).filter(([, url]) => url);
  const nothing = !settings.contactEmail && !settings.contactAddress && social.length === 0;

  return (
    <div className="container-page max-w-3xl py-12">
      <Seo title="Contact Us" />
      <h1 className="mb-3 text-4xl font-semibold text-stone-900 dark:text-stone-50">Contact Us</h1>
      <p className="mb-8 text-stone-500">Questions, corrections or ideas for an article? We’d like to hear from you.</p>
      {nothing ? (
        <p className="text-stone-500">Contact details have not been added yet.</p>
      ) : (
        <dl className="card divide-y divide-stone-200 dark:divide-stone-800">
          {settings.contactEmail && (
            <div className="p-5">
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-500">Email</dt>
              <dd className="mt-1">
                <a href={`mailto:${settings.contactEmail}`} className="text-lg text-brand-700 hover:underline dark:text-brand-300">
                  {settings.contactEmail}
                </a>
              </dd>
            </div>
          )}
          {settings.contactAddress && (
            <div className="p-5">
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-500">Address</dt>
              <dd className="mt-1 whitespace-pre-line">{settings.contactAddress}</dd>
            </div>
          )}
          {social.length > 0 && (
            <div className="p-5">
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-500">Social</dt>
              <dd className="mt-1 flex flex-wrap gap-4">
                {social.map(([name, url]) => (
                  <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="capitalize text-brand-700 hover:underline dark:text-brand-300">
                    {name}
                  </a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
