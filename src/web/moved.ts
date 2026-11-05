// 2026-11-05 家庭醫生從 doctor.lottery-wangwang.com 搬到 doctor.nathantw.com（部署指南 §9）。
// 舊網址打開畫面時，index.html 先把人轉到新網址（網址帶 ?moved=1）；這裡記下來，新網址的畫面提醒「重新加到主畫面」。
import { useState } from 'react';

const KEY = 'fd-moved';
export const MOVED_PARAM = 'moved';

/** 開頁時先跑（main.tsx，畫面出來前）：從舊網址轉過來的就記下來，再把參數從網址拿掉 */
export function noteMoved(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(MOVED_PARAM)) return;
  try {
    if (localStorage.getItem(KEY) !== 'done') localStorage.setItem(KEY, 'show');
  } catch {
    // 無痕模式之類存不了：只是不提醒
  }
  url.searchParams.delete(MOVED_PARAM);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

function pending(): boolean {
  try {
    return localStorage.getItem(KEY) === 'show';
  } catch {
    return false;
  }
}

/** [要不要提醒, 知道了] */
export function useMovedNotice(): [boolean, () => void] {
  const [show, setShow] = useState(pending);
  return [
    show,
    () => {
      try {
        localStorage.setItem(KEY, 'done');
      } catch {
        // 存不了就只關這一次
      }
      setShow(false);
    },
  ];
}
