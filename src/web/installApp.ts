import { useSyncExternalStore } from 'react';

/**
 * 手機「裝成 App」（加到主畫面）的引導。
 *
 * - LINE 內建瀏覽器：不能裝成 App，也不能用 Google 登入（Google 擋內嵌瀏覽器，403 disallowed_useragent）。
 *   網址加 `openExternalBrowser=1` 是 LINE 的參數：LINE 看到就改用手機預設的瀏覽器（Safari／Chrome）打開。
 *   開頁時自動加一次；參數已經在了還是在 LINE 裡（LINE 沒理它）就不再跳，改顯示步驟（LineGate），不會無限重導。
 * - Android（Chrome 等）：攔下 `beforeinstallprompt`，按「安裝」直接跳瀏覽器的安裝視窗；沒有的話照選單步驟。
 * - 三星網際網路（Samsung Internet）：它裝的 App 是三星打包的，Google Play 安全防護會擋下來
 *   （「已封鎖不安全的應用程式：這個應用程式是專為舊版 Android 打造」，2026-10 三星折疊機實測），所以不跳它的安裝視窗，改請他用 Chrome 打開再裝。
 * - iPhone／iPad：沒有安裝 API，只能教「分享 → 加入主畫面」。
 * 只在手機、平板提示；電腦要裝的話用瀏覽器網址列的安裝鈕。
 */

export const EXTERNAL_BROWSER_PARAM = 'openExternalBrowser';

/** LINE 的內建瀏覽器（iOS：`… Safari Line/14.x.x`、Android：`… Line/14.x.x/IAB`） */
export function isLineApp(ua = navigator.userAgent): boolean {
  return /\bLine\/\d/.test(ua);
}

export type Platform = 'ios' | 'android' | 'other';

export function platformOf(ua = navigator.userAgent): Platform {
  // iPadOS 的 Safari 預設回報成 Mac，用觸控點數分辨
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  // Android 平板的瀏覽器常預設「電腦版網站」，User-Agent 寫成 Linux 電腦（`X11; Linux x86_64`）：三星網際網路看得出來，其他看觸控點數
  if (/X11; Linux/.test(ua) && (isSamsungInternet(ua) || navigator.maxTouchPoints > 1)) return 'android';
  return 'other';
}

/** 三星網際網路（手機版：`… SamsungBrowser/29.0 Chrome/…`；平板的電腦版網站也有 `SamsungBrowser/`） */
export function isSamsungInternet(ua = navigator.userAgent): boolean {
  return /SamsungBrowser\//.test(ua);
}

/** 已經是從主畫面打開的 App */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** 這一頁的網址，請 LINE 改用外部瀏覽器打開 */
export function externalBrowserUrl(href = window.location.href): string {
  const url = new URL(href);
  url.searchParams.set(EXTERNAL_BROWSER_PARAM, '1');
  return url.toString();
}

/** 這一頁的網址，拿掉 LINE 的參數（給人複製、裝成 App 用） */
export function cleanUrl(href = window.location.href): string {
  const url = new URL(href);
  url.searchParams.delete(EXTERNAL_BROWSER_PARAM);
  return url.toString();
}

/** 用 Chrome 打開這一頁（Android 的 intent 網址；沒裝 Chrome 的話瀏覽器會開 Play 商店的 Chrome） */
export function chromeIntentUrl(href = cleanUrl()): string {
  const url = new URL(href);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;end`;
}

/**
 * 開頁時先跑（main.tsx，畫面出來前）：在 LINE 裡就請 LINE 改用瀏覽器開（只試一次），回傳 true＝要顯示 LineGate；
 * 不在 LINE（已經跳到瀏覽器）就把參數從網址拿掉，網址列、加到主畫面的網址都乾淨。
 */
export function leaveLineApp(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (isLineApp()) {
    if (!params.has(EXTERNAL_BROWSER_PARAM)) window.location.replace(externalBrowserUrl());
    return true;
  }
  if (params.has(EXTERNAL_BROWSER_PARAM)) window.history.replaceState(window.history.state, '', cleanUrl());
  return false;
}

/** Chrome 的 beforeinstallprompt（TypeScript 沒有內建型別） */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
let snapshot = { canPrompt: false, installed: false };
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = { canPrompt: deferred !== null, installed };
  listeners.forEach((fn) => fn());
};

/** 開頁時先跑：Chrome 判斷可以安裝時會丟 beforeinstallprompt，要先接住，等使用者按「安裝」再跳視窗 */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** 跳瀏覽器的安裝視窗；回傳使用者是否按了安裝。視窗只能跳一次，之後要等瀏覽器再丟一次事件 */
async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}

export interface InstallState {
  platform: Platform;
  /** 用三星網際網路開的：不能用它裝（會被 Google Play 擋），要改用 Chrome */
  samsung: boolean;
  /** 該提示安裝：手機或平板、不是從主畫面打開、還沒裝 */
  offer: boolean;
  /** 瀏覽器有安裝視窗可以直接跳（Android Chrome） */
  canPrompt: boolean;
  /** 剛剛裝好了 */
  installed: boolean;
  promptInstall: () => Promise<boolean>;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useInstallApp(): InstallState {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  const platform = platformOf();
  const samsung = platform === 'android' && isSamsungInternet();
  // 三星網際網路說裝好了也可能被 Google Play 擋掉，照樣請他改用 Chrome 裝
  const installed = state.installed && !samsung;
  return {
    platform,
    samsung,
    offer: platform !== 'other' && !installed && !isStandalone(),
    canPrompt: state.canPrompt && !samsung,
    installed,
    promptInstall,
  };
}
