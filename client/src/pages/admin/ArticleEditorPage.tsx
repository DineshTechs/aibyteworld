import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MediaPicker } from '../../components/MediaPicker';
import { RichTextEditor } from '../../components/RichTextEditor';
import { SeoChecklist } from '../../components/SeoChecklist';
import { ArticleGrowthPanel } from '../../components/ArticleGrowthPanel';
import { ErrorState, Modal, PROSE, Spinner, StatusBadge, formatDateTime } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useUi } from '../../context/UiContext';
import { api, errorMessage } from '../../services/api';
import type { Article, ArticleStatus, Category, SourceRef, Tag } from '../../types';
import { prepareContent } from '../public/ArticlePage';

interface Form {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  imageUrl: string;
  imageAlt: string;
  categories: string[];
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  canonicalUrl: string;
  noindex: boolean;
  ogTitle: string;
  ogDescription: string;
  secondaryKeywords: string;
  featured: boolean;
  author: string;
}

const EMPTY: Form = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  imageUrl: '',
  imageAlt: '',
  categories: [],
  tags: [],
  seoTitle: '',
  seoDescription: '',
  focusKeyword: '',
  canonicalUrl: '',
  noindex: false,
  ogTitle: '',
  ogDescription: '',
  secondaryKeywords: '',
  featured: false,
  author: '',
};

interface Meta {
  status: ArticleStatus;
  scheduledAt?: string;
  updatedAt?: string;
  slug?: string;
  origin: 'manual' | 'ai';
  authorId?: string;
}

const fromArticle = (a: Article): Form => ({
  title: a.title,
  slug: a.slug,
  excerpt: a.excerpt || '',
  content: a.content || '',
  imageUrl: a.featuredImage?.url || '',
  imageAlt: a.featuredImage?.alt || '',
  categories: a.categories.map((c) => c._id),
  tags: a.tags.map((t) => t._id),
  seoTitle: a.seo?.title || '',
  seoDescription: a.seo?.description || '',
  focusKeyword: a.seo?.focusKeyword || '',
  canonicalUrl: a.seo?.canonicalUrl || '',
  noindex: a.seo?.noindex || false,
  ogTitle: a.seo?.ogTitle || '',
  ogDescription: a.seo?.ogDescription || '',
  secondaryKeywords: (a.seo?.secondaryKeywords || []).join(', '),
  featured: a.featured || false,
  author: a.author?._id || '',
});

const toPayload = (f: Form, isStaff: boolean) => ({
  title: f.title,
  slug: f.slug || undefined,
  excerpt: f.excerpt,
  content: f.content,
  featuredImage: { url: f.imageUrl, alt: f.imageAlt },
  categories: f.categories,
  tags: f.tags,
  seo: {
    title: f.seoTitle,
    description: f.seoDescription,
    focusKeyword: f.focusKeyword,
    canonicalUrl: f.canonicalUrl,
    noindex: f.noindex,
    ogTitle: f.ogTitle,
    ogDescription: f.ogDescription,
    secondaryKeywords: f.secondaryKeywords.split(',').map((k) => k.trim()).filter(Boolean),
  },
  ...(isStaff ? { featured: f.featured, author: f.author || undefined } : {}),
});

const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const backupKey = (id?: string) => `blogsite_draft_${id || 'new'}`;
const AUTOSAVE_STATUSES: ArticleStatus[] = ['draft', 'pending_approval'];

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`text-xs ${value.length > max ? 'text-amber-600' : 'text-stone-400'}`}>{value.length}/{max}</span>;
}

