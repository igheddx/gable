import { useEffect, useRef, useState } from 'react';
import type { IpcError, IpcResult } from '../shared/ipc';

/** Thrown when a main-process call fails; carries the user-safe message and form field errors. */
export class ApiError extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
  }
  get code() { return this.error.code; }
  get fields(): Record<string, string> { return this.error.fields ?? {}; }
}

export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new ApiError(r.error);
  return r.value;
}

export const api = () => window.gable;

export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

/** Loads data and reloads when `deps` change or `reload()` is called. Stale responses are ignored. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  const key = JSON.stringify(deps);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    let current = true;
    loadRef.current().then(
      (data) => { if (current) setState({ data, error: null, loading: false }); },
      (e) => { if (current) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false })); },
    );
    return () => { current = false; };
  }, [key, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
