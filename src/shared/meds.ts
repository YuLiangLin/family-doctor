// 用藥排程只有這一份：今天誰要吃什麼、療程第幾天、還剩幾包、吃藥提醒，前後端都呼叫這裡（同二胎「計息只有一份」）。
// 資料庫只存「醫生怎麼開」（medications），每天要吃什麼由這裡即時算。
import { addDays, daysBetween } from './dates';

export const SLOTS = ['morning', 'noon', 'evening', 'bedtime'] as const;
export type Slot = (typeof SLOTS)[number];

/** 每個時段的名稱與提醒時間（台北）；wrangler.toml 的 crons 要跟著改 */
export const SLOT_INFO: Record<Slot, { label: string; meal: string; time: string; emoji: string }> = {
  morning: { label: '早上', meal: '早餐', time: '08:00', emoji: '🌅' },
  noon: { label: '中午', meal: '午餐', time: '12:30', emoji: '☀️' },
  evening: { label: '晚上', meal: '晚餐', time: '18:30', emoji: '🌇' },
  bedtime: { label: '睡前', meal: '', time: '21:30', emoji: '🌙' },
};

export type Timing = 'before' | 'after' | 'with' | 'any';
export const TIMING_LABEL: Record<Timing, string> = { before: '飯前', after: '飯後', with: '隨餐', any: '' };

/** 一天幾次 → 預設時段（藥袋常見寫法：一天三次＝三餐飯後） */
export function slotsForTimes(times: number): Slot[] {
  if (times <= 1) return ['morning'];
  if (times === 2) return ['morning', 'evening'];
  if (times === 3) return ['morning', 'noon', 'evening'];
  return ['morning', 'noon', 'evening', 'bedtime'];
}

export function parseSlots(raw: string): Slot[] {
  const set = new Set(raw.split(',').map((s) => s.trim()));
  return SLOTS.filter((s) => set.has(s));
}

/** 「早晚飯後」「三餐飯前」「睡前」這種寫法 */
export function scheduleLabel(slots: Slot[], timing: Timing, asNeeded: boolean): string {
  if (asNeeded) return '需要時服用';
  if (slots.length === 0) return '';
  const meals = slots.filter((s) => s !== 'bedtime');
  const short: Record<Slot, string> = { morning: '早', noon: '午', evening: '晚', bedtime: '' };
  const t = TIMING_LABEL[timing];
  const parts: string[] = [];
  if (meals.length === 3) parts.push(t ? `三餐${t}` : '早午晚');
  else if (meals.length === 2) parts.push(`${meals.map((s) => short[s]).join('')}${t}`);
  else if (meals.length === 1) parts.push(t ? `${SLOT_INFO[meals[0]].meal}${t}` : SLOT_INFO[meals[0]].label);
  if (slots.includes('bedtime')) parts.push('睡前');
  return `一天 ${slots.length} 次・${parts.join('、')}`;
}

/** 排程需要的欄位（API 的 Medication 也符合） */
export interface MedSchedule {
  id: number;
  memberId: number;
  slots: Slot[];
  asNeeded: boolean;
  startDate: string;
  /** 吃幾天；null＝長期 */
  days: number | null;
  /** 提早停藥的日期（那天起不用吃） */
  stoppedAt: string | null;
}

export interface DoseMark {
  medicationId: number;
  doseDate: string;
  slot: string;
  status: 'taken' | 'skipped';
}

/** 最後一天（含）；長期吃的是 null */
export function lastDay(m: MedSchedule): string | null {
  return m.days ? addDays(m.startDate, m.days - 1) : null;
}

/** 這天要不要吃（需要時吃的永遠不排） */
export function isScheduledOn(m: MedSchedule, date: string): boolean {
  if (m.asNeeded || m.slots.length === 0) return false;
  if (date < m.startDate) return false;
  if (m.stoppedAt && date >= m.stoppedAt) return false;
  const end = lastDay(m);
  return end === null || date <= end;
}

/** 這個藥還在療程中嗎（需要時吃的：還沒停、而且還沒過天數就算） */
export function isActive(m: MedSchedule, date: string): boolean {
  if (date < m.startDate) return true; // 還沒開始也算進行中（例：明天開始吃）
  if (m.stoppedAt && date >= m.stoppedAt) return false;
  const end = lastDay(m);
  return end === null || date <= end;
}

