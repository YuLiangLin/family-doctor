// 登入（同二胎）：Google 帳號經 Cloudflare Access 登入，驗過是誰之後系統在那台裝置發自己的登入憑證（sessions.ts，一年、每天用就延長）。
// 之後有 Access 憑證就驗它，沒有就看系統的憑證，再用 users 表決定能不能進（不在名單、停用一律擋）。
// 家裡的 dr-claude-runner 用 Access 服務憑證，只能走 /api/agent 的 AGENT_ROUTES。
// API token（Authorization: Bearer fdt_…，最高管理者在設定頁建的，給 Claude Code 等程式用）只能走 TOKEN_ROUTES，依權限再縮小。
// 設定不齊全一律拒絕（fail closed）；只有 localhost + DEV_AUTH_EMAIL 才略過登入。
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AGENT_PREFIX, API_TOKEN_PREFIX, ATTACHMENT_TYPES, TOKEN_SCOPE_LABEL, tokenActor, type Role, type TokenScope } from '../shared/apiTypes';
import { taipeiNow } from '../shared/dates';
import { first, run } from './db';
import type { AppEnv, CurrentUser, Env } from './env';
import { ApiFailure, fail } from './http';
import { createSession, sessionEmail, sha256Hex } from './sessions';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const SEEN_WRITE_MS = 5 * 60_000;

function normalizeTeamDomain(raw: string): string {
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

function isLocalRequest(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export interface Identity {
  email: string;
  picture: string;
  /** 服務憑證的 Client ID；人登入時是空字串 */
  clientId: string;
}

/** 只接受 Google 的頭像網址 */
export function safePicture(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 1000) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (u.hostname === 'googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com'))
      ? u.toString()
      : '';
  } catch {
    return '';
  }
}

async function verifyAccess(env: Env & { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string }, token: string): Promise<Identity> {
  const team = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  let jwks = jwksCache.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksCache.set(team, jwks);
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer: team, audience: env.ACCESS_AUD, algorithms: ['RS256'] }));
  } catch {
    return fail(401, '登入憑證無效或已過期，請重新整理頁面');
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email) {
    const clientId = typeof payload.common_name === 'string' ? payload.common_name.trim() : '';
    if (clientId && !payload.sub) return { email: '', picture: '', clientId };
    return fail(401, '登入憑證裡沒有 email');
  }
  const custom = payload.custom as Record<string, unknown> | undefined;
  return { email, picture: safePicture(custom?.picture), clientId: '' };
}

export function emailList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdmin(env: Env, email: string, role: Role): boolean {
  return role === 'admin' && emailList(env.SUPER_ADMINS).includes(email);
}

async function loadUser(env: Env, { email, picture }: Identity): Promise<CurrentUser | null> {
  const row = await first<{ email: string; name: string; role: Role; active: number; picture_url: string; last_seen_at: string; member_id: number | null }>(
    env.DB,
    'SELECT email, name, role, active, picture_url, last_seen_at, member_id FROM users WHERE email = ?',
    email,
  );
  const nowDate = new Date();
  const now = taipeiNow(nowDate);
  if (row) {
    if (!row.active) return null;
    const sets: string[] = [];
    const params: string[] = [];
    if (picture && picture !== row.picture_url) {
      sets.push('picture_url = ?');
      params.push(picture);
    }
    if ((row.last_seen_at ?? '') < taipeiNow(new Date(nowDate.getTime() - SEEN_WRITE_MS))) {
      sets.push('last_seen_at = ?');
      params.push(now);
    }
    if (sets.length) await run(env.DB, `UPDATE users SET ${sets.join(', ')} WHERE email = ?`, ...params, email);
    return {
      email: row.email,
      name: row.name,
      role: row.role,
      picture: picture || row.picture_url,
      memberId: row.member_id,
      agent: false,
      superAdmin: isSuperAdmin(env, row.email, row.role),
    };
  }
  if (emailList(env.BOOTSTRAP_ADMINS).includes(email) || emailList(env.SUPER_ADMINS).includes(email)) {
    await run(
      env.DB,
      `INSERT INTO users (email, name, role, active, created_at, updated_at, updated_by, picture_url, last_seen_at)
       VALUES (?, '', 'admin', 1, ?, ?, 'BOOTSTRAP', ?, ?) ON CONFLICT(email) DO NOTHING`,
      email,
      now,
      now,
      picture,
      now,
    );
    return { email, name: '', role: 'admin', picture, memberId: null, agent: false, superAdmin: isSuperAdmin(env, email, 'admin') };
  }
  return null;
}

/** AGENT_CLIENT_IDS 白名單裡的服務憑證 → Dr.Claude runner */
export function loadAgent(env: Env, clientId: string): CurrentUser | null {
  for (const item of (env.AGENT_CLIENT_IDS ?? '').split(',')) {
    const [id, ...rest] = item.split('=');
    if (!id.trim() || id.trim() !== clientId) continue;
    const name = rest.join('=').trim().slice(0, 30) || 'Dr.Claude';
    return { email: `${AGENT_PREFIX}${name}`, name, role: 'member', picture: '', memberId: null, agent: true, superAdmin: false };
  }
  return null;
}

