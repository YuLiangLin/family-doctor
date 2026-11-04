import { Hono } from 'hono';
import { z } from 'zod';
import { taipeiNow, taipeiToday } from '../../shared/dates';
import { isScheduledOn, SLOT_INFO } from '../../shared/meds';
import { first, run, stmt } from '../db';
import type { AppEnv } from '../env';
import { fail, medicationFields, parseBody, parseId, zId, zIsoDate, zRequiredText, zSlot, zText } from '../http';
import { toMedication, type MedicationRow } from '../mappers';
import { requireMember } from '../records';
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
  medicationId: zId,
  date: zIsoDate,
  slot: z.union([zSlot, z.literal('prn')]),
  status: z.enum(['taken', 'skipped']).default('taken'),
  note: zText(200).default(''),
});

/** 吃了沒：每一包按一下（再按一次取消）；需要時吃的（prn）每吃一次記一筆 */
export const dosesRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const b = await parseBody(c, doseSchema);
    const med = await requireMedication(c.env.DB, b.medicationId);
    if (b.date > taipeiToday()) fail(400, '還沒到的日子不能先打勾');
    if (b.slot === 'prn') {
      if (!med.asNeeded) fail(400, '這個藥不是「需要時才吃」');
    } else if (!isScheduledOn(med, b.date) || !med.slots.includes(b.slot)) {
      fail(400, `${b.date} ${SLOT_INFO[b.slot].label}沒有排這個藥`);
    }
    const now = taipeiNow();
    const who = c.get('user').email;
    if (b.slot === 'prn') {
      await run(
        c.env.DB,
        `INSERT INTO dose_logs (medication_id, dose_date, slot, status, logged_at, logged_by, note) VALUES (?, ?, 'prn', 'taken', ?, ?, ?)`,
        b.medicationId,
        b.date,
        now,
        who,
        b.note,
      );
    } else {
      await run(
        c.env.DB,
        `INSERT INTO dose_logs (medication_id, dose_date, slot, status, logged_at, logged_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(medication_id, dose_date, slot) WHERE slot <> 'prn' DO UPDATE SET status = excluded.status, logged_at = excluded.logged_at,
           logged_by = excluded.logged_by, note = excluded.note`,
        b.medicationId,
        b.date,
        b.slot,
        b.status,
        now,
        who,
        b.note,
      );
    }
    return c.json({ ok: true });
  })
  .post('/clear', async (c) => {
    const b = await parseBody(c, z.object({ medicationId: zId, date: zIsoDate, slot: zSlot }));
    await stmt(c.env.DB, 'DELETE FROM dose_logs WHERE medication_id = ? AND dose_date = ? AND slot = ?', b.medicationId, b.date, b.slot).run();
    return c.json({ ok: true });
  })
  .post('/:id/delete', async (c) => {
    await run(c.env.DB, 'DELETE FROM dose_logs WHERE id = ?', parseId(c.req.param('id')));
    return c.json({ ok: true });
  });
