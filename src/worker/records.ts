// 讀健康紀錄（今天頁、家人頁、時間軸、給 Dr.水獺 的工作內容共用）
import type { DoseLog, HealthNote, Measurement, Medication, Member, RunnerState, Visit } from '../shared/apiTypes';
import { addDays, taipeiNow } from '../shared/dates';
import { all, first } from './db';
import {
  toDoseLog,
  toHealthNote,
  toMeasurement,
  toMedication,
  toMember,
  toVisit,
  type DoseLogRow,
  type HealthNoteRow,
  type MeasurementRow,
  type MedicationRow,
  type MemberRow,
  type VisitRow,
} from './mappers';
import { fail } from './http';

export async function loadMembers(db: D1Database, includeInactive = false): Promise<Member[]> {
  const rows = await all<MemberRow>(
    db,
    `SELECT * FROM members ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order, id`,
  );
  return rows.map(toMember);
}

export async function requireMember(db: D1Database, id: number): Promise<Member> {
  const row = await first<MemberRow>(db, 'SELECT * FROM members WHERE id = ?', id);
  if (!row) return fail(404, '找不到這位家人');
  return toMember(row);
}

/** 用藥：沒作廢的；memberId 不給＝全家。sinceDate：只要最後一天在這天之後（或長期、還沒停）的 */
export async function loadMedications(db: D1Database, opts: { memberId?: number; activeOn?: string } = {}): Promise<Medication[]> {
  const where = ['voided_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.memberId) {
    where.push('member_id = ?');
    params.push(opts.memberId);
  }
  if (opts.activeOn) {
    // 粗篩（還沒停、而且最後一天沒過）；精確判斷在 shared/meds.ts
    where.push(`(stopped_at IS NULL OR stopped_at > ?)`);
    params.push(opts.activeOn);
    where.push(`(days IS NULL OR date(start_date, '+' || (days - 1) || ' days') >= ?)`);
    params.push(opts.activeOn);
  }
  const rows = await all<MedicationRow>(db, `SELECT * FROM medications WHERE ${where.join(' AND ')} ORDER BY start_date DESC, id`, ...params);
  return rows.map(toMedication);
}

export async function loadDoseLogs(db: D1Database, medicationIds: number[]): Promise<DoseLog[]> {
  if (medicationIds.length === 0) return [];
  const rows = await all<DoseLogRow>(
    db,
    `SELECT * FROM dose_logs WHERE medication_id IN (${medicationIds.map(() => '?').join(',')}) ORDER BY dose_date, id`,
    ...medicationIds,
  );
  return rows.map(toDoseLog);
}

export async function loadVisits(db: D1Database, opts: { memberId?: number; since?: string; limit?: number } = {}): Promise<Visit[]> {
  const where = ['voided_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.memberId) {
    where.push('member_id = ?');
    params.push(opts.memberId);
  }
  if (opts.since) {
    where.push('visit_date >= ?');
    params.push(opts.since);
  }
  const rows = await all<VisitRow>(
    db,
    `SELECT * FROM visits WHERE ${where.join(' AND ')} ORDER BY visit_date DESC, id DESC LIMIT ?`,
    ...params,
    opts.limit ?? 200,
  );
  return rows.map(toVisit);
}

/** 這幾次看診（今天頁、提醒要知道每一包是哪家診所開的）；作廢的不算 */
export async function loadVisitsByIds(db: D1Database, ids: (number | null)[]): Promise<Visit[]> {
  const list = [...new Set(ids.filter((id): id is number => !!id))];
  if (list.length === 0) return [];
  const rows = await all<VisitRow>(db, `SELECT * FROM visits WHERE voided_at IS NULL AND id IN (${list.map(() => '?').join(',')})`, ...list);
  return rows.map(toVisit);
}

export async function loadNotes(db: D1Database, opts: { memberId?: number; since?: string; limit?: number } = {}): Promise<HealthNote[]> {
  const where = ['voided_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.memberId) {
    where.push('member_id = ?');
    params.push(opts.memberId);
  }
  if (opts.since) {
    where.push('noted_at >= ?');
    params.push(opts.since);
  }
  const rows = await all<HealthNoteRow>(
    db,
    `SELECT * FROM health_notes WHERE ${where.join(' AND ')} ORDER BY noted_at DESC, id DESC LIMIT ?`,
    ...params,
    opts.limit ?? 200,
  );
  return rows.map(toHealthNote);
}

export async function loadMeasurements(
  db: D1Database,
  opts: { memberId?: number; since?: string; limit?: number } = {},
): Promise<Measurement[]> {
  const where = ['voided_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.memberId) {
    where.push('member_id = ?');
    params.push(opts.memberId);
  }
  if (opts.since) {
    where.push('measured_at >= ?');
    params.push(opts.since);
  }
  const rows = await all<MeasurementRow>(
    db,
    `SELECT * FROM measurements WHERE ${where.join(' AND ')} ORDER BY measured_at DESC, id DESC LIMIT ?`,
    ...params,
    opts.limit ?? 300,
  );
  return rows.map(toMeasurement);
}

/** runner 超過這麼久沒來領工作就算沒在跑（runner 長輪詢最多等 25 秒） */
export const RUNNER_STALE_SECONDS = 90;

export async function runnerState(db: D1Database, now = new Date()): Promise<RunnerState> {
  const row = await first<{ value: string }>(db, `SELECT value FROM app_state WHERE key = 'runner_last_poll'`);
  const last = row?.value ?? null;
  return { lastPollAt: last, online: !!last && last >= taipeiNow(new Date(now.getTime() - RUNNER_STALE_SECONDS * 1000)) };
}

/** 今天起往前 N 天的日期 */
export const daysAgo = (today: string, n: number) => addDays(today, -n);
