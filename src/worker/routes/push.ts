import { Hono } from 'hono';
import { z } from 'zod';
import type { PushDevice, PushSettings } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { all, run } from '../db';
import type { AppEnv } from '../env';
import { fail, parseBody } from '../http';
import { deliver, vapidKeys, type SubscriptionRow } from '../push';
import { b64urlDecode, isPushEndpoint } from '../webPush';

export const MAX_PUSH_DEVICES = 10;

const toDevice = (r: SubscriptionRow): PushDevice => ({
  id: r.id,
  device: r.device,
  endpoint: r.endpoint,
  createdAt: r.created_at,
  lastSuccessAt: r.last_success_at,
  lastError: r.last_error,
});

const b64Bytes = (length: number) =>
  z.string().regex(/^[A-Za-z0-9_-]+$/, '格式錯誤').refine((s) => {
    try {
      return b64urlDecode(s).length === length;
    } catch {
      return false;
    }
  }, '長度不對');

const subscribeSchema = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, '不是認得的推播服務網址'),
  keys: z.object({ p256dh: b64Bytes(65), auth: b64Bytes(16) }),
  device: z.string().trim().max(40).default(''),
});

const myDevices = (db: D1Database, email: string) =>
  all<SubscriptionRow>(db, 'SELECT * FROM push_subscriptions WHERE user_email = ? ORDER BY created_at DESC, id DESC', email);

/** 手機通知（同二胎）：每台裝置自己開、自己關 */
export const pushRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const res: PushSettings = {
      publicKey: c.env.VAPID_PUBLIC_KEY ?? '',
      canSend: vapidKeys(c.env) !== null,
      devices: (await myDevices(c.env.DB, c.get('user').email)).map(toDevice),
    };
    return c.json(res);
  })
  .post('/subscribe', async (c) => {
    if (!c.env.VAPID_PUBLIC_KEY) fail(503, '系統還沒設定手機通知');
    const b = await parseBody(c, subscribeSchema);
    const email = c.get('user').email;
    const rows = await myDevices(c.env.DB, email);
    if (!rows.some((r) => r.endpoint === b.endpoint) && rows.length >= MAX_PUSH_DEVICES) fail(429, `一個帳號最多 ${MAX_PUSH_DEVICES} 台裝置開通知`);
    await run(
      c.env.DB,
      `INSERT INTO push_subscriptions (user_email, endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         created_at = CASE WHEN user_email = excluded.user_email THEN created_at ELSE excluded.created_at END,
         user_email = excluded.user_email, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device,
         last_error = '', fail_count = 0`,
      email,
      b.endpoint,
      b.keys.p256dh,
      b.keys.auth,
      b.device,
      taipeiNow(),
    );
    return c.json({ devices: (await myDevices(c.env.DB, email)).map(toDevice) });
  })
  .post('/unsubscribe', async (c) => {
    const { id } = await parseBody(c, z.object({ id: z.number().int().positive() }));
    const email = c.get('user').email;
    const n = await run(c.env.DB, 'DELETE FROM push_subscriptions WHERE id = ? AND user_email = ?', id, email);
    if (n === 0) fail(404, '找不到這台裝置');
    return c.json({ devices: (await myDevices(c.env.DB, email)).map(toDevice) });
  })
  .post('/test', async (c) => {
    if (!vapidKeys(c.env)) fail(503, '系統還沒設定通知金鑰（VAPID_PRIVATE_KEY）');
    const email = c.get('user').email;
    const rows = await myDevices(c.env.DB, email);
    if (rows.length === 0) fail(409, '你還沒有開通知的裝置');
    const sent = await deliver(
      c.env,
      rows,
      { title: '🦦 通知開好了', body: '到了吃藥時間（08:00、12:30、18:30、21:30）會提醒還沒吃的藥。', url: '/', tag: 'test' },
      { ttl: 600 },
    );
    return c.json({ sent, devices: (await myDevices(c.env.DB, email)).map(toDevice) });
  });
