import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleStatus } from '../types';

export const PROSE =
  'prose prose-stone max-w-none dark:prose-invert prose-headings:scroll-mt-24 prose-headings:font-serif prose-a:text-brand-700 dark:prose-a:text-brand-300 prose-img:rounded-xl';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-stone-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto my-10 max-w-md rounded-xl border border-red-200 bg-red-50 p-5 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-sm mt-3" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 px-6 py-14 text-center dark:border-stone-700">
      <p className="font-serif text-lg text-stone-700 dark:text-stone-200">{title}</p>
      {children && <div className="mt-2 text-sm text-stone-500">{children}</div>}
    </div>
  );
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) nums.push(p);
  return (
    <nav className="mt-10 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Previous
      </button>
      {nums.map((p) => (
        <button key={p} type="button" aria-current={p === page ? 'page' : undefined} className={`btn btn-sm ${p === page ? 'btn-primary' : ''}`} onClick={() => onPage(p)}>
          {p}
        </button>
      ))}
      <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </nav>
  );
}

const STATUS_STYLE: Record<ArticleStatus, [string, string]> = {
  draft: ['Draft', 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300'],
  pending_approval: ['Pending approval', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'],
  scheduled: ['Scheduled', 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'],
  published: ['Published', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'],
  archived: ['Archived', 'bg-stone-300 text-stone-700 dark:bg-stone-700 dark:text-stone-200'],
};

export function StatusBadge({ status }: { status: ArticleStatus }) {
  const [label, cls] = STATUS_STYLE[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export const statusLabel = (s: ArticleStatus) => STATUS_STYLE[s][0];

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} shadow-xl`}>
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800">
          <h2 className="font-sans text-base font-semibold">{title}</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function TagChip({ slug, name }: { slug: string; name: string }) {
  return (
    <Link to={`/tag/${slug}`} className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-600 transition hover:border-brand-500 hover:text-brand-700 dark:border-stone-700 dark:text-stone-300 dark:hover:text-brand-300">
      #{name}
    </Link>
  );
}

export const formatDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

export const formatDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
