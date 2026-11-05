import { Hono } from 'hono';
import { z } from 'zod';
import type { ChatAction, VisitDetail } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { all, first, run, stmt } from '../db';
import type { AppEnv } from '../env';
import { fail, medicationFields, parseBody, parseId, zId, zIsoDate, zRequiredText, zText } from '../http';
import { parseJson, toAttachment, toMedication, toVisit, type AttachmentRow, type MedicationRow, type VisitRow } from '../mappers';
import { loadVisits, requireMember } from '../records';
import { requireDrugs } from './drugs';

const visitFields = {
  memberId: zId,
  visitDate: zIsoDate,
  clinic: zText(80).default(''),
  department: zText(40).default(''),
  doctor: zText(40).default(''),
  reason: zText(1000).default(''),
  diagnosis: zText(1000).default(''),
  advice: zText(1000).default(''),
  followUpDate: zIsoDate.nullable().default(null),
  copay: z.number().int().min(0).max(1_000_000).nullable().default(null),
  note: zText(2000).default(''),
};

const createSchema = z.object({
  ...visitFields,
  /** 這次開的藥（從看診日開始吃；個別藥可以另外給 startDate） */
  medications: z.array(z.object({ ...medicationFields, startDate: zIsoDate.optional() })).max(20).default([]),
  /** 已上傳的藥袋、收據照片 → 掛到這次看診 */
  attachmentIds: z.array(zId).max(20).default([]),
  /** 從 Dr.水獺 的草稿存的：標記那則訊息的草稿已存 */
  fromMessage: z.object({ messageId: zId, actionIndex: z.number().int().min(0) }).optional(),
});

const updateSchema = z.object(visitFields);

type MedInput = z.infer<typeof createSchema>['medications'][number];

