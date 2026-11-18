// Live SEO checks for the article editor. These are guidelines, not
// guarantees: no checklist can promise rankings or indexing.
interface Props {
  title: string;
  seoTitle: string;
  description: string;
  keyword: string;
  html: string;
  imageUrl: string;
  imageAlt: string;
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function SeoChecklist({ title, seoTitle, description, keyword, html, imageUrl, imageAlt }: Props) {
  const kw = keyword.trim().toLowerCase();
  const t = (seoTitle || title).trim();
  const body = text(html);
  const words = body ? body.split(' ').length : 0;
  const firstPara = text((html.match(/<p[^>]*>[\s\S]*?<\/p>/i) || [''])[0]).toLowerCase();
  const h2 = (html.match(/<h2/gi) || []).length;
  const imgs = html.match(/<img[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter((i) => !/alt="[^"]+"/i.test(i)).length;
  const internal = (html.match(/<a[^>]+href="\/(?!\/)/gi) || []).length;
  const external = (html.match(/<a[^>]+href="https?:/gi) || []).length;
  const faq = /<h2[^>]*>\s*(frequently asked questions|faqs?)\b/i.test(html);
  const density = kw && words ? (body.toLowerCase().split(kw).length - 1) / (words / 100) : 0;

  const checks: [boolean, string][] = [
    [t.length >= 30 && t.length <= 60, `SEO title is ${t.length} characters (aim for 30–60)`],
    [description.length >= 120 && description.length <= 160, `Meta description is ${description.length} characters (aim for 120–160)`],
    [!kw || t.toLowerCase().includes(kw), 'Focus keyword appears in the SEO title'],
    [!kw || description.toLowerCase().includes(kw), 'Focus keyword appears in the meta description'],
    [!kw || firstPara.includes(kw), 'Focus keyword appears in the first paragraph'],
    [!kw || density <= 2.5, `Keyword used naturally (${density.toFixed(1)} per 100 words; stay under 2.5)`],
    [words >= 600, `${words} words (600+ usually needed to cover a topic well)`],
    [h2 >= 2, `${h2} H2 section heading(s)`],
    [Boolean(imageUrl), 'Featured image is set'],
    [!imageUrl || Boolean(imageAlt.trim()), 'Featured image has alt text'],
    [imgsNoAlt === 0, imgsNoAlt ? `${imgsNoAlt} inline image(s) missing alt text` : 'All inline images have alt text'],
    [internal >= 1, `${internal} internal link(s) to other articles`],
    [external >= 1, `${external} link(s) to sources`],
    [faq, faq ? 'FAQ section found (adds FAQ structured data)' : 'No "Frequently asked questions" section'],
  ];
  const passed = checks.filter(([ok]) => ok).length;

  return (
    <section className="card p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-sans text-base font-semibold">SEO checklist</h2>
        <span className={`badge ${passed >= checks.length - 2 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>
          {passed}/{checks.length}
        </span>
      </div>
      <ul className="space-y-1.5 text-sm">
        {checks.map(([ok, label]) => (
          <li key={label} className="flex gap-2">
            <span className={ok ? 'text-emerald-600' : 'text-amber-600'} aria-hidden>
              {ok ? '✓' : '!'}
            </span>
            <span className={ok ? 'text-stone-600 dark:text-stone-300' : 'text-stone-800 dark:text-stone-100'}>
              <span className="sr-only">{ok ? 'Passed: ' : 'To fix: '}</span>
              {label}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-stone-500">Good practice helps search engines understand the page; it does not guarantee rankings or indexing.</p>
    </section>
  );
}
