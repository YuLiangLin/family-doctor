import type { PushDevice } from '../shared/apiTypes';
import { api } from './api';
import { isStandalone, platformOf } from './installApp';

/**
 * 手機通知（Web Push）的瀏覽器這一端：註冊 service worker（public/sw.js）、向推播服務訂閱、把訂閱交給系統。
 * - Android：Chrome（不一定要裝成 App）就收得到。
 * - iPhone／iPad：只有加到主畫面、從主畫面打開的 App 收得到（iOS 16.4 起），Safari 分頁裡沒有這個功能。
 * - 要先問使用者允不允許，而且一定要在按鈕的點擊裡問（iPhone 規定）。
 */

export type PushSupport = 'ok' | 'needs-install' | 'unsupported';

export function pushSupport(): PushSupport {
  if (platformOf() === 'ios' && !isStandalone()) return 'needs-install';
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return ok ? 'ok' : 'unsupported';
}

/** 'default'＝還沒問過、'granted'＝允許、'denied'＝按了不允許（只能到手機設定裡改） */
export function notificationPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied';
}

/** 裝置名稱（畫面上分辨是哪一台；public/sw.js 有一份一樣的） */
export function deviceLabel(ua = navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android 手機' : 'Android 平板';
  if (/Windows/.test(ua)) return 'Windows 電腦';
  if (/Macintosh/.test(ua)) return 'Mac';
  return '其他裝置';
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function bytesToB64url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 這台裝置現在的訂閱（沒開過是 null） */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function subscribeBody(sub: PushSubscription) {
  const { endpoint, keys } = sub.toJSON();
  return { endpoint, keys, device: deviceLabel() };
}

export class PushPermissionError extends Error {
  constructor(public permission: NotificationPermission) {
    super(permission === 'denied' ? '你按了「不允許」' : '還沒允許通知');
  }
}

/**
 * 開啟這台裝置的通知（一定要在按鈕的點擊裡呼叫）：問允不允許 → 註冊 service worker → 訂閱 → 交給系統。
 * 系統換過金鑰的話，舊的訂閱先退掉再重訂。
 */
export async function enablePush(publicKey: string): Promise<PushDevice[]> {
  // 第一個 await 之前就要問（iPhone 只認點擊當下的請求）
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushPermissionError(permission);
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && bytesToB64url(sub.options.applicationServerKey) !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
  return (await api.post<{ devices: PushDevice[] }>('/push/subscribe', subscribeBody(sub))).devices;
}

/** 關掉某台裝置；是這一台的話連瀏覽器的訂閱一起退掉 */
export async function disablePush(device: PushDevice): Promise<PushDevice[]> {
  const sub = await currentSubscription();
  if (sub?.endpoint === device.endpoint) await sub.unsubscribe().catch(() => false);
  return (await api.post<{ devices: PushDevice[] }>('/push/unsubscribe', { id: device.id })).devices;
}

/**
 * 開系統時跑一次：接住 service worker「換到那一頁」的請求（點通知時系統已經開著、但不是它管的頁面）。
 * 不會自動把訂閱再送給系統：在別台裝置的清單裡關掉這台，就要真的關掉。
 */
export function listenForNotificationClicks() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
    const url = e.data?.url;
    if (e.data?.type === 'fd-open' && url && url.startsWith('/') && !url.startsWith('//')) window.location.assign(url);
  });
}