/**
 * runner 能呼叫的 API（其他一律 403）：領工作、讀工作內容與附件、查紀錄、回報進度、完成、失敗。
 * runner 寫入紀錄只能透過「完成」帶的 actions，由伺服器檢查後才存；看診與用藥只會是草稿，要人按確認。
 */
const AGENT_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^\/api\/agent\/jobs\/claim$/ },
  { method: 'GET', path: /^\/api\/agent\/jobs\/\d+$/ },
  { method: 'GET', path: /^\/api\/agent\/jobs\/\d+\/attachments\/\d+$/ },
  { method: 'GET', path: /^\/api\/agent\/records$/ },
  { method: 'POST', path: /^\/api\/agent\/jobs\/\d+\/(progress|complete|fail)$/ },
];

export function agentMayCall(method: string, url: string): boolean {
  const path = new URL(url).pathname.replace(/\/+$/, '');
  return AGENT_ROUTES.some((r) => r.method === method && r.path.test(path));
}

export const isAgentPath = (url: string) => /^\/api\/agent(\/|$)/.test(new URL(url).pathname);

/**
 * API token 能呼叫的 API（其他一律 403），依權限一層包一層：
 * - read 唯讀：今天、時間軸、家人、看診、用藥、附件
 * - log 再加：記身體狀況、量測、打勾（含作廢、取消打勾）
 * - write 再加：家人、看診、用藥（直接生效，created_by 記成 token:<id>:<名稱>，畫面標「經 API」）、上傳附件
 * 都不能：管帳號（/users）、建 token（/tokens）、通知裝置（/push）、Dr.Claude 對話與讀藥袋（/chat、/scan）、移除家人、/api/agent。
 */
const TOKEN_ROUTES: Record<TokenScope, { method: string; path: RegExp }[]> = {
  read: [
    { method: 'GET', path: /^\/api\/me$/ },
    { method: 'GET', path: /^\/api\/(today|timeline)$/ },
    { method: 'GET', path: /^\/api\/members(\/\d+)?$/ },
    { method: 'GET', path: /^\/api\/visits(\/\d+)?$/ },
    { method: 'GET', path: /^\/api\/medications\/\d+$/ },
    { method: 'GET', path: /^\/api\/attachments\/\d+(\/file)?$/ },
  ],
  log: [
    { method: 'POST', path: /^\/api\/(notes|measurements)$/ },
    { method: 'POST', path: /^\/api\/(notes|measurements)\/\d+\/void$/ },
    { method: 'POST', path: /^\/api\/doses(\/clear)?$/ },
    { method: 'POST', path: /^\/api\/doses\/\d+\/delete$/ },
  ],
  write: [
    { method: 'POST', path: /^\/api\/members$/ },
    { method: 'PUT', path: /^\/api\/members\/\d+$/ },
    { method: 'POST', path: /^\/api\/visits$/ },
    { method: 'PUT', path: /^\/api\/visits\/\d+$/ },
    { method: 'POST', path: /^\/api\/visits\/\d+\/void$/ },
    { method: 'POST', path: /^\/api\/medications$/ },
    { method: 'PUT', path: /^\/api\/medications\/\d+$/ },
    { method: 'POST', path: /^\/api\/medications\/\d+\/(stop|resume|void)$/ },
    { method: 'POST', path: /^\/api\/attachments$/ },
  ],
};
const SCOPE_LAYERS: Record<TokenScope, TokenScope[]> = { read: ['read'], log: ['read', 'log'], write: ['read', 'log', 'write'] };

export function tokenMayCall(scope: TokenScope, method: string, url: string): boolean {
  const path = new URL(url).pathname.replace(/\/+$/, '');
  return SCOPE_LAYERS[scope].some((layer) => TOKEN_ROUTES[layer].some((r) => r.method === method && r.path.test(path)));
}

/** Authorization 標頭；沒帶是 null（帶了但格式不對是空字串，一律當成無效） */
function bearerToken(c: Context<AppEnv>): string | null {
  const h = c.req.header('Authorization');
  if (h === undefined) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : '';
}

/** API token → 使用者；無效、過期、撤銷、帳號停用、不再是最高管理者 → null */
async function loadTokenUser(env: Env, raw: string): Promise<CurrentUser | null> {
  if (!raw.startsWith(API_TOKEN_PREFIX) || raw.length > 100) return null;
  const nowDate = new Date();
  const row = await first<{ id: number; name: string; scope: TokenScope; user_email: string; last_used_at: string | null; role: Role; member_id: number | null }>(
    env.DB,
    `SELECT t.id, t.name, t.scope, t.user_email, t.last_used_at, u.role, u.member_id
       FROM api_tokens t JOIN users u ON u.email = t.user_email
      WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ? AND u.active = 1`,
    await sha256Hex(raw),
    taipeiNow(nowDate),
  );
  if (!row || !isSuperAdmin(env, row.user_email, row.role)) return null;
  if ((row.last_used_at ?? '') < taipeiNow(new Date(nowDate.getTime() - SEEN_WRITE_MS))) {
    await run(env.DB, 'UPDATE api_tokens SET last_used_at = ? WHERE id = ?', taipeiNow(nowDate), row.id);
  }
  return {
    email: tokenActor(row.id, row.name),
    name: `${row.name}（API token）`,
    role: row.role,
    picture: '',
    memberId: row.member_id,
    agent: false,
    superAdmin: false,
    token: { id: row.id, name: row.name, scope: row.scope, ownerEmail: row.user_email },
  };
}

