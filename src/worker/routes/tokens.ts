import { Hono } from 'hono';
import { z } from 'zod';
import { API_TOKEN_MAX_DAYS, API_TOKEN_PREFIX, type CreatedApiToken } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { all, first, run, stmt } from '../db';
import type { AppEnv } from '../env';
import { fail, parseBody, parseId, requireSuperAdmin, zRequiredText } from '../http';
import { toApiToken, type ApiTokenRow } from '../mappers';
import { randomToken, sha256Hex } from '../sessions';

const DAY_MS = 24 * 60 * 60 * 1000;

const createSchema = z.object({
  name: zRequiredText(40),
  scope: z.enum(['read', 'log', 'write']),
  days: z.number().int().min(1, '期限至少 1 天').max(API_TOKEN_MAX_DAYS, `期限最長 ${API_TOKEN_MAX_DAYS} 天（一年）`),
});

const COLS = 'id, name, hint, scope, created_at, expires_at, last_used_at, revoked_at';

/**
 * API token（給 Claude Code 等程式用）：只有最高管理者，而且要用 Google 登入（token 自己不能建 token，auth.ts 的 TOKEN_ROUTES 沒有 /tokens）。
 * token 只在建立時回傳一次；資料庫只存 SHA-256。
 */
export const tokensRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    requireSuperAdmin(c);
    await next();
  })
  .get('/', async (c) => {
    const rows = await all<ApiTokenRow>(
      c.env.DB,
      `SELECT ${COLS} FROM api_tokens WHERE user_email = ? ORDER BY (revoked_at IS NOT NULL), created_at DESC, id DESC`,
      c.get('user').email,
    );
    return c.json(rows.map(toApiToken));
  })
  .post('/', async (c) => {
    const b = await parseBody(c, createSchema);
    const token = `${API_TOKEN_PREFIX}${randomToken()}`;
    const now = new Date();
    const res = await stmt(
      c.env.DB,
      `INSERT INTO api_tokens (token_hash, hint, name, user_email, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      await sha256Hex(token),
      `${token.slice(0, 10)}…`,
      b.name,
      c.get('user').email,
      b.scope,
      taipeiNow(now),
      taipeiNow(new Date(now.getTime() + b.days * DAY_MS)),
    ).run();
    const id = res.meta.last_row_id;
    const row = (await first<ApiTokenRow>(c.env.DB, `SELECT ${COLS} FROM api_tokens WHERE id = ?`, id))!;
    const created: CreatedApiToken = { ...toApiToken(row), token };
    return c.json(created, 201);
  })
  .post('/:id/revoke', async (c) => {
    const id = parseId(c.req.param('id'));
    const changed = await run(
      c.env.DB,
      'UPDATE api_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ? AND user_email = ? AND revoked_at IS NULL',
      taipeiNow(),
      c.get('user').email,
      id,
      c.get('user').email,
    );
    if (!changed) fail(404, '找不到這把 token，或已經撤銷了');
    return c.json({ ok: true });
  });
