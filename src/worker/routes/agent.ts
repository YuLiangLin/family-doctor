// 家裡的 dr-claude-runner 專用（/api/agent，Cloudflare Access 服務憑證；auth.ts 的 AGENT_ROUTES）。
// runner 只能：領工作、讀工作內容與附件、查紀錄、回報進度、完成、失敗；另外幫忙處理藥品照片（runner 程式做，不經過 AI）。
// 寫入紀錄只能經「完成」帶的 actions：日記、量測直接存（標 Dr.Claude 記的），看診＋用藥只會是草稿，要人在畫面按確認才存。
import { Hono } from 'hono';
import { z } from 'zod';
import { MEASUREMENT_INFO, type AgentJobContext, type ChatAction, type MeasurementKind, type Medication, type VisitDraft } from '../../shared/apiTypes';
import { addDays, daysBetween, taipeiNow, taipeiToday } from '../../shared/dates';
import { courseProgress, scheduleLabel } from '../../shared/meds';
import { all, first, run, stmt } from '../db';
import type { AppEnv, Env } from '../env';
import { FDA_IMAGE_PREFIX } from '../../shared/drugs';
import { fail, parseBody, parseId, zDateTime, zId, zIsoDate, zSlot, zText, zTiming } from '../http';
import { parseJson, toAttachment, type AttachmentRow } from '../mappers';
import { inBackground, notifyUsers } from '../push';
import { loadDoseLogs, loadMeasurements, loadMedications, loadMembers, loadNotes, loadVisits } from '../records';
import { serveAttachment } from './attachments';
import type { JobRow } from './chat';
import { loadDrug, type DrugPhotoRow } from './drugs';
import { sha256Hex } from '../sessions';
import { checkMeasurement } from './journal';

/** 處理中超過這麼久沒回報（runner 當機、斷電）就算失敗 */
export const RUNNING_STALE_MINUTES = 15;
/** 長輪詢最多等幾秒、每隔多久看一次 */
const MAX_WAIT_SECONDS = 25;
const POLL_MS = 1500;
/** 藥品照片：一次領幾張、做多久沒回報就放回佇列、檔案最大多少 */
const PHOTO_BATCH = 3;
const PHOTO_STALE_MINUTES = 10;
const MAX_PHOTO_BYTES = { crop: 1024 * 1024, full: 4 * 1024 * 1024 };

function decodeJpeg(b64: string, max: number): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return fail(400, '照片格式錯誤（base64）');
  }
  if (bin.length > max) fail(400, '照片太大');
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) fail(400, '照片要是 JPEG');
  return bytes;
}

/** 給 Dr.Claude 看的對話最多幾則 */
const MAX_HISTORY = 30;

/** 年齡（小朋友到月） */
export function ageText(birthDate: string | null, today: string): string {
  if (!birthDate) return '';
  const days = daysBetween(birthDate, today);
  if (days < 0) return '';
  let months = (Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(birthDate.slice(5, 7)));
  if (Number(today.slice(8, 10)) < Number(birthDate.slice(8, 10))) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y >= 18) return `${y} 歲`;
  if (y === 0) return `${m} 個月`;
  return m ? `${y} 歲 ${m} 個月` : `${y} 歲`;
}