function requireAccessConfig(env: Env): { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string } {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = env;
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD) {
    return fail(500, '系統尚未設定 Cloudflare Access（ACCESS_TEAM_DOMAIN／ACCESS_AUD），請依部署指南設定');
  }
  return { ACCESS_TEAM_DOMAIN, ACCESS_AUD };
}

export async function identify(c: Context<AppEnv>): Promise<Identity> {
  const env = c.env;
  if (isLocalRequest(c.req.url) && env.DEV_AUTH_EMAIL) {
    const dev = env.DEV_AUTH_EMAIL.trim();
    // 本機測試 runner：DEV_AUTH_EMAIL=agent:<Client ID>
    if (dev.startsWith(AGENT_PREFIX)) return { email: '', picture: '', clientId: dev.slice(AGENT_PREFIX.length) };
    return { email: dev.toLowerCase(), picture: '', clientId: '' };
  }
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = requireAccessConfig(env);
  const token = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');
  let accessError: ApiFailure | null = null;
  if (token) {
    try {
      const id = await verifyAccess({ ...env, ACCESS_TEAM_DOMAIN, ACCESS_AUD }, token);
      if (id.email && (await sessionEmail(c)) !== id.email) await createSession(c, id.email);
      return id;
    } catch (e) {
      if (!(e instanceof ApiFailure)) throw e;
      accessError = e;
    }
  }
  const email = await sessionEmail(c);
  if (email) return { email, picture: '', clientId: '' };
  if (accessError) throw accessError;
  return fail(401, '未登入（請用 Google 帳號登入）');
}

/** 登入後要回去的頁面：只收本站的畫面路徑（擋開放式轉址） */
export function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  const base = 'https://same-origin.invalid';
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return '/';
  }
  if (u.origin !== base || u.pathname === '/api' || u.pathname.startsWith('/api/')) return '/';
  return u.pathname + u.search + u.hash;
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const bearer = bearerToken(c);
  if (bearer !== null) {
    if (!isLocalRequest(c.req.url)) requireAccessConfig(c.env);
    if (isAgentPath(c.req.url)) return c.json({ error: '這個網址只給 Dr.Claude 服務用' }, 403);
    const user = bearer ? await loadTokenUser(c.env, bearer) : null;
    if (!user?.token) return c.json({ error: 'API token 無效、過期或已撤銷' }, 401);
    if (!tokenMayCall(user.token.scope, c.req.method, c.req.url)) {
      return c.json({ error: `這把 API token（${TOKEN_SCOPE_LABEL[user.token.scope]}）不能用這個功能` }, 403);
    }
    c.set('user', user);
    await next();
    return;
  }
  const identity = await identify(c);
  const agentPath = isAgentPath(c.req.url);
  if (identity.clientId) {
    const agent = loadAgent(c.env, identity.clientId);
    if (!agent) return c.json({ error: `服務憑證 ${identity.clientId} 沒有開通（AGENT_CLIENT_IDS）` }, 403);
    if (!agentPath || !agentMayCall(c.req.method, c.req.url)) return c.json({ error: 'Dr.Claude 服務只能使用 /api/agent' }, 403);
    c.set('user', agent);
    await next();
    return;
  }
  if (agentPath) return c.json({ error: '這個網址只給 Dr.Claude 服務用' }, 403);
  const user = await loadUser(c.env, identity);
  if (!user) return c.json({ error: `帳號 ${identity.email} 還沒開通，請請家裡的管理者把你加進來` }, 403);
  c.set('user', user);
  await next();
});

/** 上傳檔案：本文是檔案本身，一定要帶自訂 header（跨站表單送不出這種請求） */
function isFileUpload(method: string, url: string, ct: string, filenameHeader: string | undefined): boolean {
  if (method !== 'POST' || !filenameHeader) return false;
  const type = ct.split(';')[0].trim().toLowerCase();
  return new URL(url).pathname === '/api/attachments' && (ATTACHMENT_TYPES as readonly string[]).includes(type);
}

/** 擋 CSRF：會改資料的請求一定要是 JSON；上傳檔案例外 */
export const jsonOnlyMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const ct = c.req.header('Content-Type') ?? '';
    if (!ct.toLowerCase().startsWith('application/json') && !isFileUpload(method, c.req.url, ct, c.req.header('X-Upload-Filename'))) {
      return c.json({ error: '請求格式錯誤（Content-Type 需為 application/json）' }, 415);
    }
  }
  await next();
});
