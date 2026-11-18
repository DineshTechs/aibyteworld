import { useRef, useState } from 'react';
import { useUi } from '../context/UiContext';
import { useFetch } from '../hooks/useFetch';
import { api, errorMessage } from '../services/api';
import type { MediaItem, Paged } from '../types';
import { ErrorState, Modal, Pagination, Spinner } from './ui';

export async function uploadImageFile(file: File): Promise<MediaItem> {
  const form = new FormData();
  form.append('file', file);
  const r = await api.post<{ item: MediaItem }>('/admin/media', form);
  return r.item;
}

export const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp,image/gif';

// Modal to choose an existing image from the media library or upload a new one.
export function MediaPicker({ onSelect, onClose }: { onSelect: (item: MediaItem) => void; onClose: () => void }) {
  const { toast } = useUi();
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, error, loading, reload } = useFetch(() => api.get<Paged<MediaItem>>(`/admin/media?page=${page}&limit=12`), [page]);

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      onSelect(await uploadImageFile(file));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Modal title="Choose an image" onClose={onClose} wide>
      <div className="mb-4 flex items-center gap-3">
        <input ref={fileRef} type="file" accept={ACCEPT_IMAGES} className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <button type="button" className="btn btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? 'Uploading…' : 'Upload new image'}
        </button>
        <span className="text-xs text-stone-500">JPG, PNG, WebP or GIF</span>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message={error || 'Could not load media'} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-500">The media library is empty. Upload an image to get started.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.items.map((m) => (
              <button key={m._id} type="button" onClick={() => onSelect(m)} className="group overflow-hidden rounded-lg border border-stone-200 text-left hover:border-brand-500 dark:border-stone-700">
                <img src={m.url} alt={m.alt} loading="lazy" className="aspect-square w-full object-cover" />
                <span className="block truncate px-2 py-1 text-xs text-stone-500">{m.originalName || m.filename}</span>
              </button>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} onPage={setPage} />
        </>
      )}
    </Modal>
  );
}