export default function ArticleEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isStaff } = useAuth();
  const { toast, confirm } = useUi();

  const [form, setForm] = useState<Form>(EMPTY);
  const [meta, setMeta] = useState<Meta>({ status: 'draft', origin: 'manual' });
  const [loadState, setLoadState] = useState<{ loading: boolean; error: string }>({ loading: true, error: '' });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [backup, setBackup] = useState<{ form: Form; savedAt: number } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [authors, setAuthors] = useState<{ id: string; name: string }[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [pickImage, setPickImage] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [refreshReady, setRefreshReady] = useState(false);

  const formRef = useRef(form);
  formRef.current = form;
  const savingRef = useRef(false);
  const skipLoadFor = useRef<string | null>(null);

  // ----- Load taxonomy and (for existing articles) the article itself -----
  useEffect(() => {
    api.get<{ items: Category[] }>('/admin/categories').then((r) => setCategories(r.items)).catch(() => {});
    api.get<{ items: Tag[] }>('/admin/tags').then((r) => setTags(r.items)).catch(() => {});
    if (isStaff) api.get<{ items: { id: string; name: string }[] }>('/admin/authors').then((r) => setAuthors(r.items)).catch(() => {});
  }, [isStaff]);

  useEffect(() => {
    if (id && skipLoadFor.current === id) {
      skipLoadFor.current = null; // we just created this article from the "new" form
      return;
    }
    let cancelled = false;
    const readBackup = (updatedAt?: string) => {
      try {
        const raw = localStorage.getItem(backupKey(id));
        if (!raw) return;
        const b = JSON.parse(raw) as { form: Form; savedAt: number };
        if (b?.form && (!updatedAt || b.savedAt > new Date(updatedAt).getTime())) setBackup(b);
      } catch {
        /* ignore corrupt backup */
      }
    };
    setBackup(null);
    setDirty(false);
    setSaveState('idle');
    if (!id) {
      setForm({ ...EMPTY, author: user?.id || '' });
      setMeta({ status: 'draft', origin: 'manual' });
      setScheduleAt('');
      setLoadState({ loading: false, error: '' });
      readBackup();
      return;
    }
    setLoadState({ loading: true, error: '' });
    api
      .get<{ article: Article }>(`/admin/articles/${id}`)
      .then(({ article }) => {
        if (cancelled) return;
        setForm(fromArticle(article));
        setMeta({ status: article.status, scheduledAt: article.scheduledAt, updatedAt: article.updatedAt, slug: article.slug, origin: article.origin, authorId: article.author?._id });
        setScheduleAt(toLocalInput(article.scheduledAt));
        setSources(article.sources || []);
        setRefreshReady(Boolean(article.refresh));
        setLoadState({ loading: false, error: '' });
        readBackup(article.updatedAt);
      })
      .catch((e) => !cancelled && setLoadState({ loading: false, error: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey]);

  const canEdit = isStaff || !id || (meta.authorId === user?.id && AUTOSAVE_STATUSES.includes(meta.status));

  const update = useCallback((patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setSaveState('idle');
  }, []);

  // ----- Save -----
  const save = useCallback(
    async (opts: { status?: ArticleStatus; scheduledAt?: string; autosave?: boolean } = {}): Promise<boolean> => {
      if (savingRef.current) return false;
      const snapshot = formRef.current;
      if (!snapshot.title.trim()) {
        if (!opts.autosave) toast('Add a title before saving', 'error');
        return false;
      }
      savingRef.current = true;
      setSaveState('saving');
      setSaveError('');
      try {
        const body = { ...toPayload(snapshot, isStaff), ...(opts.status ? { status: opts.status, scheduledAt: opts.scheduledAt ?? null } : {}) };
        const res = id
          ? await api.put<{ article: Article }>(`/admin/articles/${id}${opts.autosave ? '?autosave=1' : ''}`, body)
          : await api.post<{ article: Article }>('/admin/articles', body);
        const a = res.article;
        setMeta({ status: a.status, scheduledAt: a.scheduledAt, updatedAt: a.updatedAt, slug: a.slug, origin: a.origin, authorId: a.author?._id });
        // Keep what the user is typing; only adopt server-normalized fields.
        setForm((f) => ({ ...f, slug: f.slug === snapshot.slug ? a.slug : f.slug }));
        if (formRef.current === snapshot || JSON.stringify(formRef.current) === JSON.stringify(snapshot)) setDirty(false);
        try {
          localStorage.removeItem(backupKey(id));
        } catch {
          /* ignore */
        }
        setBackup(null);
        setSaveState('saved');
        if (!id) {
          skipLoadFor.current = a._id;
          navigate(`/admin/articles/${a._id}/edit`, { replace: true });
        }
        return true;
      } catch (e) {
        setSaveState('error');
        setSaveError(errorMessage(e));
        if (!opts.autosave) toast(errorMessage(e), 'error');
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [id, isStaff, navigate, toast],
  );

  // ----- Autosave (only for content that is not live) -----
  useEffect(() => {
    if (!dirty || loadState.loading || !canEdit || !AUTOSAVE_STATUSES.includes(meta.status) || !form.title.trim()) return undefined;
    const t = setTimeout(() => save({ autosave: true }), 4000);
    return () => clearTimeout(t);
  }, [form, dirty, loadState.loading, canEdit, meta.status, save]);

  // ----- Local backup + leave warning: protects against accidental loss -----
  useEffect(() => {
    if (!dirty) return undefined;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(backupKey(id), JSON.stringify({ form, savedAt: Date.now() }));
      } catch {
        /* storage full or unavailable */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [form, dirty, id]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ----- Actions -----
  const changeStatus = async (status: ArticleStatus, done: string, scheduledAt?: string) => {
    if (await save({ status, scheduledAt })) toast(done);
  };

  const publish = async () => {
    if (await confirm('Publish this article now? It will be visible to everyone.', { confirmLabel: 'Publish' })) changeStatus('published', 'Article published');
  };

  const schedule = () => {
    const when = scheduleAt ? new Date(scheduleAt) : null;
    if (!when || Number.isNaN(when.getTime())) return toast('Choose a date and time first', 'error');
    if (when.getTime() <= Date.now()) return toast('The scheduled time must be in the future', 'error');
    return changeStatus('scheduled', `Scheduled for ${formatDateTime(when.toISOString())}`, when.toISOString());
  };

  const addTag = async () => {
    const name = tagInput.trim();
    if (!name) return;
    let tag = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    try {
      if (!tag) {
        const r = await api.post<{ item: Tag }>('/admin/tags', { name });
        tag = r.item;
        setTags((all) => [...all, r.item]);
      }
      if (!formRef.current.tags.includes(tag._id)) update({ tags: [...formRef.current.tags, tag._id] });
      setTagInput('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  };

  const restoreBackup = () => {
    if (!backup) return;
    setForm({ ...EMPTY, ...backup.form });
    setDirty(true);
    setBackup(null);
  };

  const discardBackup = () => {
    try {
      localStorage.removeItem(backupKey(id));
    } catch {
      /* ignore */
    }
    setBackup(null);
  };

  const preview = useMemo(() => (showPreview ? prepareContent(form.content) : null), [showPreview, form.content]);

  if (loadState.loading) return <Spinner />;
  if (loadState.error) return <ErrorState message={loadState.error} onRetry={() => setReloadKey((k) => k + 1)} />;

  const busy = saveState === 'saving';
  const live = meta.status === 'published';
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'saved' && !dirty ? `Saved ${meta.updatedAt ? formatDateTime(meta.updatedAt) : ''}` : saveState === 'error' ? `Not saved: ${saveError}` : dirty ? 'Unsaved changes' : id ? 'All changes saved' : 'Not saved yet';

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/admin/articles" className="btn btn-sm">
            ← Articles
          </Link>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-50">{id ? 'Edit article' : 'New article'}</h1>
          <StatusBadge status={meta.status} />
          {meta.origin === 'ai' && <span className="badge bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200">AI-generated</span>}
        </div>
        <p role="status" className={`text-sm ${saveState === 'error' ? 'text-red-600' : 'text-stone-500'}`}>
          {saveLabel}
        </p>
      </div>

      {refreshReady && (
        <p className="mb-4 rounded-lg border border-brand-300 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-100">
          An updated version of this post is ready.{' '}
          <a href="#growth-panel" className="font-medium underline">
            Review it in the Reach panel
          </a>
          .
        </p>
      )}
      {!canEdit && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          This article has been approved. Only an editor or administrator can change it now.
        </p>
      )}
      {backup && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          <span>Unsaved changes from {formatDateTime(new Date(backup.savedAt).toISOString())} were found on this device.</span>
          <span className="flex gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={restoreBackup}>
              Restore
            </button>
            <button type="button" className="btn btn-sm" onClick={discardBackup}>
              Discard
            </button>
          </span>
        </div>
      )}

      <fieldset disabled={!canEdit} className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <label htmlFor="title" className="label">
              Title
            </label>
            <input id="title" className="input py-3 font-serif text-xl" value={form.title} maxLength={200} onChange={(e) => update({ title: e.target.value })} placeholder="Article title" />
          </div>
          <div>
            <span className="label">Content</span>
            <RichTextEditor value={form.content} onChange={(html) => update({ content: html })} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="excerpt" className="label">
                Excerpt
              </label>
              <Counter value={form.excerpt} max={400} />
            </div>
            <textarea id="excerpt" rows={3} maxLength={400} className="input" value={form.excerpt} onChange={(e) => update({ excerpt: e.target.value })} placeholder="Short summary shown on cards. Leave empty to generate it from the content." />
          </div>

          <section className="card space-y-4 p-5">
            <h2 className="font-sans text-base font-semibold">SEO</h2>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="seoTitle" className="label">
                  SEO title
                </label>
                <Counter value={form.seoTitle || form.title} max={60} />
              </div>
              <input id="seoTitle" maxLength={120} className="input" value={form.seoTitle} onChange={(e) => update({ seoTitle: e.target.value })} placeholder={form.title || 'Defaults to the article title'} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="seoDescription" className="label">
                  Meta description
                </label>
                <Counter value={form.seoDescription} max={160} />
              </div>
              <textarea id="seoDescription" rows={2} maxLength={320} className="input" value={form.seoDescription} onChange={(e) => update({ seoDescription: e.target.value })} placeholder="Defaults to the excerpt" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="focusKeyword" className="label">
                  Focus keyword
                </label>
                <input id="focusKeyword" maxLength={120} className="input" value={form.focusKeyword} onChange={(e) => update({ focusKeyword: e.target.value })} />
              </div>
              <div>
                <label htmlFor="slug" className="label">
                  URL slug
                </label>
                <input id="slug" maxLength={140} className="input" value={form.slug} onChange={(e) => update({ slug: e.target.value })} placeholder="generated-from-title" />
              </div>
            </div>
            <div>
              <label htmlFor="secondaryKeywords" className="label">
                Secondary keywords
              </label>
              <input id="secondaryKeywords" className="input" value={form.secondaryKeywords} onChange={(e) => update({ secondaryKeywords: e.target.value })} placeholder="Comma separated" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="ogTitle" className="label">
                    Social title (Open Graph)
                  </label>
                  <Counter value={form.ogTitle} max={70} />
                </div>
                <input id="ogTitle" maxLength={120} className="input" value={form.ogTitle} onChange={(e) => update({ ogTitle: e.target.value })} placeholder="Defaults to the SEO title" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="ogDescription" className="label">
                    Social description
                  </label>
                  <Counter value={form.ogDescription} max={200} />
                </div>
                <input id="ogDescription" maxLength={300} className="input" value={form.ogDescription} onChange={(e) => update({ ogDescription: e.target.value })} placeholder="Defaults to the meta description" />
              </div>
            </div>
            <div>
              <label htmlFor="canonicalUrl" className="label">
                Canonical URL (optional)
              </label>
              <input id="canonicalUrl" type="url" maxLength={500} className="input" value={form.canonicalUrl} onChange={(e) => update({ canonicalUrl: e.target.value })} placeholder="https://…" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.noindex} onChange={(e) => update({ noindex: e.target.checked })} />
              Ask search engines not to index this article
            </label>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card space-y-3 p-5">
            <h2 className="font-sans text-base font-semibold">Publish</h2>
            {meta.status === 'scheduled' && meta.scheduledAt && <p className="text-sm text-stone-500">Goes live {formatDateTime(meta.scheduledAt)}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={busy} onClick={async () => (await save()) && toast('Saved')}>
                {meta.status === 'draft' ? 'Save draft' : 'Save changes'}
              </button>
              <button type="button" className="btn" onClick={() => setShowPreview(true)}>
                Preview
              </button>
              {live && meta.slug && (
                <a href={`/blog/${meta.slug}`} target="_blank" rel="noopener noreferrer" className="btn">
                  View live ↗
                </a>
              )}
            </div>
            {isStaff ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {!live && (
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
                      {meta.status === 'pending_approval' ? 'Approve & publish' : 'Publish now'}
                    </button>
                  )}
                  {(live || meta.status === 'scheduled' || meta.status === 'archived' || meta.status === 'pending_approval') && (
                    <button type="button" className="btn" disabled={busy} onClick={() => changeStatus('draft', 'Moved back to drafts')}>
                      {live ? 'Unpublish' : 'Move to drafts'}
                    </button>
                  )}
                  {meta.status !== 'archived' && id && (
                    <button type="button" className="btn" disabled={busy} onClick={() => changeStatus('archived', 'Article archived')}>
                      Archive
                    </button>
                  )}
                </div>
                {!live && (
                  <div className="border-t border-stone-200 pt-3 dark:border-stone-800">
                    <label htmlFor="scheduleAt" className="label">
                      Schedule publication
                    </label>
                    <div className="flex gap-2">
                      <input id="scheduleAt" type="datetime-local" className="input" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                      <button type="button" className="btn" disabled={busy} onClick={schedule}>
                        Schedule
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">Uses your local time zone.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                {meta.status === 'draft' && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => changeStatus('pending_approval', 'Submitted for approval')}>
                    Submit for approval
                  </button>
                )}
                {meta.status === 'pending_approval' && (
                  <button type="button" className="btn" disabled={busy} onClick={() => changeStatus('draft', 'Moved back to drafts')}>
                    Withdraw to draft
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="font-sans text-base font-semibold">Featured image</h2>
            {form.imageUrl ? (
              <img src={form.imageUrl} alt={form.imageAlt} className="aspect-video w-full rounded-lg object-cover" />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-stone-300 text-sm text-stone-400 dark:border-stone-700">No image selected</div>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn btn-sm" onClick={() => setPickImage(true)}>
                {form.imageUrl ? 'Replace' : 'Choose or upload'}
              </button>
              {form.imageUrl && (
                <button type="button" className="btn btn-sm" onClick={() => update({ imageUrl: '', imageAlt: '' })}>
                  Remove
                </button>
              )}
            </div>
            <div>
              <label htmlFor="imageAlt" className="label">
                Alt text
              </label>
              <input id="imageAlt" maxLength={300} className="input" value={form.imageAlt} onChange={(e) => update({ imageAlt: e.target.value })} placeholder="Describe the image" />
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-sans text-base font-semibold">Categories</h2>
            {categories.length === 0 ? (
              <p className="text-sm text-stone-500">
                No categories yet.{' '}
                {isStaff && (
                  <Link to="/admin/categories" className="text-brand-700 hover:underline">
                    Create one
                  </Link>
                )}
              </p>
            ) : (
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {categories.map((c) => (
                  <li key={c._id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.categories.includes(c._id)}
                        onChange={(e) => update({ categories: e.target.checked ? [...form.categories, c._id] : form.categories.filter((x) => x !== c._id) })}
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-sans text-base font-semibold">Tags</h2>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {form.tags.map((tid) => {
                const t = tags.find((x) => x._id === tid);
                return (
                  <span key={tid} className="badge gap-1 bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                    {t?.name || '…'}
                    <button type="button" aria-label={`Remove tag ${t?.name || ''}`} onClick={() => update({ tags: form.tags.filter((x) => x !== tid) })}>
                      ✕
                    </button>
                  </span>
                );
              })}
              {form.tags.length === 0 && <span className="text-sm text-stone-500">No tags</span>}
            </div>
            <div className="flex gap-2">
              <input className="input" list="tag-options" value={tagInput} maxLength={60} onChange={(e) => setTagInput(e.target.value)} onKeyDown={onTagKey} placeholder="Add a tag…" aria-label="Add a tag" />
              <button type="button" className="btn btn-sm" onClick={addTag} disabled={!tagInput.trim()}>
                Add
              </button>
            </div>
            <datalist id="tag-options">
              {tags.filter((t) => !form.tags.includes(t._id)).map((t) => (
                <option key={t._id} value={t.name} />
              ))}
            </datalist>
          </section>

          {id && isStaff && <ArticleGrowthPanel key={`${id}-${reloadKey}`} articleId={id} dirty={dirty} onApplied={() => setReloadKey((k) => k + 1)} />}

          <SeoChecklist
            title={form.title}
            seoTitle={form.seoTitle}
            description={form.seoDescription || form.excerpt}
            keyword={form.focusKeyword}
            html={form.content}
            imageUrl={form.imageUrl}
            imageAlt={form.imageAlt}
          />

          {sources.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-1 font-sans text-base font-semibold">Research sources</h2>
              <p className="mb-3 text-xs text-stone-500">Pages the AI research cited. Check facts against them before approving.</p>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {sources.map((src) => (
                  <li key={src._id}>
                    <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">
                      {src.title || src.domain}
                    </a>
                    <span className="block text-xs text-stone-500">
                      {src.domain}
                      {src.publishedAt ? ` · ${formatDateTime(src.publishedAt).split(',').slice(0, 2).join(',')}` : ' · date unknown'}
                      {src.reachable === false ? ' · could not be checked' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {isStaff && (
            <section className="card space-y-3 p-5">
              <h2 className="font-sans text-base font-semibold">Options</h2>
              <div>
                <label htmlFor="author" className="label">
                  Author
                </label>
                <select id="author" className="input" value={form.author} onChange={(e) => update({ author: e.target.value })}>
                  {authors.length === 0 && <option value={form.author}>{user?.name}</option>}
                  {authors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.featured} onChange={(e) => update({ featured: e.target.checked })} />
                Feature on the homepage
              </label>
            </section>
          )}
        </div>
      </fieldset>

      {pickImage && (
        <MediaPicker
          onClose={() => setPickImage(false)}
          onSelect={(m) => {
            update({ imageUrl: m.url, imageAlt: formRef.current.imageAlt || m.alt || '' });
            setPickImage(false);
          }}
        />
      )}

      {showPreview && preview && (
        <Modal title="Preview" onClose={() => setShowPreview(false)} wide>
          <article>
            <h1 className="text-3xl font-bold text-stone-900 dark:text-stone-50">{form.title || 'Untitled'}</h1>
            {form.excerpt && <p className="mt-3 text-lg text-stone-600 dark:text-stone-400">{form.excerpt}</p>}
            {form.imageUrl && <img src={form.imageUrl} alt={form.imageAlt} className="mt-6 aspect-[16/8] w-full rounded-xl object-cover" />}
            {preview.html ? <div className={`${PROSE} mt-6`} dangerouslySetInnerHTML={{ __html: preview.html }} /> : <p className="mt-6 text-sm text-stone-500">No content yet.</p>}
          </article>
        </Modal>
      )}
    </div>
  );
}