/** 新增一筆用藥的 SQL（看診、單獨加藥共用） */
export function insertMedicationStmt(
  db: D1Database,
  memberId: number,
  visitId: number | null,
  startDate: string,
  m: Omit<MedInput, 'startDate'>,
  who: string,
  now: string,
) {
  return stmt(
    db,
    `INSERT INTO medications (member_id, visit_id, name, generic_name, category, purpose, appearance, dose, slots, timing, as_needed,
       start_date, days, must_finish, cautions, note, created_at, created_by, updated_at, updated_by, drug_license)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
    memberId,
    visitId,
    m.name,
    m.genericName,
    m.category,
    m.purpose,
    m.appearance,
    m.dose,
    m.asNeeded ? '' : m.slots.join(','),
    m.timing,
    m.asNeeded,
    startDate,
    m.days,
    m.mustFinish,
    m.cautions,
    now,
    who,
    now,
    who,
    m.drugLicense ?? null,
  );
}

export async function visitDetail(db: D1Database, id: number): Promise<VisitDetail> {
  const row = await first<VisitRow>(db, 'SELECT * FROM visits WHERE id = ? AND voided_at IS NULL', id);
  if (!row) return fail(404, '找不到這筆看診紀錄');
  const meds = await all<MedicationRow>(db, 'SELECT * FROM medications WHERE visit_id = ? AND voided_at IS NULL ORDER BY id', id);
  const files = await all<AttachmentRow>(db, 'SELECT * FROM attachments WHERE visit_id = ? AND deleted_at IS NULL ORDER BY id', id);
  return { ...toVisit(row), medications: meds.map(toMedication), attachments: files.map(toAttachment) };
}

export const visitsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const memberId = c.req.query('memberId') ? parseId(c.req.query('memberId')) : undefined;
    return c.json(await loadVisits(c.env.DB, { memberId, limit: 300 }));
  })
  .get('/:id', async (c) => c.json(await visitDetail(c.env.DB, parseId(c.req.param('id')))))
  .post('/', async (c) => {
    const b = await parseBody(c, createSchema);
    await requireMember(c.env.DB, b.memberId);
    if (b.followUpDate && b.followUpDate < b.visitDate) fail(400, '回診日不能早於看診日');
    const who = c.get('user').email;
    const now = taipeiNow();
    await requireDrugs(c.env.DB, b.medications.map((m) => m.drugLicense));
    for (const id of b.attachmentIds) {
      const a = await first<{ created_by: string; visit_id: number | null }>(c.env.DB, 'SELECT created_by, visit_id FROM attachments WHERE id = ? AND deleted_at IS NULL', id);
      if (!a) fail(400, `找不到附件 #${id}`);
    }
    // 同一個交易：看診 → 用藥（用 last_insert_rowid 之前先記下看診編號）→ 附件掛上去
    const visit = await stmt(
      c.env.DB,
      `INSERT INTO visits (member_id, visit_date, clinic, department, doctor, reason, diagnosis, advice, follow_up_date, copay, note,
         created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      b.memberId,
      b.visitDate,
      b.clinic,
      b.department,
      b.doctor,
      b.reason,
      b.diagnosis,
      b.advice,
      b.followUpDate,
      b.copay,
      b.note,
      now,
      who,
      now,
      who,
    ).first<{ id: number }>();
    const visitId = visit!.id;
    const stmts = b.medications.map((m) => insertMedicationStmt(c.env.DB, b.memberId, visitId, m.startDate ?? b.visitDate, m, who, now));
    for (const id of b.attachmentIds) {
      stmts.push(stmt(c.env.DB, 'UPDATE attachments SET visit_id = ?, member_id = ? WHERE id = ?', visitId, b.memberId, id));
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    if (b.fromMessage) await markDraftSaved(c.env.DB, who, b.fromMessage.messageId, b.fromMessage.actionIndex, visitId);
    return c.json({ id: visitId }, 201);
  })
  .put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    await visitDetail(c.env.DB, id);
    const b = await parseBody(c, updateSchema);
    await requireMember(c.env.DB, b.memberId);
    await run(
      c.env.DB,
      `UPDATE visits SET member_id = ?, visit_date = ?, clinic = ?, department = ?, doctor = ?, reason = ?, diagnosis = ?, advice = ?,
         follow_up_date = ?, copay = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      b.memberId,
      b.visitDate,
      b.clinic,
      b.department,
      b.doctor,
      b.reason,
      b.diagnosis,
      b.advice,
      b.followUpDate,
      b.copay,
      b.note,
      taipeiNow(),
      c.get('user').email,
      id,
    );
    return c.json({ ok: true });
  })
  // 作廢（連這次開的藥一起）；不硬刪
  .post('/:id/void', async (c) => {
    const id = parseId(c.req.param('id'));
    await visitDetail(c.env.DB, id);
    const { reason } = await parseBody(c, z.object({ reason: zRequiredText(200) }));
    const now = taipeiNow();
    const who = c.get('user').email;
    await c.env.DB.batch([
      stmt(c.env.DB, 'UPDATE visits SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?', now, who, reason, id),
      stmt(c.env.DB, 'UPDATE medications SET voided_at = ?, voided_by = ?, void_reason = ? WHERE visit_id = ? AND voided_at IS NULL', now, who, reason, id),
    ]);
    return c.json({ ok: true });
  });

/** Dr.水獺 訊息裡的看診草稿存好了：記下存成哪一筆（只能動自己的對話） */
async function markDraftSaved(db: D1Database, email: string, messageId: number, index: number, visitId: number) {
  const row = await first<{ actions: string }>(
    db,
    `SELECT m.actions FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND c.user_email = ?`,
    messageId,
    email,
  );
  if (!row) return;
  const actions = parseJson<ChatAction[]>(row.actions, []);
  const a = actions[index];
  if (a?.type !== 'visit_draft') return;
  a.savedVisitId = visitId;
  await run(db, 'UPDATE chat_messages SET actions = ? WHERE id = ?', JSON.stringify(actions), messageId);
}
