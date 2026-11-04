// Dr.Claude 對話與讀藥袋：人在這裡送出，家裡的 runner 經 /api/agent 領走處理（agent.ts）
import { Hono } from 'hono';
import { z } from 'zod';
import type { AiJob, Conversation, ConversationDetail, VisitDraft } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { all, first, run, stmt } from '../db';
import type { AppEnv, Env } from '../env';
import { fail, parseBody, parseId, zId, zText } from '../http';
import { parseJson, toChatMessage, type ChatMessageRow } from '../mappers';
import { requireMember, runnerState } from '../records';

export interface JobRow {
  id: number;
  kind: 'chat' | 'rx_scan';
  status: AiJob['status'];
  conversation_id: number | null;
  message_id: number | null;
  member_id: number | null;
  attachment_ids: string;
  stage: string;
  result: string | null;
  error: string;
  cost_usd: number | null;
  created_by: string;
  created_at: string;
  claimed_at: string | null;
  updated_at: string;
  finished_at: string | null;
}

export const toJob = (r: JobRow): AiJob => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  stage: r.stage,
  error: r.error,
  result: r.kind === 'rx_scan' ? parseJson<VisitDraft | null>(r.result, null) : null,
  createdAt: r.created_at,
});

interface ConversationRow {
  id: number;
  user_email: string;
  member_id: number | null;
  title: string;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  memberId: r.member_id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastMessage: r.last_message ?? '',
});

async function myConversation(db: D1Database, id: number, email: string): Promise<ConversationRow> {
  const row = await first<ConversationRow>(db, 'SELECT * FROM conversations WHERE id = ? AND user_email = ? AND archived_at IS NULL', id, email);
  if (!row) return fail(404, '找不到這段對話');
  return row;
}

/** 每個帳號每天最多問幾次（含讀藥袋）；防止 runner 被洗爆、API 點數用光 */
async function checkDailyLimit(env: Env, email: string) {
  const limit = Number(env.AI_DAILY_LIMIT) > 0 ? Number(env.AI_DAILY_LIMIT) : 60;
  const today = taipeiNow().slice(0, 10);
  const row = await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM ai_jobs WHERE created_by = ? AND created_at >= ?`, email, `${today} 00:00:00`);
  if ((row?.n ?? 0) >= limit) fail(429, `今天已經問了 ${limit} 次，明天再來（上限可以請管理者調整 AI_DAILY_LIMIT）`);
}

/** 附件要存在；對話附圖只能用自己上傳的 */
async function checkAttachments(db: D1Database, ids: number[], email: string) {
  for (const id of ids) {
    const a = await first<{ created_by: string; content_type: string }>(db, 'SELECT created_by, content_type FROM attachments WHERE id = ? AND deleted_at IS NULL', id);
    if (!a) fail(400, `找不到檔案 #${id}`);
    if (a!.created_by !== email) fail(403, '只能附自己上傳的檔案');
  }
}

async function pendingJob(db: D1Database, conversationId: number): Promise<JobRow | null> {
  return first<JobRow>(
    db,
    `SELECT * FROM ai_jobs WHERE conversation_id = ? AND (status IN ('queued', 'running') OR (status = 'failed' AND id = (SELECT MAX(id) FROM ai_jobs WHERE conversation_id = ?)))
     ORDER BY id DESC LIMIT 1`,
    conversationId,
    conversationId,
  );
}

export async function conversationDetail(db: D1Database, conv: ConversationRow): Promise<ConversationDetail> {
  const rows = await all<ChatMessageRow>(db, 'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id', conv.id);
  const job = await pendingJob(db, conv.id);
  return { conversation: toConversation(conv), messages: rows.map(toChatMessage), pending: job ? toJob(job) : null, runner: await runnerState(db) };
}

const messageSchema = z.object({
  body: zText(4000).default(''),
  attachmentIds: z.array(zId).max(6).default([]),
});

