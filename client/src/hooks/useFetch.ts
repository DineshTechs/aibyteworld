import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api';

// Loads data with loading/error state. `reload()` refetches without clearing data.
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (reset: boolean) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    if (reset) setData(null);
    try {
      const result = await fnRef.current();
      if (id === seq.current) setData(result);
    } catch (e) {
      if (id === seq.current) {
        setError(errorMessage(e));
        setStatus((e as { status?: number }).status ?? null);
      }
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(false), [run]);
  return { data, error, status, loading, reload, setData };
}