async function touchRunner(db: D1Database) {
  const now = taipeiNow();
  await run(
    db,
    `INSERT INTO app_state (key, value, updated_at) VALUES ('runner_last_poll', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    now,
    now,
  );
}

async function failStale(db: D1Database) {
  const cutoff = taipeiNow(new Date(Date.now() - RUNNING_STALE_MINUTES * 60_000));
  await run(
    db,
    `UPDATE ai_jobs SET status = 'failed', error = 'Dr.Claude 處理到一半中斷了（家裡的主機可能重開或斷線），請按「再試一次」', finished_at = ?, updated_at = ?
     WHERE status = 'running' AND updated_at < ?`,
    taipeiNow(),
    taipeiNow(),
    cutoff,
  );
}

async function claimOne(db: D1Database): Promise<JobRow | null> {
  for (let i = 0; i < 3; i++) {
    const next = await first<JobRow>(db, `SELECT * FROM ai_jobs WHERE status = 'queued' ORDER BY id LIMIT 1`);
    if (!next) return null;
    const now = taipeiNow();
    const n = await run(db, `UPDATE ai_jobs SET status = 'running', claimed_at = ?, updated_at = ?, stage = 'start' WHERE id = ? AND status = 'queued'`, now, now, next.id);
    if (n) return { ...next, status: 'running', claimed_at: now };
  }
  return null;
}

async function runningJob(db: D1Database, id: number): Promise<JobRow> {
  const job = await first<JobRow>(db, 'SELECT * FROM ai_jobs WHERE id = ?', id);
  if (!job) return fail(404, '找不到這件工作');
  if (job.status !== 'running') return fail(409, `這件工作已經是 ${job.status}（可能被取消了）`);
  return job;
}

/** 這件工作看得到的附件：工作本身附的＋這段對話裡附過的 */
async function jobAttachmentIds(db: D1Database, job: JobRow): Promise<number[]> {
  const ids = new Set(parseJson<number[]>(job.attachment_ids, []));
  if (job.conversation_id) {
    const rows = await all<{ attachment_ids: string }>(db, 'SELECT attachment_ids FROM chat_messages WHERE conversation_id = ?', job.conversation_id);
    for (const r of rows) for (const id of parseJson<number[]>(r.attachment_ids, [])) ids.add(id);
  }
  return [...ids];
}

function progressText(m: Medication, logs: Parameters<typeof courseProgress>[1], today: string): string {
  const p = courseProgress(m, logs, today);
  if (m.asNeeded) return `需要時吃，已記錄吃過 ${logs.filter((l) => l.medicationId === m.id).length} 次`;
  const parts = [p.totalDays ? `第 ${Math.min(p.dayNo, p.totalDays)}/${p.totalDays} 天` : `第 ${p.dayNo} 天（長期）`, `打勾吃了 ${p.taken} 包`];
  if (p.remaining !== null) parts.push(`還剩 ${p.remaining} 包`);
  if (p.missedBeforeToday) parts.push(`之前有 ${p.missedBeforeToday} 包沒打勾`);
  if (m.stoppedAt) parts.push(`${m.stoppedAt} 停藥（${m.stopReason || '沒寫原因'}）`);
  return parts.join('，');
}

export async function buildContext(env: Env, job: JobRow): Promise<AgentJobContext> {
  const db = env.DB;
  const today = taipeiToday();
  const since = addDays(today, -120);
  const members = await loadMembers(db);
  const weights = await all<{ member_id: number; value: number }>(
    db,
    `SELECT member_id, value FROM measurements m WHERE kind = 'weight' AND voided_at IS NULL
       AND measured_at = (SELECT MAX(measured_at) FROM measurements x WHERE x.member_id = m.member_id AND x.kind = 'weight' AND x.voided_at IS NULL)`,
  );
  const asker = await first<{ email: string; name: string; member_id: number | null }>(db, 'SELECT email, name, member_id FROM users WHERE email = ?', job.created_by);
  let conversation: AgentJobContext['conversation'] = null;
  if (job.conversation_id) {
    const conv = await first<{ id: number; member_id: number | null }>(db, 'SELECT id, member_id FROM conversations WHERE id = ?', job.conversation_id);
    const msgs = await all<{ role: 'user' | 'assistant'; body: string; created_at: string; attachment_ids: string; id: number }>(
      db,
      'SELECT id, role, body, created_at, attachment_ids FROM chat_messages WHERE conversation_id = ? AND id <= ? ORDER BY id DESC LIMIT ?',
      job.conversation_id,
      job.message_id ?? Number.MAX_SAFE_INTEGER,
      MAX_HISTORY,
    );
    conversation = {
      id: conv!.id,
      memberId: conv!.member_id,
      messages: msgs.reverse().map((m) => ({ role: m.role, body: m.body, createdAt: m.created_at, attachmentIds: parseJson<number[]>(m.attachment_ids, []) })),
    };
  }
  const meds = (await loadMedications(db)).filter((m) => {
    const end = m.stoppedAt ?? (m.days ? addDays(m.startDate, m.days) : null);
    return end === null || end >= addDays(today, -14);
  });
  const logs = await loadDoseLogs(db, meds.map((m) => m.id));
  const attIds = await jobAttachmentIds(db, job);
  const atts = attIds.length
    ? await all<AttachmentRow>(db, `SELECT * FROM attachments WHERE id IN (${attIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, ...attIds)
    : [];
  return {
    job: { id: job.id, kind: job.kind, memberId: job.member_id, createdBy: job.created_by, attachmentIds: parseJson<number[]>(job.attachment_ids, []) },
    today,
    now: taipeiNow(),
    asker: { email: job.created_by, name: asker?.name ?? '', memberId: asker?.member_id ?? null },
    members: members.map((m) => ({ ...m, ageText: ageText(m.birthDate, today), latestWeightKg: weights.find((w) => w.member_id === m.id)?.value ?? null })),
    conversation,
    activeMedications: meds.map((m) => ({ ...m, schedule: scheduleLabel(m.slots, m.timing, m.asNeeded), progress: progressText(m, logs, today) })),
    recentVisits: await loadVisits(db, { since, limit: 40 }),
    recentNotes: await loadNotes(db, { since: addDays(today, -60), limit: 80 }),
    recentMeasurements: await loadMeasurements(db, { since: addDays(today, -60), limit: 120 }),
    attachments: atts.map(toAttachment),
  };
}

const KINDS = Object.keys(MEASUREMENT_INFO) as [MeasurementKind, ...MeasurementKind[]];

const medDraftSchema = z.object({
  name: zText(120).min(1),
  genericName: zText(120).default(''),
  category: zText(40).default(''),
  purpose: zText(200).default(''),
  appearance: zText(80).default(''),
  dose: zText(40).default('1 顆'),
  slots: z.array(zSlot).max(4).default([]),
  timing: zTiming.default('after'),
  asNeeded: z.boolean().default(false),
  days: z.number().int().min(1).max(365).nullable().default(null),
  mustFinish: z.boolean().default(false),
  cautions: zText(500).default(''),
});

const draftSchema = z.object({
  visitDate: zIsoDate,
  clinic: zText(80).default(''),
  department: zText(40).default(''),
  doctor: zText(40).default(''),
  reason: zText(1000).default(''),
  diagnosis: zText(1000).default(''),
  advice: zText(1000).default(''),
  followUpDate: zIsoDate.nullable().default(null),
  copay: z.number().int().min(0).max(1_000_000).nullable().default(null),
  medications: z.array(medDraftSchema).max(20).default([]),
  uncertain: z.array(zText(200)).max(20).default([]),
});

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note'), memberId: zId, notedAt: zDateTime.optional(), body: zText(2000).min(1), severity: z.number().int().min(0).max(3).default(0) }),
  z.object({
    type: z.literal('measurement'),
    memberId: zId,
    kind: z.enum(KINDS),
    value: z.number(),
    value2: z.number().nullable().default(null),
    measuredAt: zDateTime.optional(),
    note: zText(200).default(''),
  }),
  z.object({ type: z.literal('visit_draft'), memberId: zId, draft: draftSchema }),
]);