export const chatRoutes = new Hono<AppEnv>()
  .get('/conversations', async (c) => {
    const rows = await all<ConversationRow>(
      c.env.DB,
      `SELECT c.*, (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message
       FROM conversations c WHERE user_email = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100`,
      c.get('user').email,
    );
    return c.json(rows.map(toConversation));
  })
  .post('/conversations', async (c) => {
    const b = await parseBody(c, z.object({ memberId: zId.nullable().default(null) }));
    if (b.memberId) await requireMember(c.env.DB, b.memberId);
    const now = taipeiNow();
    const row = await stmt(
      c.env.DB,
      'INSERT INTO conversations (user_email, member_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
      c.get('user').email,
      b.memberId ?? c.get('user').memberId,
      '',
      now,
      now,
    ).first<ConversationRow>();
    return c.json(toConversation(row!), 201);
  })
  .get('/conversations/:id', async (c) => {
    const conv = await myConversation(c.env.DB, parseId(c.req.param('id')), c.get('user').email);
    return c.json(await conversationDetail(c.env.DB, conv));
  })
  .patch('/conversations/:id', async (c) => {
    const conv = await myConversation(c.env.DB, parseId(c.req.param('id')), c.get('user').email);
    const b = await parseBody(c, z.object({ memberId: zId.nullable().optional(), title: zText(60).optional() }));
    if (b.memberId) await requireMember(c.env.DB, b.memberId);
    await run(
      c.env.DB,
      'UPDATE conversations SET member_id = CASE WHEN ? THEN ? ELSE member_id END, title = COALESCE(?, title) WHERE id = ?',
      b.memberId !== undefined,
      b.memberId ?? null,
      b.title ?? null,
      conv.id,
    );
    return c.json({ ok: true });
  })
  .post('/conversations/:id/archive', async (c) => {
    const conv = await myConversation(c.env.DB, parseId(c.req.param('id')), c.get('user').email);
    await run(c.env.DB, 'UPDATE conversations SET archived_at = ? WHERE id = ?', taipeiNow(), conv.id);
    return c.json({ ok: true });
  })
  // 問 Dr.Claude：存訊息、排一件工作給 runner；同一段對話一次只能有一件在處理
  .post('/conversations/:id/messages', async (c) => {
    const email = c.get('user').email;
    const conv = await myConversation(c.env.DB, parseId(c.req.param('id')), email);
    const b = await parseBody(c, messageSchema);
    if (!b.body && b.attachmentIds.length === 0) fail(400, '請輸入想問的內容');
    const busy = await first(c.env.DB, `SELECT 1 FROM ai_jobs WHERE conversation_id = ? AND status IN ('queued', 'running')`, conv.id);
    if (busy) fail(409, 'Dr.Claude 還在回上一則，等他回完再問');
    await checkAttachments(c.env.DB, b.attachmentIds, email);
    await checkDailyLimit(c.env, email);
    const now = taipeiNow();
    const msg = await stmt(
      c.env.DB,
      `INSERT INTO chat_messages (conversation_id, role, body, attachment_ids, created_at) VALUES (?, 'user', ?, ?, ?) RETURNING id`,
      conv.id,
      b.body,
      JSON.stringify(b.attachmentIds),
      now,
    ).first<{ id: number }>();
    const title = conv.title || (b.body || '附圖').replace(/\s+/g, ' ').slice(0, 30);
    await c.env.DB.batch([
      stmt(
        c.env.DB,
        `INSERT INTO ai_jobs (kind, status, conversation_id, message_id, member_id, attachment_ids, created_by, created_at, updated_at)
         VALUES ('chat', 'queued', ?, ?, ?, ?, ?, ?, ?)`,
        conv.id,
        msg!.id,
        conv.member_id,
        JSON.stringify(b.attachmentIds),
        email,
        now,
        now,
      ),
      stmt(c.env.DB, 'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', title, now, conv.id),
    ]);
    return c.json(await conversationDetail(c.env.DB, { ...conv, title }), 201);
  })
  .post('/jobs/:id/cancel', async (c) => {
    const n = await run(
      c.env.DB,
      `UPDATE ai_jobs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND created_by = ? AND status IN ('queued', 'running')`,
      taipeiNow(),
      taipeiNow(),
      parseId(c.req.param('id')),
      c.get('user').email,
    );
    if (!n) fail(409, '這件已經處理完了');
    return c.json({ ok: true });
  })
  // 失敗了再試一次（重新排隊）
  .post('/jobs/:id/retry', async (c) => {
    const id = parseId(c.req.param('id'));
    const email = c.get('user').email;
    const job = await first<JobRow>(c.env.DB, 'SELECT * FROM ai_jobs WHERE id = ? AND created_by = ?', id, email);
    if (!job) fail(404, '找不到這件');
    if (job!.status !== 'failed' && job!.status !== 'cancelled') fail(409, '這件不是失敗的');
    await checkDailyLimit(c.env, email);
    await run(
      c.env.DB,
      `UPDATE ai_jobs SET status = 'queued', stage = '', error = '', claimed_at = NULL, finished_at = NULL, updated_at = ? WHERE id = ?`,
      taipeiNow(),
      id,
    );
    return c.json({ ok: true });
  });

/** 讀藥袋：上傳藥袋／收據照片 → 排一件 rx_scan → 拿到看診＋用藥草稿，在畫面確認後才存 */
export const scanRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const email = c.get('user').email;
    const b = await parseBody(c, z.object({ memberId: zId, attachmentIds: z.array(zId).min(1, '請先拍藥袋').max(6) }));
    await requireMember(c.env.DB, b.memberId);
    await checkAttachments(c.env.DB, b.attachmentIds, email);
    await checkDailyLimit(c.env, email);
    const now = taipeiNow();
    const row = await stmt(
      c.env.DB,
      `INSERT INTO ai_jobs (kind, status, member_id, attachment_ids, created_by, created_at, updated_at) VALUES ('rx_scan', 'queued', ?, ?, ?, ?, ?) RETURNING *`,
      b.memberId,
      JSON.stringify(b.attachmentIds),
      email,
      now,
      now,
    ).first<JobRow>();
    return c.json({ job: toJob(row!), runner: await runnerState(c.env.DB) }, 201);
  })
  .get('/:id', async (c) => {
    const row = await first<JobRow>(c.env.DB, `SELECT * FROM ai_jobs WHERE id = ? AND kind = 'rx_scan' AND created_by = ?`, parseId(c.req.param('id')), c.get('user').email);
    if (!row) fail(404, '找不到這件');
    return c.json({ job: toJob(row!), runner: await runnerState(c.env.DB) });
  });
