import { Hono } from 'hono';
import { z } from 'zod';
import type { MemberDetail } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { run, stmt } from '../db';
import type { AppEnv } from '../env';
import { parseBody, parseId, requireAdmin, zIsoDate, zRequiredText, zText } from '../http';
import { loadDoseLogs, loadMeasurements, loadMedications, loadMembers, loadNotes, loadVisits, requireMember } from '../records';

const memberSchema = z.object({
  name: zRequiredText(30),
  relation: zText(20).default(''),
  birthDate: zIsoDate.nullable().default(null),
  sex: z.enum(['', 'M', 'F']).default(''),
  bloodType: zText(10).default(''),
  allergies: zText(500).default(''),
  conditions: zText(1000).default(''),
  note: zText(1000).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '顏色格式錯誤').default('#3f8f7a'),
  emoji: zText(8).default('🙂'),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/** 家人：全家帳號都能新增、修改（爸媽幫小朋友記）；停用只有管理者 */
export const membersRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await loadMembers(c.env.DB, c.req.query('all') === '1')))
  .get('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const member = await requireMember(c.env.DB, id);
    const medications = await loadMedications(c.env.DB, { memberId: id });
    const detail: MemberDetail = {
      member,
      medications,
      doseLogs: await loadDoseLogs(c.env.DB, medications.map((m) => m.id)),
      visits: await loadVisits(c.env.DB, { memberId: id }),
      notes: await loadNotes(c.env.DB, { memberId: id, limit: 100 }),
      measurements: await loadMeasurements(c.env.DB, { memberId: id, limit: 200 }),
    };
    return c.json(detail);
  })
  .post('/', async (c) => {
    const b = await parseBody(c, memberSchema);
    const now = taipeiNow();
    const who = c.get('user').email;
    const res = await stmt(
      c.env.DB,
      `INSERT INTO members (name, relation, birth_date, sex, blood_type, allergies, conditions, note, color, emoji, sort_order,
         created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      b.name,
      b.relation,
      b.birthDate,
      b.sex,
      b.bloodType,
      b.allergies,
      b.conditions,
      b.note,
      b.color,
      b.emoji,
      b.sortOrder,
      now,
      who,
      now,
      who,
    ).first<{ id: number }>();
    return c.json({ id: res!.id }, 201);
  })
  .put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    await requireMember(c.env.DB, id);
    const b = await parseBody(c, memberSchema);
    await run(
      c.env.DB,
      `UPDATE members SET name = ?, relation = ?, birth_date = ?, sex = ?, blood_type = ?, allergies = ?, conditions = ?, note = ?,
         color = ?, emoji = ?, sort_order = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      b.name,
      b.relation,
      b.birthDate,
      b.sex,
      b.bloodType,
      b.allergies,
      b.conditions,
      b.note,
      b.color,
      b.emoji,
      b.sortOrder,
      taipeiNow(),
      c.get('user').email,
      id,
    );
    return c.json({ ok: true });
  })
  .post('/:id/active', async (c) => {
    requireAdmin(c);
    const id = parseId(c.req.param('id'));
    await requireMember(c.env.DB, id);
    const { active } = await parseBody(c, z.object({ active: z.boolean() }));
    await run(c.env.DB, 'UPDATE members SET active = ?, updated_at = ?, updated_by = ? WHERE id = ?', active, taipeiNow(), c.get('user').email, id);
    return c.json({ ok: true });
  });
