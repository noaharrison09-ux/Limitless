import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api.get<T>(path);
      if (current.current === path) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (current.current === path) setError(errorMessage(err));
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const onRefresh = () => void reload();
    window.addEventListener("limitless:refresh", onRefresh);
    return () => window.removeEventListener("limitless:refresh", onRefresh);
  }, [reload]);

  return { data, setData, error, loading, reload };
}

/** Runs an async action with a busy flag; returns [run, busy]. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [run, busy] as const;
}
