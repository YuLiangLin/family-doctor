import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Me, Member } from '../shared/apiTypes';
import { api, ApiRequestError } from './api';

export interface AsyncState<T> {
  data: T | null;
  error: ApiRequestError | null;
  loading: boolean;
  reload: () => void;
}

/** GET 一個 API；path 為 null 時不抓。reload 不會先清空畫面（避免閃一下） */
export function useApi<T>(path: string | null): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** 包一個會改資料的動作：處理 busy／錯誤訊息 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, String(e)));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { busy, error, run, clear };
}

export interface Session {
  me: Me;
  members: Member[];
  reloadMembers: () => void;
  reloadMe: () => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('SessionContext 未設定');
  return s;
}

export function useMember(id: number | null | undefined): Member | undefined {
  const { members } = useSession();
  return members.find((m) => m.id === id);
}

/** 每隔 ms 重抓一次；頁面在背景時不抓 */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') fn();
    }, ms);
    const onVisible = () => document.visibilityState === 'visible' && fn();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fn, ms, enabled]);
}
