import { Hono } from 'hono';
import { z } from 'zod';
import { taipeiNow, taipeiToday } from '../../shared/dates';
import { isScheduledOn, SLOT_INFO, takenAtProblem } from '../../shared/meds';
import { all, first, run, stmt } from '../db';
import type { AppEnv } from '../env';
import { fail, medicationFields, parseBody, parseId, zDateTime, zId, zIsoDate, zRequiredText, zSlot, zText } from '../http';
import { toMedication, type MedicationRow } from '../mappers';
import { requireMember } from '../records';
import { requireDrugs } from './drugs';
import { insertMedicationStmt } from './visits';

const createSchema = z.object({ memberId: zId, visitId: zId.nullable().default(null), startDate: zIsoDate, ...medicationFields });
const updateSchema = z.object({ startDate: zIsoDate, note: zText(500).default(''), ...medicationFields });

async function requireMedication(db: D1Database, id: number) {
  const row = await first<MedicationRow>(db, 'SELECT * FROM medications WHERE id = ? AND voided_at IS NULL', id);
  if (!row) return fail(404, '找不到這個藥');
  return toMedication(row);
}

export const medicationsRoutes = new Hono<AppEnv>()
  .get('/:id', async (c) => c.json(await requireMedication(c.env.DB, parseId(c.req.param('id')))))
  // 單獨加藥（自己買的成藥、長期藥）
  .post('/', async (c) => {
    const b = await parseBody(c, createSchema);
    await requireMember(c.env.DB, b.memberId);
    if (!b.asNeeded && b.slots.length === 0) fail(400, '請選什麼時候吃（或勾「需要時才吃」）');
    if (b.visitId) {
      const v = await first<{ member_id: number }>(c.env.DB, 'SELECT member_id FROM visits WHERE id = ? AND voided_at IS NULL', b.visitId);
      if (!v || v.member_id !== b.memberId) fail(400, '看診紀錄不對');
    }
    await requireDrugs(c.env.DB, [b.drugLicense]);
    const res = await insertMedicationStmt(c.env.DB, b.memberId, b.visitId, b.startDate, b, c.get('user').email, taipeiNow()).run();
    return c.json({ id: res.meta.last_row_id }, 201);
  })
  .put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    await requireMedication(c.env.DB, id);
    const b = await parseBody(c, updateSchema);
    if (!b.asNeeded && b.slots.length === 0) fail(400, '請選什麼時候吃（或勾「需要時才吃」）');
    await run(
      c.env.DB,
      `UPDATE medications SET name = ?, generic_name = ?, category = ?, purpose = ?, appearance = ?, dose = ?, slots = ?, timing = ?,
         as_needed = ?, start_date = ?, days = ?, must_finish = ?, cautions = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      b.name,
      b.genericName,
      b.category,
      b.purpose,
      b.appearance,
      b.dose,
      b.asNeeded ? '' : b.slots.join(','),
      b.timing,
      b.asNeeded,
      b.startDate,
      b.days,
      b.mustFinish,
      b.cautions,
      b.note,
      taipeiNow(),
      c.get('user').email,
      id,
    );
    if (b.drugLicense !== undefined) {
      await requireDrugs(c.env.DB, [b.drugLicense]);
      await run(c.env.DB, 'UPDATE medications SET drug_license = ? WHERE id = ?', b.drugLicense, id);
    }
    return c.json({ ok: true });
  })
  // 對到食藥署哪一款（有照片）；null＝拿掉
  .post('/:id/drug', async (c) => {
    const id = parseId(c.req.param('id'));
    await requireMedication(c.env.DB, id);
    const { license } = await parseBody(c, z.object({ license: z.string().trim().min(1).max(40).nullable() }));
    await requireDrugs(c.env.DB, [license]);
    await run(c.env.DB, 'UPDATE medications SET drug_license = ?, updated_at = ?, updated_by = ? WHERE id = ?', license, taipeiNow(), c.get('user').email, id);
    return c.json({ ok: true });
  })
  // 停藥（醫生說可以停、或有副作用）：那天起不排；抗生素要寫原因
  .post('/:id/stop', async (c) => {
    const id = parseId(c.req.param('id'));
    const med = await requireMedication(c.env.DB, id);
    const b = await parseBody(c, z.object({ date: zIsoDate.optional(), reason: zText(200).default('') }));
    const date = b.date ?? taipeiToday();
    if (med.mustFinish && !b.reason) fail(400, '這個藥醫生交代要吃完，停藥請寫原因（例：醫生說可以停、過敏）');
    if (date < med.startDate) fail(400, '停藥日不能早於開始日');
    await run(
      c.env.DB,
      'UPDATE medications SET stopped_at = ?, stop_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      date,
      b.reason,
      taipeiNow(),
      c.get('user').email,
      id,
    );
    return c.json({ ok: true });
  })
  .post('/:id/resume', async (c) => {
    const id = parseId(c.req.param('id'));
    await requireMedication(c.env.DB, id);
    await run(c.env.DB, `UPDATE medications SET stopped_at = NULL, stop_reason = '', updated_at = ?, updated_by = ? WHERE id = ?`, taipeiNow(), c.get('user').email, id);
    return c.json({ ok: true });
  })
  .post('/:id/void', async (c) => {
    const id = parseId(c.req.param('id'));
    await requireMedication(c.env.DB, id);
    const { reason } = await parseBody(c, z.object({ reason: zRequiredText(200) }));
    await run(c.env.DB, 'UPDATE medications SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?', taipeiNow(), c.get('user').email, reason, id);
    return c.json({ ok: true });
  });

const doseSchema = z.object({
  /** 一種藥；整包一起打勾用 medicationIds */
  medicationId: zId.optional(),
  medicationIds: z.array(zId).max(40).optional(),
  date: zIsoDate,
  slot: z.union([zSlot, z.literal('prn')]),
  status: z.enum(['taken', 'skipped']).default('taken'),
  /** 實際吃藥時間 'YYYY-MM-DD HH:MM'；沒給＝現在（跳過的不用） */
  takenAt: zDateTime.optional(),
  note: zText(200).default(''),
});

const doseIds = (b: { medicationId?: number; medicationIds?: number[] }): number[] => {
  const ids = [...new Set([...(b.medicationIds ?? []), ...(b.medicationId ? [b.medicationId] : [])])];
  if (ids.length === 0) fail(400, '請選要打勾的藥');
  return ids;
};

async function requireMedications(db: D1Database, ids: number[]) {
  const rows = await all<MedicationRow>(db, `SELECT * FROM medications WHERE voided_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (rows.length !== ids.length) fail(404, '找不到這個藥');
  return rows.map(toMedication);
}

