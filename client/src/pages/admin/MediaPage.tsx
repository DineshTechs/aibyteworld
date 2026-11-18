import { useRef, useState } from 'react';
import { ACCEPT_IMAGES, uploadImageFile } from '../../components/MediaPicker';
import { EmptyState, ErrorState, Modal, PageHeader, Pagination, Spinner, formatDateTime } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useUi } from '../../context/UiContext';
import { useFetch } from '../../hooks/useFetch';
import { api, errorMessage } from '../../services/api';
import type { MediaItem, Paged } from '../../types';

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function MediaPage() {
  const { user, isStaff } = useAuth();
  const { toast, confirm } = useUi();
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [alt, setAlt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, error, loading, reload } = useFetch(() => api.get<Paged<MediaItem>>(`/admin/media?page=${page}`), [page]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await uploadImageFile(file);
        ok += 1;
      } catch (e) {
        toast(`${file.name}: ${errorMessage(e)}`, 'error');
      }
    }
    if (ok) toast(`${ok} image${ok === 1 ? '' : 's'} uploaded`);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (page === 1) reload();
    else setPage(1);
  };

  const canManage = (m: MediaItem) => isStaff || m.uploadedBy?._id === user?.id;

  const open = (m: MediaItem) => {
    setSelected(m);
    setAlt(m.alt);
  };

  const saveAlt = async () => {
    if (!selected) return;
    try {
      await api.put(`/admin/media/${selected._id}`, { alt });
      toast('Alt text saved');
      setSelected(null);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!(await confirm('Delete this image? Articles that use it will show a broken image.', { confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/admin/media/${selected._id}`);
      toast('Image deleted');
      setSelected(null);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const copyUrl = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.url);
      toast('URL copied');
    } catch {
      toast('Could not copy the URL', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Media Library"
        subtitle="Images used in articles. JPG, PNG, WebP or GIF."
        actions={
          <>
            <input ref={fileRef} type="file" multiple accept={ACCEPT_IMAGES} className="hidden" onChange={(e) => upload(e.target.files)} />
            <button type="button" className="btn btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Upload images'}
            </button>
          </>
        }
      />
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message={error || 'Could not load media'} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No images yet">Upload images to use them in articles.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {data.items.map((m) => (
              <button key={m._id} type="button" onClick={() => open(m)} className="card overflow-hidden text-left transition hover:border-brand-500">
                <img src={m.url} alt={m.alt} loading="lazy" className="aspect-square w-full object-cover" />
                <span className="block truncate px-3 pt-2 text-sm">{m.originalName || m.filename}</span>
                <span className="block px-3 pb-2 text-xs text-stone-500">{m.storage === 'remote' ? 'Shown from Unsplash' : kb(m.size)}{m.origin === 'stock' ? ' · Stock photo' : ''}</span>
              </button>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={setPage} />
        </>
      )}

      {selected && (
        <Modal title="Image details" onClose={() => setSelected(null)}>
          <img src={selected.url} alt={selected.alt} className="max-h-64 w-full rounded-lg object-contain" />
          <dl className="mt-4 space-y-1 text-sm text-stone-500">
            <div>
              <dt className="inline font-medium text-stone-700 dark:text-stone-300">File: </dt>
              <dd className="inline break-all">{selected.originalName || selected.filename}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-stone-700 dark:text-stone-300">Size: </dt>
              <dd className="inline">
                {selected.storage === 'remote' ? 'Hosted by the photo library' : kb(selected.size)}
                {selected.width && selected.height ? ` · ${selected.width}×${selected.height}px` : ''}
              </dd>
            </div>
            {selected.credit?.text && (
              <div>
                <dt className="inline font-medium text-stone-700 dark:text-stone-300">Credit: </dt>
                <dd className="inline">
                  {selected.credit.text}
                  {selected.provider ? ` (${selected.provider})` : ''}
                </dd>
              </div>
            )}
            <div>
              <dt className="inline font-medium text-stone-700 dark:text-stone-300">Uploaded: </dt>
              <dd className="inline">
                {formatDateTime(selected.createdAt)}
                {selected.uploadedBy ? ` by ${selected.uploadedBy.name}` : ''}
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <label htmlFor="media-alt" className="label">
              Alt text
            </label>
            <input id="media-alt" className="input" maxLength={300} value={alt} disabled={!canManage(selected)} onChange={(e) => setAlt(e.target.value)} />
          </div>
          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <button type="button" className="btn" onClick={copyUrl}>
              Copy URL
            </button>
            {canManage(selected) && (
              <span className="flex gap-2">
                <button type="button" className="btn text-red-600 dark:text-red-400" onClick={remove}>
                  Delete
                </button>
                <button type="button" className="btn btn-primary" onClick={saveAlt}>
                  Save
                </button>
              </span>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
