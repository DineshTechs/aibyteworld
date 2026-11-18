import { Link } from 'react-router-dom';
import { ArticleCard, ArticleRow } from '../../components/ArticleCard';
import { NewsletterForm } from '../../components/NewsletterForm';
import { Seo } from '../../components/Seo';
import { EmptyState, ErrorState, Spinner, TagChip } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { useFetch } from '../../hooks/useFetch';
import { api } from '../../services/api';
import type { HomeData } from '../../types';

function SectionTitle({ children, to }: { children: string; to?: string }) {
  return (
    <div className="mb-5 flex items-baseline justify-between border-b border-stone-200 pb-2 dark:border-stone-800">
      <h2 className="text-2xl font-semibold text-stone-900 dark:text-stone-50">{children}</h2>
      {to && (
        <Link to={to} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
          View all →
        </Link>
      )}
    </div>
  );
}

export default function HomePage() {
  const { settings } = useSettings();
  const { data, error, loading, reload } = useFetch(() => api.get<HomeData>('/public/home'), []);

  const origin = settings.siteUrl || window.location.origin;
  const organization = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: settings.siteName,
        url: `${origin}/`,
        potentialAction: { '@type': 'SearchAction', target: `${origin}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      },
      { '@type': 'Organization', name: settings.siteName, url: `${origin}/` },
    ],
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error || 'Could not load the homepage'} onRetry={reload} />;

  const featuredIds = new Set(data.featured.map((a) => a._id));
  const latest = data.featured.length ? data.latest.filter((a) => !featuredIds.has(a._id)) : data.latest.slice(1);
  const lead = data.featured[0] || data.latest[0];
  const secondary = data.featured.slice(1, 4);

  return (
    <div className="container-page py-8">
      <Seo jsonLd={organization} />
      {!lead ? (
        <EmptyState title="No articles have been published yet">Check back soon.</EmptyState>
      ) : (
        <>
          <section aria-label="Featured articles" className={`grid gap-6 ${secondary.length ? 'lg:grid-cols-3' : ''}`}>
            <div className={secondary.length ? 'lg:col-span-2' : ''}>
              <ArticleCard article={lead} large />
            </div>
            {secondary.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
                {secondary.slice(0, 2).map((a) => (
                  <ArticleCard key={a._id} article={a} />
                ))}
              </div>
            )}
          </section>

          {(data.mostRead.length > 0 || data.mostViewed.length > 0) && (
            <div className="mt-12 grid gap-10 lg:grid-cols-3">
              {data.mostRead.length > 0 && (
                <section className={data.mostViewed.length ? 'lg:col-span-2' : 'lg:col-span-3'} aria-label="Most read articles">
                  <SectionTitle to="/blog?sort=most-read">Most read</SectionTitle>
                  <div className="grid gap-6 sm:grid-cols-2">
                    {data.mostRead.map((a) => (
                      <ArticleCard key={a._id} article={a} />
                    ))}
                  </div>
                </section>
              )}
              {data.mostViewed.length > 0 && (
                <section aria-label="Trending this week">
                  <SectionTitle to="/blog?sort=popular">Trending this week</SectionTitle>
                  <ol className="divide-y divide-stone-200 dark:divide-stone-800">
                    {data.mostViewed.map((a, i) => (
                      <ArticleRow key={a._id} article={a} rank={i + 1} />
                    ))}
                  </ol>
                </section>
              )}
            </div>
          )}

          <div className="mt-12 grid gap-10 lg:grid-cols-3">
            <section className="lg:col-span-2">
              <SectionTitle to="/blog">Latest articles</SectionTitle>
              {latest.length ? (
                <div className="grid gap-6 sm:grid-cols-2">
                  {latest.slice(0, 6).map((a) => (
                    <ArticleCard key={a._id} article={a} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500">More articles are on the way.</p>
              )}
            </section>
            <aside className="space-y-10">
              {data.trendingTags.length > 0 && (
                <section>
                  <SectionTitle>Trending topics</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {data.trendingTags.map((t) => (
                      <TagChip key={t._id} slug={t.slug} name={t.name} />
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>

          {data.categorySections.map(({ category, articles }) => (
            <section key={category._id} className="mt-14">
              <SectionTitle to={`/category/${category.slug}`}>{category.name}</SectionTitle>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {articles.map((a) => (
                  <ArticleCard key={a._id} article={a} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      <section className="mt-16 rounded-2xl bg-stone-900 px-6 py-10 text-center dark:bg-stone-800 sm:px-10">
        <h2 className="text-2xl font-semibold text-white">Stay in the loop</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone-300">Subscribe to get new articles delivered to your inbox.</p>
        <div className="mt-5 flex justify-center">
          <NewsletterForm />
        </div>
      </section>
    </div>
  );
}
