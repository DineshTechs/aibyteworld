import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
interface ConfirmState {
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}
interface UiValue {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (message: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}

const UiContext = createContext<UiValue>({ toast: () => {}, confirm: async () => false });

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  info: 'border-stone-300 bg-white text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100',
};

// Toast notifications and an in-page confirmation dialog (no native browser dialogs).
export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const confirm = useCallback(
    (message: string, opts?: { confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ message, confirmLabel: opts?.confirmLabel || 'Confirm', danger: opts?.danger ?? false, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      confirmState?.resolve(ok);
      setConfirmState(null);
    },
    [confirmState],
  );

  useEffect(() => {
    if (!confirmState) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && settle(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, settle]);

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg ${KIND_CLASS[t.kind]}`}>
            {t.text}
          </div>
        ))}
      </div>
      {confirmState && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="card w-full max-w-sm p-5 shadow-xl">
            <p className="text-sm text-stone-700 dark:text-stone-200">{confirmState.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => settle(false)}>
                Cancel
              </button>
              <button type="button" autoFocus className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => settle(true)}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}

export const useUi = () => useContext(UiContext);