const completeSchema = z.object({
  /** chat：回覆內容 */
  reply: zText(8000).default(''),
  mood: z.enum(['calm', 'happy', 'concerned', 'urgent']).default('calm'),
  actions: z.array(actionSchema).max(10).default([]),
  /** rx_scan：草稿 */
  draft: draftSchema.optional(),
  costUsd: z.number().min(0).max(100).nullable().default(null),
});

const nowMinute = () => taipeiNow().slice(0, 16);

export const agentRoutes = new Hono<AppEnv>()
  // 領工作（長輪詢）：?wait=秒數，最多 25 秒；沒工作回 204
  .post('/jobs/claim', async (c) => {
    const wait = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number(c.req.query('wait') ?? 0) || 0));
    const deadline = Date.now() + wait * 1000;
    await touchRunner(c.env.DB);
    await failStale(c.env.DB);
    for (;;) {
      const job = await claimOne(c.env.DB);
      if (job) return c.json({ id: job.id, kind: job.kind });
      // 有藥品照片在排隊：先回去讓 runner 處理照片（X-Drug-Photos），不用等滿長輪詢
      if (await first(c.env.DB, `SELECT 1 FROM drug_photos WHERE status = 'queued' LIMIT 1`)) return c.body(null, 204, { 'X-Drug-Photos': 'queued' });
      if (Date.now() + POLL_MS > deadline) return c.body(null, 204);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  })
  // ---- 藥品照片（runner 程式下載食藥署原圖、裁到藥丸、縮小後傳回來） ----
  .post('/drug-photos/claim', async (c) => {
    const db = c.env.DB;
    const now = taipeiNow();
    const stale = taipeiNow(new Date(Date.now() - PHOTO_STALE_MINUTES * 60_000));
    await run(db, `UPDATE drug_photos SET status = 'queued', updated_at = ? WHERE status = 'working' AND updated_at < ?`, now, stale);
    const rows = await all<{ license_no: string; image_url: string }>(
      db,
      `SELECT p.license_no, c.image_url FROM drug_photos p JOIN drug_catalog c ON c.license_no = p.license_no
        WHERE p.status = 'queued' AND c.image_url LIKE ? ORDER BY p.requested_at LIMIT ?`,
      `${FDA_IMAGE_PREFIX}%`,
      PHOTO_BATCH,
    );
    const items: { license: string; imageUrl: string }[] = [];
    for (const r of rows) {
      const n = await run(db, `UPDATE drug_photos SET status = 'working', attempts = attempts + 1, updated_at = ? WHERE license_no = ? AND status = 'queued'`, now, r.license_no);
      if (n) items.push({ license: r.license_no, imageUrl: r.image_url });
    }
    return c.json({ items });
  })
  .post('/drug-photos/:license', async (c) => {
    const db = c.env.DB;
    const license = c.req.param('license');
    const b = await parseBody(c, z.object({ sourceUrl: z.string().max(500), cropped: z.boolean(), crop: z.string().min(10), full: z.string().min(10) }));
    const p = await first<DrugPhotoRow>(db, 'SELECT * FROM drug_photos WHERE license_no = ?', license);
    if (!p || p.status !== 'working') return fail(409, '這張照片不是處理中（可能已經做好或逾時了）');
    if (!(await loadDrug(db, license))) return fail(404, '找不到這個藥');
    const crop = decodeJpeg(b.crop, MAX_PHOTO_BYTES.crop);
    const full = decodeJpeg(b.full, MAX_PHOTO_BYTES.full);
    const prefix = `drug-photos/${(await sha256Hex(license)).slice(0, 32)}`;
    await c.env.FILES.put(`${prefix}/crop.jpg`, crop, { httpMetadata: { contentType: 'image/jpeg' } });
    await c.env.FILES.put(`${prefix}/full.jpg`, full, { httpMetadata: { contentType: 'image/jpeg' } });
    await run(
      db,
      `UPDATE drug_photos SET status = 'done', source_url = ?, r2_prefix = ?, cropped = ?, error = '', updated_at = ? WHERE license_no = ?`,
      b.sourceUrl,
      prefix,
      b.cropped,
      taipeiNow(),
      license,
    );
    return c.json({ ok: true });
  })
  .post('/drug-photos/:license/fail', async (c) => {
    const license = c.req.param('license');
    const { error } = await parseBody(c, z.object({ error: zText(500).default('') }));
    const drug = await loadDrug(c.env.DB, license);
    await run(
      c.env.DB,
      `UPDATE drug_photos SET status = 'failed', error = ?, source_url = ?, updated_at = ? WHERE license_no = ?`,
      error,
      drug?.image_url ?? '',
      taipeiNow(),
      license,
    );
    return c.json({ ok: true });
  })
  .get('/jobs/:id', async (c) => {
    const job = await runningJob(c.env.DB, parseId(c.req.param('id')));
    return c.json(await buildContext(c.env, job));
  })
  .get('/jobs/:id/attachments/:aid', async (c) => {
    const job = await runningJob(c.env.DB, parseId(c.req.param('id')));
    const aid = parseId(c.req.param('aid'));
    if (!(await jobAttachmentIds(c.env.DB, job)).includes(aid)) fail(403, '這個檔案不屬於這件工作');
    const row = await first<AttachmentRow>(c.env.DB, 'SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL', aid);
    if (!row) fail(404, '檔案已刪除');
    return serveAttachment(c.env, row!);
  })
  // 查更早的紀錄（Dr.Claude 的工具 search_records 用）：?memberId=&from=&to=
  .get('/records', async (c) => {
    const memberId = c.req.query('memberId') ? parseId(c.req.query('memberId')) : undefined;
    const from = c.req.query('from') ?? addDays(taipeiToday(), -365);
    const to = c.req.query('to') ?? taipeiToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail(400, '日期格式錯誤');
    const inRange = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to;
    const visits = (await loadVisits(c.env.DB, { memberId, since: from, limit: 300 })).filter((v) => inRange(v.visitDate));
    const meds = (await loadMedications(c.env.DB, { memberId })).filter((m) => m.startDate <= to && (!m.days || addDays(m.startDate, m.days) >= from));
    return c.json({
      from,
      to,
      visits,
      medications: meds,
      notes: (await loadNotes(c.env.DB, { memberId, since: from, limit: 500 })).filter((n) => inRange(n.notedAt)),
      measurements: (await loadMeasurements(c.env.DB, { memberId, since: from, limit: 500 })).filter((m) => inRange(m.measuredAt)),
    });
  })
  .post('/jobs/:id/progress', async (c) => {
    const job = await runningJob(c.env.DB, parseId(c.req.param('id')));
    const { stage } = await parseBody(c, z.object({ stage: zText(40) }));
    await run(c.env.DB, 'UPDATE ai_jobs SET stage = ?, updated_at = ? WHERE id = ?', stage, taipeiNow(), job.id);
    return c.json({ ok: true });
  })
  .post('/jobs/:id/fail', async (c) => {
    const job = await runningJob(c.env.DB, parseId(c.req.param('id')));
    const { error } = await parseBody(c, z.object({ error: zText(1000).min(1) }));
    await run(c.env.DB, `UPDATE ai_jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`, error, taipeiNow(), taipeiNow(), job.id);
    return c.json({ ok: true });
  })
  .post('/jobs/:id/complete', async (c) => {
    const job = await runningJob(c.env.DB, parseId(c.req.param('id')));
    const b = await parseBody(c, completeSchema);
    const db = c.env.DB;
    const now = taipeiNow();
    const memberIds = new Set((await loadMembers(db, true)).map((m) => m.id));

    if (job.kind === 'rx_scan') {
      if (!b.draft) fail(400, '讀藥袋要回 draft');
      const draft: VisitDraft = b.draft!;
      await run(
        db,
        `UPDATE ai_jobs SET status = 'done', result = ?, cost_usd = ?, stage = 'done', finished_at = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(draft),
        b.costUsd,
        now,
        now,
        job.id,
      );
      return c.json({ ok: true });
    }

    if (!b.reply) fail(400, '回覆不能是空的');
    for (const a of b.actions) {
      if (!memberIds.has(a.memberId)) fail(400, `沒有編號 ${a.memberId} 的家人`);
      if (a.type === 'measurement') {
        const problem = checkMeasurement(a.kind, a.value, a.value2);
        if (problem) fail(400, `量測不合理：${problem}`);
      }
    }
    // 記錄要跟回覆在同一個交易裡：先存日記與量測拿到編號，再存回覆
    const saved: ChatAction[] = [];
    for (const a of b.actions) {
      if (a.type === 'note') {
        const res = await stmt(
          db,
          `INSERT INTO health_notes (member_id, noted_at, body, severity, source, created_at, created_by) VALUES (?, ?, ?, ?, 'dr_claude', ?, ?)`,
          a.memberId,
          a.notedAt ?? nowMinute(),
          a.body,
          a.severity,
          now,
          job.created_by,
        ).run();
        saved.push({ type: 'note', id: res.meta.last_row_id, memberId: a.memberId, summary: a.body.slice(0, 80) });
      } else if (a.type === 'measurement') {
        const res = await stmt(
          db,
          `INSERT INTO measurements (member_id, kind, value, value2, measured_at, note, source, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'dr_claude', ?, ?)`,
          a.memberId,
          a.kind,
          a.value,
          a.value2,
          a.measuredAt ?? nowMinute(),
          a.note,
          now,
          job.created_by,
        ).run();
        const info = MEASUREMENT_INFO[a.kind];
        saved.push({ type: 'measurement', id: res.meta.last_row_id, memberId: a.memberId, summary: `${info.label} ${a.value}${a.value2 ? `/${a.value2}` : ''} ${info.unit}` });
      } else {
        saved.push({ type: 'visit_draft', memberId: a.memberId, draft: a.draft });
      }
    }
    await db.batch([
      stmt(
        db,
        `INSERT INTO chat_messages (conversation_id, role, body, actions, mood, created_at) VALUES (?, 'assistant', ?, ?, ?, ?)`,
        job.conversation_id,
        b.reply,
        JSON.stringify(saved),
        b.mood,
        now,
      ),
      stmt(db, `UPDATE ai_jobs SET status = 'done', cost_usd = ?, stage = 'done', finished_at = ?, updated_at = ? WHERE id = ?`, b.costUsd, now, now, job.id),
      stmt(db, 'UPDATE conversations SET updated_at = ? WHERE id = ?', now, job.conversation_id),
    ]);
    // 人可能已經離開畫面：推一則通知（緊急的寫在標題）
    await inBackground(c, () =>
      notifyUsers(
        c.env,
        [job.created_by],
        {
          title: b.mood === 'urgent' ? '⚠️ Dr.Claude：建議盡快就醫' : '🦦 Dr.Claude 回覆了',
          body: b.reply.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').slice(0, 120),
          url: `/doctor/${job.conversation_id}`,
          tag: `chat-${job.conversation_id}`,
        },
        { ttl: 3600, urgency: b.mood === 'urgent' ? 'high' : 'normal' },
      ),
    );
    return c.json({ ok: true, actions: saved });
  });
