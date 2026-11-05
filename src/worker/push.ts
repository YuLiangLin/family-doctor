// 手機通知：誰的哪幾台裝置、送什麼（協定在 webPush.ts，同二胎）。
// 吃藥提醒：每個時段（shared/meds.ts 的 SLOTS）Cron 觸發一次，還沒打勾的藥推給全家帳號。
import type { Context } from 'hono';
import { taipeiNow } from '../shared/dates';
import { dosesOn, reminderText, SLOT_INFO, type Slot } from '../shared/meds';
import { all, first, run } from './db';
import type { AppEnv, Env } from './env';
import { loadDoseLogs, loadMedications, loadMembers } from './records';
import { sendWebPush, type PushOptions, type VapidKeys } from './webPush';

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface SubscriptionRow {
  id: number;
  user_email: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
  created_at: string;
  last_success_at: string | null;
  last_error: string;
  fail_count: number;
}

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'https://doctor.nathantw.com' };
}

const ACTIVE_USER = 'JOIN users u ON u.email = s.user_email AND u.active = 1';

export async function deliver(env: Env, subs: SubscriptionRow[], msg: PushMessage, opts: PushOptions): Promise<number> {
  const keys = vapidKeys(env);
  if (!keys || subs.length === 0) return 0;
  const payload = JSON.stringify(msg);
  const results = await Promise.all(
    subs.map(async (s) => {
      let error = '';
      let result = null;
      try {
        result = await sendWebPush(s, payload, keys, opts);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      if (result?.gone) {
        await run(env.DB, 'DELETE FROM push_subscriptions WHERE id = ?', s.id);
      } else if (result?.ok) {
        await run(env.DB, `UPDATE push_subscriptions SET last_success_at = ?, last_error = '', fail_count = 0 WHERE id = ?`, taipeiNow(), s.id);
        return true;
      } else {
        await run(
          env.DB,
          'UPDATE push_subscriptions SET last_error = ?, fail_count = fail_count + 1 WHERE id = ?',
          (error || `推播服務回 HTTP ${result?.status}`).slice(0, 200),
          s.id,
        );
      }
      return false;
    }),
  );
  return results.filter(Boolean).length;
}

export async function notifyUsers(env: Env, emails: string[] | 'all', msg: PushMessage, opts: PushOptions = { ttl: 3600 }): Promise<number> {
  if (!vapidKeys(env)) return 0;
  let subs: SubscriptionRow[];
  if (emails === 'all') {
    subs = await all<SubscriptionRow>(env.DB, `SELECT s.* FROM push_subscriptions s ${ACTIVE_USER}`);
  } else {
    const list = [...new Set(emails.map((e) => e.toLowerCase()).filter((e) => e.includes('@')))];
    if (list.length === 0) return 0;
    subs = await all<SubscriptionRow>(
      env.DB,
      `SELECT s.* FROM push_subscriptions s ${ACTIVE_USER} WHERE s.user_email IN (${list.map(() => '?').join(', ')})`,
      ...list,
    );
  }
  return deliver(env, subs, msg, opts);
}

/** 在 API 裡順便送通知：交給 waitUntil，不拖慢回應；測試裡沒有 ExecutionContext 就等它做完 */
export async function inBackground(c: Context<AppEnv>, task: () => Promise<unknown>): Promise<void> {
  const p = task().catch((e) => console.error('手機通知送不出去', e));
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    await p;
  }
}

/** 某天某個時段的提醒內容（還沒打勾的） */
export async function reminderMessage(env: Env, date: string, slot: Slot): Promise<PushMessage | null> {
  const meds = await loadMedications(env.DB, { activeOn: date });
  const logs = await loadDoseLogs(env.DB, meds.map((m) => m.id));
  const members = new Map((await loadMembers(env.DB)).map((m) => [m.id, m.name]));
  const due = dosesOn(meds, logs, date).filter((d) => d.slot === slot);
  const text = reminderText(
    slot,
    due
      .filter((d) => members.has(d.memberId))
      .map((d) => ({ memberName: members.get(d.memberId)!, medName: shortName(meds.find((m) => m.id === d.medicationId)!.name), done: !!d.mark })),
  );
  return text ? { ...text, url: '/', tag: `dose-${date}-${slot}` } : null;
}

/** 藥袋上的名稱太長（CEPHALEXIN 500MG）→ 鎖定畫面只放前段 */
const shortName = (name: string) => name.replace(/\s+\d.*$/, '').slice(0, 24) || name.slice(0, 24);

/** Cron：某個時段的吃藥提醒；同一個時段只送一次 */
export async function runReminder(env: Env, date: string, slot: Slot): Promise<string> {
  const key = `${date} ${slot}`;
  if (await first(env.DB, 'SELECT 1 FROM reminder_runs WHERE run_key = ?', key)) return 'already';
  const msg = await reminderMessage(env, date, slot);
  let result = 'nothing';
  let devices = 0;
  if (msg) {
    if (!vapidKeys(env)) result = 'no_key';
    else {
      devices = await notifyUsers(env, 'all', msg, { ttl: 2 * 3600, urgency: 'high' });
      result = 'sent';
    }
  }
  await run(
    env.DB,
    'INSERT INTO reminder_runs (run_key, result, summary, devices, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_key) DO NOTHING',
    key,
    result,
    msg ? `${SLOT_INFO[slot].label}：${msg.body.replace(/\n/g, '／')}`.slice(0, 300) : '',
    devices,
    taipeiNow(),
  );
  return result;
}
