// 新版本提醒：build 時產生 /version.json（vite.config.ts），記下這次的入口 JS 檔名（內容雜湊）。
// 開著的頁面定時、切回這個分頁時去讀，跟自己載入的入口檔比：不一樣就是部署了新版。
// 這個檔案要留在入口 chunk 裡（由 App 靜態 import），import.meta.url 才會是入口檔。
import { useEffect, useState } from 'react';

declare const __APP_VERSION__: string;

/** 這個頁面正在跑的版本（package.json） */
export const APP_VERSION = __APP_VERSION__;

export interface ReleaseInfo {
  version: string;
  date: string;
  /** 給使用者看的更新內容（CHANGELOG 該版的 `> - ` 行） */
  notes: string[];
  entry: string;
}

/** 正式 build 時是 /assets/index-雜湊.js；開發模式（vite dev）不是，就不檢查 */
const CURRENT_ENTRY = new URL(import.meta.url).pathname;
const IS_BUILD = CURRENT_ENTRY.startsWith('/assets/');

const CHECK_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000;

function isRelease(v: unknown): v is ReleaseInfo {
  const r = v as ReleaseInfo;
  return typeof r === 'object' && r !== null && typeof r.entry === 'string' && typeof r.version === 'string' && Array.isArray(r.notes);
}

/** 有新版時回傳新版資訊，否則 null */
export function useNewRelease(): ReleaseInfo | null {
  const [latest, setLatest] = useState<ReleaseInfo | null>(null);
  useEffect(() => {
    if (!IS_BUILD) return;
    let alive = true;
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const info: unknown = await res.json();
        if (alive && isRelease(info) && info.entry !== CURRENT_ENTRY) setLatest(info);
      } catch {
        // 離線、登入過期（被導去登入頁）：下次再試
      }
    };
    const onVisible = () => void check();
    void check();
    const timer = window.setInterval(onVisible, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
  return latest;
}
