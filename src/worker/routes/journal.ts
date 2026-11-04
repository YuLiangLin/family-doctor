// 身體狀況日記、量測（體溫、體重…）、今天頁、時間軸
import { Hono } from 'hono';
import { z } from 'zod';
import { MEASUREMENT_INFO, type MeasurementKind, type TimelineItem, type TodayResponse } from '../../shared/apiTypes';
import { addDays, taipeiNow, taipeiToday } from '../../shared/dates';
import { all, run, stmt } from '../db';
import type { AppEnv } from '../env';
import { fail, parseBody, parseId, zDateTime, zId, zRequiredText, zText } from '../http';
import { loadDoseLogs, loadMeasurements, loadMedications, loadMembers, loadNotes, loadVisits, requireMember, runnerState } from '../records';

const noteSchema = z.object({
  memberId: zId,
  notedAt: zDateTime,
  body: zRequiredText(2000),
  severity: z.number().int().min(0).max(3).default(0),
});

const KINDS = Object.keys(MEASUREMENT_INFO) as [MeasurementKind, ...MeasurementKind[]];

const measurementSchema = z.object({
  memberId: zId,
  kind: z.enum(KINDS),
  value: z.number(),
  value2: z.number().nullable().default(null),
  measuredAt: zDateTime,
  note: zText(200).default(''),
});

/** 量測值合不合理（太離譜通常是單位打錯：體溫 378、體重用克） */
export function checkMeasurement(kind: MeasurementKind, value: number, value2: number | null): string | null {
  const info = MEASUREMENT_INFO[kind];
  if (!Number.isFinite(value) || value < info.min || value > info.max) return `${info.label}要在 ${info.min}～${info.max} ${info.unit} 之間`;
  if (kind === 'blood_pressure') {
    if (value2 === null || !Number.isFinite(value2) || value2 < 20 || value2 >= value) return '血壓要填收縮壓／舒張壓（例：120／80）';
  } else if (value2 !== null) return `${info.label}只有一個數字`;
  return null;
}

export const notesRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const b = await parseBody(c, noteSchema);
    await requireMember(c.env.DB, b.memberId);
    const res = await stmt(
      c.env.DB,
      `INSERT INTO health_notes (member_id, noted_at, body, severity, source, created_at, created_by) VALUES (?, ?, ?, ?, 'manual', ?, ?)`,
      b.memberId,
      b.notedAt,
      b.body,
      b.severity,
      taipeiNow(),
      c.get('user').email,
    ).run();
    return c.json({ id: res.meta.last_row_id }, 201);
  })
  .post('/:id/void', async (c) => {
    const { reason } = await parseBody(c, z.object({ reason: zText(200).default('刪除') }));
    const n = await run(
      c.env.DB,
      'UPDATE health_notes SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL',
      taipeiNow(),
      c.get('user').email,
      reason || '刪除',
      parseId(c.req.param('id')),
    );
    if (!n) fail(404, '找不到這筆紀錄');
    return c.json({ ok: true });
  });

export const measurementsRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const b = await parseBody(c, measurementSchema);
    await requireMember(c.env.DB, b.memberId);
    const problem = checkMeasurement(b.kind, b.value, b.value2);
    if (problem) fail(400, problem);
    const res = await stmt(
      c.env.DB,
      `INSERT INTO measurements (member_id, kind, value, value2, measured_at, note, source, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
      b.memberId,
      b.kind,
      b.value,
      b.value2,
      b.measuredAt,
      b.note,
      taipeiNow(),
      c.get('user').email,
    ).run();
    return c.json({ id: res.meta.last_row_id }, 201);
  })
  .post('/:id/void', async (c) => {
    const n = await run(
      c.env.DB,
      `UPDATE measurements SET voided_at = ?, voided_by = ?, void_reason = '刪除' WHERE id = ? AND voided_at IS NULL`,
      taipeiNow(),
      c.get('user').email,
      parseId(c.req.param('id')),
    );
    if (!n) fail(404, '找不到這筆紀錄');
    return c.json({ ok: true });
  });

export const todayRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const date = taipeiToday();
  // 最近 60 天內開始、或還在吃的藥（今天頁也顯示「需要時才吃」的）
  const medications = (await loadMedications(c.env.DB, { activeOn: date })).filter((m) => m.startDate <= addDays(date, 1));
  const followUps = await all<{ id: number; member_id: number; follow_up_date: string; clinic: string }>(
    c.env.DB,
    `SELECT id, member_id, follow_up_date, clinic FROM visits WHERE voided_at IS NULL AND follow_up_date BETWEEN ? AND ? ORDER BY follow_up_date`,
    date,
    addDays(date, 14),
  );
  const res: TodayResponse = {
    date,
    members: await loadMembers(c.env.DB),
    medications,
    doseLogs: await loadDoseLogs(c.env.DB, medications.map((m) => m.id)),
    followUps: followUps.map((f) => ({ visitId: f.id, memberId: f.member_id, date: f.follow_up_date, clinic: f.clinic })),
    runner: await runnerState(c.env.DB),
  };
  return c.json(res);
});

/** 時間軸：看診、日記、量測依時間排（新的在上）；?memberId= 只看一位、?days= 看幾天（預設 90） */
export const timelineRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const memberId = c.req.query('memberId') ? parseId(c.req.query('memberId')) : undefined;
  const days = Math.min(3650, Math.max(1, Number(c.req.query('days') ?? 90) || 90));
  const since = addDays(taipeiToday(), -days);
  const [visits, notes, measurements] = await Promise.all([
    loadVisits(c.env.DB, { memberId, since, limit: 300 }),
    loadNotes(c.env.DB, { memberId, since, limit: 500 }),
    loadMeasurements(c.env.DB, { memberId, since, limit: 500 }),
  ]);
  const medCounts = new Map(
    (
      await all<{ visit_id: number; n: number }>(
        c.env.DB,
        `SELECT visit_id, COUNT(*) AS n FROM medications WHERE voided_at IS NULL AND visit_id IS NOT NULL GROUP BY visit_id`,
      )
    ).map((r) => [r.visit_id, r.n]),
  );
  const items: TimelineItem[] = [
    ...visits.map((v): TimelineItem => ({ type: 'visit', at: `${v.visitDate} 00:00`, memberId: v.memberId, visit: v, medCount: medCounts.get(v.id) ?? 0 })),
    ...notes.map((n): TimelineItem => ({ type: 'note', at: n.notedAt, memberId: n.memberId, note: n })),
    ...measurements.map((m): TimelineItem => ({ type: 'measurement', at: m.measuredAt, memberId: m.memberId, measurement: m })),
  ];
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return c.json(items);
});
