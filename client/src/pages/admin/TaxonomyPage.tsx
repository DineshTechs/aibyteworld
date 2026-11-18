import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, Modal, PageHeader, Spinner } from '../../components/ui';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage } from '../../services/api';
import type { Category } from '../../types';

type Kind = 'categories' | 'tags';
const LABEL = { categories: { one: 'category', title: 'Categories' }, tags: { one: 'tag', title: 'Tags' } } as const;

// Shared management page for categories and tags.
export default function TaxonomyPage({ kind }: { kind: Kind }) {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useFetch(() => api.get<{ items: Category[] }>(`/admin/${kind}`), [kind]);
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [busy, setBusy] = useState(false);
  const label = LABEL[kind];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const body = { name: editing.name || '', slug: editing.slug || undefined, ...(kind === 'categories' ? { description: editing.description || '' } : {}) };
      if (editing._id) await api.put(`/admin/${kind}/${editing._id}`, body);
      else await api.post(`/admin/${kind}`, body);
      toast(`${label.one.charAt(0).toUpperCase()}${label.one.slice(1)} saved`);
      setEditing(null);
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: Category) => {
    const used = item.articleCount ? ` It will be removed from ${item.articleCount} article(s).` : '';
    if (!(await confirm(`Delete the ${label.one} “${item.name}”?${used}`, { confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/admin/${kind}/${item._id}`);
      toast(`Deleted “${item.name}”`);
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title={label.title}
        subtitle={kind === 'categories' ? 'Broad sections that organise the site.' : 'Specific topics used to connect related articles.'}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ name: '', slug: '', description: '' })}>
            + New {label.one}
          </button>
        }
      />
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message={error || 'Could not load'} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title={`No ${kind} yet`}>Create the first one to start organising articles.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wider text-stone-500 dark:border-stone-800">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Articles</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
              {data.items.map((item) => (
                <tr key={item._id}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{item.name}</span>
                    {item.description && <p className="text-xs text-stone-500">{item.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-stone-500">{item.slug}</td>
                  <td className="px-4 py-3">{item.articleCount ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(item)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" onClick={() => remove(item)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={`${editing._id ? 'Edit' : 'New'} ${label.one}`} onClose={() => setEditing(null)}>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="tx-name" className="label">
                Name
              </label>
              <input id="tx-name" autoFocus required maxLength={kind === 'tags' ? 60 : 80} className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label htmlFor="tx-slug" className="label">
                Slug
              </label>
              <input id="tx-slug" maxLength={100} className="input" value={editing.slug || ''} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="Generated from the name if left empty" />
            </div>
            {kind === 'categories' && (
              <div>
                <label htmlFor="tx-desc" className="label">
                  Description
                </label>
                <textarea id="tx-desc" rows={3} maxLength={500} className="input" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
