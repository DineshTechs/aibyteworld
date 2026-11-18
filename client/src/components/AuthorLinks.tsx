import type { AuthorLinks as Links } from '../types';

const LABELS: [keyof Links, string][] = [
  ['website', 'Website'],
  ['linkedin', 'LinkedIn'],
  ['twitter', 'X (Twitter)'],
  ['github', 'GitHub'],
];

// The author's public profile links, opened in a new tab.
export function AuthorLinks({ links, className = '' }: { links?: Partial<Links>; className?: string }) {
  const items = LABELS.filter(([k]) => links?.[k] && /^https:\/\//.test(links[k] as string));
  if (!items.length) return null;
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${className}`}>
      {items.map(([k, label]) => (
        <li key={k}>
          <a href={links![k]} target="_blank" rel="noopener noreferrer me" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            {label}
          </a>
        </li>
      ))}
    </ul>
  );
}
