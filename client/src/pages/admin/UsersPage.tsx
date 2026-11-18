import { useState, type FormEvent } from 'react';
import { ErrorState, Modal, PageHeader, Spinner, formatDateTime } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage } from '../../services/api';
import type { Role, User } from '../../types';

interface Draft {
  id?: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  password: string;
}

const ROLE_HELP: Record<Role, string> = {
  admin: 'Full access, including users and settings',
  editor: 'Manages and publishes all articles',
  author: 'Writes own articles and submits them for approval',
};

export default function UsersPage() {
  const { user: me } = useAuth();
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useFetch(() => api.get<{ items: User[] }>('/admin/users'), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      if (draft.id) {
        await api.put(`/admin/users/${draft.id}`, { name: draft.name, role: draft.role, active: draft.active, password: draft.password || undefined });
      } else {
        await api.post('/admin/users', { name: draft.name, email: draft.email, role: draft.role, password: draft.password });
      }
      toast('User saved');
      setDraft(null);
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: User) => {
    if (!(await confirm(`Delete the account for ${u.email}?`, { confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast('User deleted');
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Accounts that can sign in to the dashboard."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDraft({ name: '', email: '', role: 'author', active: true, password: '' })}>
            + New user
          </button>
        }
      />
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message={error || 'Could not load users'} onRetry={reload} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wider text-stone-500 dark:border-stone-800">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last sign-in</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{u.name}</span>
                    {u.id === me?.id && <span className="ml-2 text-xs text-stone-400">(you)</span>}
                    <p className="text-xs text-stone-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-3 capitalize">{u.role}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>
                      {u.active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className="btn btn-sm" onClick={() => setDraft({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, password: '' })}>
                        Edit
                      </button>
                      {u.id !== me?.id && (
                        <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" onClick={() => remove(u)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal title={draft.id ? 'Edit user' : 'New user'} onClose={() => setDraft(null)}>
          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            <div>
              <label htmlFor="u-name" className="label">
                Name
              </label>
              <input id="u-name" required maxLength={80} className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <label htmlFor="u-email" className="label">
                Email
              </label>
              <input id="u-email" type="email" required disabled={!!draft.id} className="input" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
            <div>
              <label htmlFor="u-role" className="label">
                Role
              </label>
              <select id="u-role" className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                <option value="author">Author</option>
                <option value="editor">Editor</option>
                <option value="admin">Administrator</option>
              </select>
              <p className="mt-1 text-xs text-stone-500">{ROLE_HELP[draft.role]}</p>
            </div>
            <div>
              <label htmlFor="u-password" className="label">
                {draft.id ? 'New password (leave empty to keep the current one)' : 'Password'}
              </label>
              <input id="u-password" type="password" autoComplete="new-password" required={!draft.id} minLength={10} className="input" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              <p className="mt-1 text-xs text-stone-500">At least 10 characters.</p>
            </div>
            {draft.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Account is active
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setDraft(null)}>
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
