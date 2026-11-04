// 明／暗主題：使用者選的存在這台瀏覽器（localStorage），沒選就跟著系統。
// index.html 有一段同樣邏輯的小程式在畫面出來前先套用，避免一開頁先閃一下亮色。
import { useCallback, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'sms-theme';

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** 手機狀態列的顏色（同 styles.css 的 --sheet）；裝成 App 時狀態列就是畫面的一部分 */
const BAR_COLOR: Record<'light' | 'dark', string> = { light: '#fbfcf8', dark: '#18191c' };

export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  // index.html 的兩個 theme-color 依系統明暗；選了亮或暗就兩個都換成那一色
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = BAR_COLOR[pref === 'system' ? (meta.media.includes('dark') ? 'dark' : 'light') : pref];
  });
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // 無痕視窗等情況存不了，這次有效就好
  }
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const set = useCallback((p: ThemePref) => {
    applyThemePref(p);
    setPref(p);
  }, []);
  return [pref, set];
}
