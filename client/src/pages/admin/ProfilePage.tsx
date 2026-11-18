import { useState, type FormEvent } from 'react';
import { MediaPicker } from '../../components/MediaPicker';
import { PageHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useUi } from '../../context/UiContext';
import { api, errorMessage } from '../../services/api';
import type { AuthorLinks, User } from '../../types';

const LINK_FIELDS: [keyof AuthorLinks, string, string][] = [
  ['website', 'Website', 'https://example.com'],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/in/…'],
  ['twitter', 'X (Twitter)', 'https://x.com/…'],
  ['github', 'GitHub', 'https://github.com/…'],
];

export default function ProfilePage() {
  const { user, setUser, setSession } = useAuth();
  const { toast } = useUi();
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle || '');
  const [links, setLinks] = useState<AuthorLinks>({ website: '', linkedin: '', twitter: '', github: '', ...(user?.links || {}) });
  const [pick, setPick] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('profile');
    try {
      const r = await api.put<{ user: User }>('/auth/profile', { name, bio, avatarUrl, jobTitle, links });
      setUser(r.user);
      toast('Profile saved');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast('The new passwords do not match', 'error');
    setBusy('password');
    try {
      const r = await api.post<{ token: string; user: User }>('/auth/change-password', { currentPassword, newPassword });
      setSession(r.token, r.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Password changed. Other sessions were signed out.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy('');
    }
    return undefined;
  };

  return (
    <div>
      <PageHeader title="Your profile" subtitle={`${user?.email} · ${user?.role}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={saveProfile} className="card space-y-4 p-5">
          <h2 className="font-sans text-base font-semibold">Public author profile</h2>
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 font-serif text-2xl text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{name.charAt(0).toUpperCase()}</div>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setPick(true)}>
              {avatarUrl ? 'Change photo' : 'Choose photo'}
            </button>
            {avatarUrl && (
              <button type="button" className="btn btn-sm" onClick={() => setAvatarUrl('')}>
                Remove
              </button>
            )}
          </div>
          <div>
            <label htmlFor="p-name" className="label">
              Name
            </label>
            <input id="p-name" required maxLength={80} className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-job" className="label">
              Job title
            </label>
            <input id="p-job" maxLength={100} className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Blockchain developer" />
          </div>
          <div>
            <label htmlFor="p-bio" className="label">
              Bio
            </label>
            <textarea id="p-bio" rows={4} maxLength={1000} className="input" value={bio} onChange={(e) => setBio(e.target.value)} />
            <p className="mt-1 text-xs text-stone-500">Shown on your author page and under every post you write.</p>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="label">Profile links (optional)</legend>
            {LINK_FIELDS.map(([k, label, ph]) => (
              <div key={k}>
                <label htmlFor={`p-${k}`} className="text-xs text-stone-500">
                  {label}
                </label>
                <input id={`p-${k}`} type="url" maxLength={300} className="input" value={links[k]} placeholder={ph} onChange={(e) => setLinks({ ...links, [k]: e.target.value.trim() })} />
              </div>
            ))}
          </fieldset>
          {user && (
            <p className="text-xs text-stone-500">
              Your public page:{' '}
              <a href={`/author/${user.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                /author/{user.id}
              </a>
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy === 'profile'}>
            {busy === 'profile' ? 'Saving…' : 'Save profile'}
          </button>
        </form>

        <form onSubmit={changePassword} className="card space-y-4 p-5">
          <h2 className="font-sans text-base font-semibold">Change password</h2>
          <div>
            <label htmlFor="p-current" className="label">
              Current password
            </label>
            <input id="p-current" type="password" required autoComplete="current-password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-new" className="label">
              New password
            </label>
            <input id="p-new" type="password" required minLength={10} autoComplete="new-password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <p className="mt-1 text-xs text-stone-500">At least 10 characters.</p>
          </div>
          <div>
            <label htmlFor="p-confirm" className="label">
              Confirm new password
            </label>
            <input id="p-confirm" type="password" required minLength={10} autoComplete="new-password" className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy === 'password'}>
            {busy === 'password' ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </div>
      {pick && (
        <MediaPicker
          onClose={() => setPick(false)}
          onSelect={(m) => {
            setAvatarUrl(m.url);
            setPick(false);
          }}
        />
      )}
    </div>
  );
}
