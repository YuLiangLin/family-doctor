// 系統自己的登入憑證（migration 0017，2026-10-18 Nathan：「google登入不要過期」）：
// Cloudflare Access（Google）登入一次後，在那台裝置發一張 cookie，一年有效、每天第一次用自動延長一年。
// cookie 只放隨機值，資料庫只存它的 SHA-256；HttpOnly、Secure、SameSite=Lax、只送到 /api。
// 每個請求照樣查使用者名單（auth.ts）：停用、刪除的人就算有憑證也進不來。
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { taipeiNow } from '../shared/dates';
import { first, run } from './db';
import type { AppEnv } from './env';

export const SESSION_COOKIE = 'fd_session';
/** 一年；每天第一次用就從那時起再算一年 */
export const SESSION_DAYS = 365;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const cookieOptions = (maxAgeSeconds: number) =>
  ({ path: '/api', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: maxAgeSeconds }) as const;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 「iPhone Safari」「Android Chrome」「Windows Edge」這種粗略的裝置名稱（給「登入中的裝置」看，不存完整 User-Agent） */
export function deviceLabel(ua: string | undefined): string {
  const s = ua ?? '';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  const browser = /Line\//.test(s) ? 'LINE' : /Edg\//.test(s) ? 'Edge' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /Firefox\//.test(s) ? 'Firefox' : '';
  return [os, browser].filter(Boolean).join(' ') || '其他裝置';
}

/** 發一張新的登入憑證給這個帳號（Access 驗過是誰之後才會呼叫） */
export async function createSession(c: Context<AppEnv>, email: string): Promise<void> {
  const token = randomToken();
  const now = new Date();
  await run(
    c.env.DB,
    `INSERT INTO user_sessions (token_hash, user_email, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    await sha256Hex(token),
    email,
    deviceLabel(c.req.header('User-Agent')),
    taipeiNow(now),
    taipeiNow(now),
    taipeiNow(new Date(now.getTime() + SESSION_DAYS * DAY_MS)),
  );
  setCookie(c, SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 24 * 60 * 60));
}

interface SessionRow {
  id: number;
  user_email: string;
  last_seen_at: string;
  expires_at: string;
}

/** cookie 裡的登入憑證是誰（沒有、過期、撤銷都是 null）；超過一天沒延長就延長一年 */
export async function sessionEmail(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const now = new Date();
  const row = await first<SessionRow>(
    c.env.DB,
    'SELECT id, user_email, last_seen_at, expires_at FROM user_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
    await sha256Hex(token),
    taipeiNow(now),
  );
  if (!row) return null;
  if (row.last_seen_at < taipeiNow(new Date(now.getTime() - RENEW_AFTER_MS))) {
    await run(
      c.env.DB,
      'UPDATE user_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?',
      taipeiNow(now),
      taipeiNow(new Date(now.getTime() + SESSION_DAYS * DAY_MS)),
      row.id,
    );
    setCookie(c, SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 24 * 60 * 60));
  }
  return row.user_email;
}

/** 有沒有帶登入憑證的 cookie（不管有沒有效） */
export const hasSessionCookie = (c: Context<AppEnv>) => !!getCookie(c, SESSION_COOKIE);

/** 登出這台裝置：撤銷這張憑證、清掉 cookie */
export async function revokeCurrentSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && token.length <= 100) {
    await run(
      c.env.DB,
      'UPDATE user_sessions SET revoked_at = ?, revoked_by = user_email WHERE token_hash = ? AND revoked_at IS NULL',
      taipeiNow(),
      await sha256Hex(token),
    );
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/api', secure: true });
}

/** 撤銷一個帳號在所有裝置的登入憑證（「登出所有裝置」、停用、刪除）；回傳撤銷了幾台（已經過期的不算） */
export async function revokeUserSessions(db: D1Database, email: string, by: string): Promise<number> {
  const now = taipeiNow();
  return run(
    db,
    'UPDATE user_sessions SET revoked_at = ?, revoked_by = ? WHERE user_email = ? AND revoked_at IS NULL AND expires_at > ?',
    now,
    by,
    email,
    now,
  );
}
