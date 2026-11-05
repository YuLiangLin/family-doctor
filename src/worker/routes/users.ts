import { Hono } from 'hono';
import { z } from 'zod';
import type { UserRow } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { isSuperAdmin } from '../auth';
import { all, first, run } from '../db';
import type { AppEnv } from '../env';
import { fail, parseBody, requireSuperAdmin, zText } from '../http';
import { revokeLoginEmailSessions, revokeUserSessions } from '../sessions';

interface Row {
  email: string;
  name: string;
  role: 'admin' | 'member';
  active: number;
  member_id: number | null;
  picture_url: string;
  last_seen_at: string;
}

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email 格式不對').max(200),
  name: zText(40).default(''),
  role: z.enum(['admin', 'member']).default('member'),
  memberId: z.number().int().positive().nullable().default(null),
});

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email('Email 格式不對').max(200) });

/** 這個信箱已經被用掉了嗎（名單上的人，或某人的登入信箱）；回傳錯誤訊息 */
async function emailTaken(db: D1Database, email: string): Promise<string | null> {
  if (await first(db, 'SELECT 1 FROM users WHERE email = ?', email)) return '這個 email 已經在名單上了';
  const alias = await first<{ user_email: string }>(db, 'SELECT user_email FROM user_emails WHERE email = ?', email);
  return alias ? `這個 email 已經是 ${alias.user_email} 的登入信箱` : null;
}

const patchSchema = z.object({
  name: zText(40).optional(),
  role: z.enum(['admin', 'member']).optional(),
  active: z.boolean().optional(),
  memberId: z.number().int().positive().nullable().optional(),
});

/**
 * 帳號（能登入的 Google email 白名單）：清單大家看得到（設定頁顯示誰能用），只有最高管理者能新增、修改。
 * 自己可以改自己是哪位家人（PATCH /users/me）。
 * 一個人可以有好幾個登入信箱（user_emails，例：公司的 Google 帳號）：只有最高管理者能加、拿掉。
 */
export const usersRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rows = await all<Row>(c.env.DB, 'SELECT * FROM users ORDER BY active DESC, created_at');
    const aliases = await all<{ email: string; user_email: string }>(c.env.DB, 'SELECT email, user_email FROM user_emails ORDER BY created_at, email');
    const list: UserRow[] = rows.map((r) => ({
      email: r.email,
      name: r.name,
      role: r.role,
      active: !!r.active,
      memberId: r.member_id,
      picture: r.picture_url,
      lastSeenAt: r.last_seen_at,
      superAdmin: isSuperAdmin(c.env, r.email, r.role),
      emails: aliases.filter((a) => a.user_email === r.email).map((a) => a.email),
    }));
    return c.json(list);
  })
  .post('/', async (c) => {
    requireSuperAdmin(c);
    const b = await parseBody(c, userSchema);
    const taken = await emailTaken(c.env.DB, b.email);
    if (taken) fail(409, taken);
    const now = taipeiNow();
    await run(
      c.env.DB,
      `INSERT INTO users (email, name, role, active, member_id, created_at, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      b.email,
      b.name,
      b.role,
      b.memberId,
      now,
      now,
      c.get('user').email,
    );
    return c.json({ ok: true }, 201);
  })
  // 加一個登入信箱（例：公司的 Google 帳號）。Cloudflare Access 的「家人」政策也要加這個信箱才登得進來（部署指南 §2）
  .post('/:email/emails', async (c) => {
    requireSuperAdmin(c);
    const owner = decodeURIComponent(c.req.param('email')).toLowerCase();
    const { email } = await parseBody(c, emailSchema);
    if (!(await first(c.env.DB, 'SELECT 1 FROM users WHERE email = ?', owner))) fail(404, '找不到這個帳號');
    const taken = await emailTaken(c.env.DB, email);
    if (taken) fail(409, taken);
    await run(c.env.DB, 'INSERT INTO user_emails (email, user_email, created_at, created_by) VALUES (?, ?, ?, ?)', email, owner, taipeiNow(), c.get('user').email);
    return c.json({ ok: true }, 201);
  })
  // 拿掉一個登入信箱：用它登入的裝置一起登出
  .post('/:email/emails/remove', async (c) => {
    requireSuperAdmin(c);
    const owner = decodeURIComponent(c.req.param('email')).toLowerCase();
    const { email } = await parseBody(c, emailSchema);
    const n = await run(c.env.DB, 'DELETE FROM user_emails WHERE email = ? AND user_email = ?', email, owner);
    if (n === 0) fail(404, '找不到這個登入信箱');
    await revokeLoginEmailSessions(c.env.DB, email, c.get('user').email);
    return c.json({ ok: true });
  })
  .patch('/me', async (c) => {
    const b = await parseBody(c, z.object({ memberId: z.number().int().positive().nullable(), name: zText(40).optional() }));
    const me = c.get('user');
    await run(
      c.env.DB,
      'UPDATE users SET member_id = ?, name = COALESCE(?, name), updated_at = ?, updated_by = ? WHERE email = ?',
      b.memberId,
      b.name ?? null,
      taipeiNow(),
      me.email,
      me.email,
    );
    return c.json({ ok: true });
  })
  .patch('/:email', async (c) => {
    requireSuperAdmin(c);
    const email = decodeURIComponent(c.req.param('email')).toLowerCase();
    const b = await parseBody(c, patchSchema);
    const me = c.get('user');
    if (email === me.email && (b.active === false || b.role === 'member')) fail(400, '不能停用自己或拿掉自己的管理者權限');
    const row = await first<Row>(c.env.DB, 'SELECT * FROM users WHERE email = ?', email);
    if (!row) fail(404, '找不到這個帳號');
    await run(
      c.env.DB,
      `UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), active = COALESCE(?, active),
         member_id = CASE WHEN ? THEN ? ELSE member_id END, updated_at = ?, updated_by = ? WHERE email = ?`,
      b.name ?? null,
      b.role ?? null,
      b.active === undefined ? null : b.active,
      b.memberId !== undefined,
      b.memberId ?? null,
      taipeiNow(),
      me.email,
      email,
    );
    if (b.active === false) await revokeUserSessions(c.env.DB, email, me.email);
    return c.json({ ok: true });
  });
