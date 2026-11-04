// 手機通知的 service worker（src/web/push.ts 註冊）。
// 只收通知：沒有 fetch 處理、不快取任何東西，畫面照常從網路載入，新版本提醒也照舊。
// 內容由 src/worker/push.ts 加密送來：{ title, body, url, tag }。

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || '家庭醫生', {
      body: msg.body || '',
      // 同一個 tag 只留最新一則（例：每天的收款提醒），取代時也要響
      tag: msg.tag || undefined,
      renotify: Boolean(msg.tag),
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      lang: 'zh-Hant-TW',
      data: { url: msg.url || '/' },
    }),
  );
});

// 點通知：系統已經開著就切過去、換到那一頁；沒開就開一個
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // 只開本站的頁面
  const path = target.origin === self.location.origin ? target.pathname + target.search + target.hash : '/';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (!win) {
        await self.clients.openWindow(url);
        return;
      }
      await win.focus();
      try {
        await win.navigate(url);
      } catch {
        // 不是這個 service worker 管的頁面不能 navigate：請頁面自己換（src/web/push.ts 聽這個訊息）
        win.postMessage({ type: 'fd-open', url: path });
      }
    })(),
  );
});

/** 裝置名稱（同 src/web/push.ts 的 deviceLabel） */
function deviceLabel() {
  const ua = self.navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && self.navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android 手機' : 'Android 平板';
  if (/Windows/.test(ua)) return 'Windows 電腦';
  if (/Macintosh/.test(ua)) return 'Mac';
  return '其他裝置';
}

// 推播服務換了這台裝置的訂閱（過期、重設）：重新訂閱並告訴系統；登入過期就送不上去，到時在「手機通知」頁重開一次
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
      const sub =
        event.newSubscription || (key && (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })));
      if (!sub) return;
      const { endpoint, keys } = sub.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ endpoint, keys, device: deviceLabel() }),
      });
    })(),
  );
});