/**
 * 吃了沒：一包一包打勾（同一次看診同一個時段的藥一起送 medicationIds），再送一次是更新（例：改吃藥時間）；
 * 需要時吃的（prn）每吃一次記一筆。takenAt 是實際吃藥時間（不一定準時吃、也可能過一陣子才打勾）。
 */
export const dosesRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const b = await parseBody(c, doseSchema);
    const meds = await requireMedications(c.env.DB, doseIds(b));
    if (b.date > taipeiToday()) fail(400, '還沒到的日子不能先打勾');
    for (const med of meds) {
      if (b.slot === 'prn') {
        if (!med.asNeeded) fail(400, `${med.name} 不是「需要時才吃」`);
      } else if (!isScheduledOn(med, b.date) || !med.slots.includes(b.slot)) {
        fail(400, `${b.date} ${SLOT_INFO[b.slot].label}沒有排 ${med.name}`);
      }
    }
    if (b.slot === 'prn' && b.status === 'skipped') fail(400, '需要時才吃的藥不用記跳過');
    const now = taipeiNow();
    const takenAt = b.status === 'taken' ? (b.takenAt ?? now.slice(0, 16)) : '';
    if (takenAt) {
      const problem = takenAtProblem(b.date, takenAt, now);
      if (problem) fail(400, problem);
    }
    const who = c.get('user').email;
    await c.env.DB.batch(
      meds.map((med) =>
        b.slot === 'prn'
          ? stmt(
              c.env.DB,
              `INSERT INTO dose_logs (medication_id, dose_date, slot, status, taken_at, logged_at, logged_by, note) VALUES (?, ?, 'prn', 'taken', ?, ?, ?, ?)`,
              med.id,
              b.date,
              takenAt,
              now,
              who,
              b.note,
            )
          : stmt(
              c.env.DB,
              `INSERT INTO dose_logs (medication_id, dose_date, slot, status, taken_at, logged_at, logged_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(medication_id, dose_date, slot) WHERE slot <> 'prn' DO UPDATE SET status = excluded.status, taken_at = excluded.taken_at,
                 logged_at = excluded.logged_at, logged_by = excluded.logged_by, note = excluded.note`,
              med.id,
              b.date,
              b.slot,
              b.status,
              takenAt,
              now,
              who,
              b.note,
            ),
      ),
    );
    return c.json({ ok: true });
  })
  // 取消打勾（整包取消送 medicationIds）
  .post('/clear', async (c) => {
    const b = await parseBody(c, z.object({ medicationId: zId.optional(), medicationIds: z.array(zId).max(40).optional(), date: zIsoDate, slot: zSlot }));
    const ids = doseIds(b);
    await run(
      c.env.DB,
      `DELETE FROM dose_logs WHERE dose_date = ? AND slot = ? AND medication_id IN (${ids.map(() => '?').join(',')})`,
      b.date,
      b.slot,
      ...ids,
    );
    return c.json({ ok: true });
  })
  // 改某一筆的吃藥時間（需要時吃的用這個；固定時段的也可以再送一次 POST /doses）
  .post('/:id/time', async (c) => {
    const id = parseId(c.req.param('id'));
    const { takenAt } = await parseBody(c, z.object({ takenAt: zDateTime }));
    const log = await first<{ dose_date: string; status: string }>(c.env.DB, 'SELECT dose_date, status FROM dose_logs WHERE id = ?', id);
    if (!log) return fail(404, '找不到這筆打勾');
    if (log.status !== 'taken') fail(400, '跳過的不用填吃藥時間');
    const now = taipeiNow();
    const problem = takenAtProblem(log.dose_date, takenAt, now);
    if (problem) fail(400, problem);
    await run(c.env.DB, 'UPDATE dose_logs SET taken_at = ?, logged_at = ?, logged_by = ? WHERE id = ?', takenAt, now, c.get('user').email, id);
    return c.json({ ok: true });
  })
  .post('/:id/delete', async (c) => {
    await run(c.env.DB, 'DELETE FROM dose_logs WHERE id = ?', parseId(c.req.param('id')));
    return c.json({ ok: true });
  });
