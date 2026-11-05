// 外觀：跟系統、亮色、暗色（設定頁可以選）。存在這台裝置的 localStorage；index.html 開頭有一小段在畫面出來前先套用，不會閃。
import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'fd-theme';
const BG = { light: '#f5f3ee', dark: '#0d1117' };

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** 套用到 <html data-theme>，並更新瀏覽器網址列／狀態列的顏色 */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (pref === 'system') m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? BG.dark : BG.light);
    else m.setAttribute('content', dark ? BG.dark : BG.light);
  });
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readTheme);
  useEffect(() => applyTheme(pref), [pref]);
  return [
    pref,
    (p) => {
      try {
        if (p === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, p);
      } catch {
        // 這台不能存：只在這次有效
      }
      setPref(p);
    },
  ];
}