export interface DueDose {
  medicationId: number;
  memberId: number;
  slot: Slot;
  mark: DoseMark | null;
}

/** 這天每一包藥（依時段排）＋有沒有打勾 */
export function dosesOn(meds: MedSchedule[], marks: DoseMark[], date: string): DueDose[] {
  const byKey = new Map(marks.filter((d) => d.doseDate === date).map((d) => [`${d.medicationId}|${d.slot}`, d]));
  const out: DueDose[] = [];
  for (const slot of SLOTS) {
    for (const m of meds) {
      if (!isScheduledOn(m, date) || !m.slots.includes(slot)) continue;
      out.push({ medicationId: m.id, memberId: m.memberId, slot, mark: byKey.get(`${m.id}|${slot}`) ?? null });
    }
  }
  return out;
}

export interface CourseProgress {
  /** 第幾天（從 1 算；還沒開始是 0） */
  dayNo: number;
  /** 總天數；長期是 null */
  totalDays: number | null;
  /** 到今天為止應該吃幾包、吃了幾包、跳過幾包（今天還沒到的時段也算進應該吃） */
  dueSoFar: number;
  taken: number;
  skipped: number;
  /** 整個療程共幾包（長期 null） */
  totalDoses: number | null;
  /** 還剩幾包要吃（長期 null） */
  remaining: number | null;
  /** 過去（不含今天）漏掉、沒打勾的 */
  missedBeforeToday: number;
}

export function courseProgress(m: MedSchedule, marks: DoseMark[], today: string): CourseProgress {
  const mine = marks.filter((d) => d.medicationId === m.id && d.slot !== 'prn');
  const end = m.stoppedAt ? addDays(m.stoppedAt, -1) : lastDay(m);
  const effectiveDays = end === null ? null : Math.max(0, daysBetween(m.startDate, end) + 1);
  const perDay = m.asNeeded ? 0 : m.slots.length;
  const dayNo = today < m.startDate ? 0 : daysBetween(m.startDate, today) + 1;
  const daysSoFar = effectiveDays === null ? dayNo : Math.min(dayNo, effectiveDays);
  const taken = mine.filter((d) => d.status === 'taken').length;
  const skipped = mine.filter((d) => d.status === 'skipped').length;
  const totalDoses = effectiveDays === null ? null : effectiveDays * perDay;
  const pastDays = Math.max(0, daysSoFar - (isScheduledOn(m, today) ? 1 : 0));
  const markedBefore = mine.filter((d) => d.doseDate < today).length;
  return {
    dayNo,
    totalDays: m.stoppedAt ? effectiveDays : m.days,
    dueSoFar: daysSoFar * perDay,
    taken,
    skipped,
    totalDoses,
    remaining: totalDoses === null ? null : Math.max(0, totalDoses - taken - skipped),
    missedBeforeToday: Math.max(0, pastDays * perDay - markedBefore),
  };
}

/** 某個時段的提醒內容（手機鎖定畫面看得到；全家自己用，寫名字與藥名）；沒有要吃的回 null */
export function reminderText(
  slot: Slot,
  due: { memberName: string; medName: string; done: boolean }[],
): { title: string; body: string } | null {
  const pending = due.filter((d) => !d.done);
  if (pending.length === 0) return null;
  const byMember = new Map<string, string[]>();
  for (const d of pending) byMember.set(d.memberName, [...(byMember.get(d.memberName) ?? []), d.medName]);
  const info = SLOT_INFO[slot];
  return {
    title: `${info.emoji} ${info.label}吃藥時間`,
    body: [...byMember].map(([who, meds]) => `${who}：${meds.join('、')}`).join('\n'),
  };
}

/** 依台北時間（HH:MM）找最接近、而且已經到了的時段；Cron 用 */
export function slotAt(hhmm: string): Slot | null {
  for (const s of SLOTS) {
    const t = SLOT_INFO[s].time;
    const [h, m] = t.split(':').map(Number);
    const [qh, qm] = hhmm.split(':').map(Number);
    const diff = qh * 60 + qm - (h * 60 + m);
    if (diff >= 0 && diff < 30) return s;
  }
  return null;
}
