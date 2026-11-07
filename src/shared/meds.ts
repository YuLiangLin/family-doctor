// 用藥排程只有這一份：今天誰要吃什麼、療程第幾天、還剩幾包、吃藥提醒，前後端都呼叫這裡（同二胎「計息只有一份」）。
// 資料庫只存「醫生怎麼開」（medications），每天要吃什麼由這裡即時算。
// 打勾一包一包打：診所把同一次看診、同一個時段（同樣飯前／飯後）的藥包成一包，家人看到的「一包」就是那一包（packsOn）。
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

/** 實際的最後一天：提早停藥就是停藥前一天；長期吃、還沒停的是 null */
function effectiveLastDay(m: MedSchedule): string | null {
  return m.stoppedAt ? addDays(m.stoppedAt, -1) : lastDay(m);
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
  const end = effectiveLastDay(m);
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

// ---- 一包一包 ----

/** 打包要的欄位（API 的 Medication 也符合）：同一次看診、同樣飯前／飯後的藥，診所包在同一包 */
export interface PackSchedule extends MedSchedule {
  visitId: number | null;
  timing: Timing;
}

/** taken＝整包都記了（至少一種吃了）；skipped＝整包跳過；partial＝只勾了幾種 */
export type PackStatus = 'taken' | 'skipped' | 'partial' | null;

/** 一包藥：同一位家人、同一次看診（同一位醫生開的那份藥）、同一個時段、同樣飯前／飯後；自己買的藥一種一包 */
export interface DosePack {
  /** 哪一份藥（同一次看診＝同一份；自己買的一種一份）；療程、提醒都依這個分 */
  groupKey: string;
  /** 這一包：份＋時段＋飯前／飯後 */
  key: string;
  memberId: number;
  visitId: number | null;
  slot: Slot;
  /** 睡前不分飯前飯後，一律 any */
  timing: Timing;
  doses: DueDose[];
  status: PackStatus;
}

/** 哪一份藥：同一次看診開的是同一份；沒有看診（自己買的、長期藥）一種一份 */
export function groupKeyOf(m: PackSchedule): string {
  return m.visitId ? `${m.memberId}:v${m.visitId}` : `${m.memberId}:m${m.id}`;
}

export function packStatus(doses: { mark: DoseMark | null }[]): PackStatus {
  const marked = doses.filter((d) => d.mark);
  if (marked.length === 0) return null;
  if (marked.length < doses.length) return 'partial';
  return marked.some((d) => d.mark!.status === 'taken') ? 'taken' : 'skipped';
}

const TIMING_ORDER: Timing[] = ['before', 'with', 'after', 'any'];

/** 這天的每一包藥：依時段，同一個時段裡依份（藥先出現的先排）、飯前在飯後前面 */
export function packsOn(meds: PackSchedule[], marks: DoseMark[], date: string): DosePack[] {
  const byId = new Map(meds.map((m) => [m.id, m]));
  const packs = new Map<string, DosePack>();
  const groupOrder = new Map<string, number>();
  for (const d of dosesOn(meds, marks, date)) {
    const m = byId.get(d.medicationId)!;
    const timing: Timing = d.slot === 'bedtime' ? 'any' : m.timing;
    const groupKey = groupKeyOf(m);
    if (!groupOrder.has(groupKey)) groupOrder.set(groupKey, groupOrder.size);
    const key = `${groupKey}|${d.slot}|${timing}`;
    let p = packs.get(key);
    if (!p) packs.set(key, (p = { groupKey, key, memberId: m.memberId, visitId: m.visitId, slot: d.slot, timing, doses: [], status: null }));
    p.doses.push(d);
  }
  return [...packs.values()]
    .map((p) => ({ ...p, status: packStatus(p.doses) }))
    .sort(
      (a, b) =>
        SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) ||
        groupOrder.get(a.groupKey)! - groupOrder.get(b.groupKey)! ||
        TIMING_ORDER.indexOf(a.timing) - TIMING_ORDER.indexOf(b.timing),
    );
}

export interface PackCourse {
  groupKey: string;
  memberId: number;
  visitId: number | null;
  medicationIds: number[];
  startDate: string;
  /** 第幾天（從這份藥最早開始吃的那天算；還沒開始是 0） */
  dayNo: number;
  /** 總天數；有長期吃的是 null */
  totalDays: number | null;
  /** 整份藥共幾包（有長期吃的是 null） */
  totalPacks: number | null;
  /** 到今天為止應該吃幾包（今天還沒到的時段也算） */
  dueSoFar: number;
  /** 整包都記了的（只勾了幾種的不算） */
  taken: number;
  skipped: number;
  remaining: number | null;
  /** 過去（不含今天）沒打勾、或只勾了幾種的 */
  missedBeforeToday: number;
}

/** 療程一份一份算：同一次看診的藥合起來算第幾天、吃了幾包、還剩幾包；需要時吃的不算 */
export function packCourses(meds: PackSchedule[], marks: DoseMark[], today: string): PackCourse[] {
  const groups = new Map<string, PackSchedule[]>();
  for (const m of meds) {
    if (m.asNeeded || m.slots.length === 0) continue;
    const k = groupKeyOf(m);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const ids = new Set(meds.map((m) => m.id));
  const marksByDate = new Map<string, DoseMark[]>();
  for (const d of marks) {
    if (d.slot === 'prn' || !ids.has(d.medicationId)) continue;
    marksByDate.set(d.doseDate, [...(marksByDate.get(d.doseDate) ?? []), d]);
  }
  return [...groups].map(([groupKey, list]) => {
    const start = list.reduce((a, m) => (m.startDate < a ? m.startDate : a), list[0].startDate);
    const ends = list.map(effectiveLastDay);
    const end = ends.some((e) => e === null) ? null : (ends as string[]).reduce((a, e) => (e > a ? e : a));
    let total = 0;
    let dueSoFar = 0;
    let taken = 0;
    let skipped = 0;
    let missed = 0;
    const last = end ?? today;
    for (let d = start; d <= last; d = addDays(d, 1)) {
      for (const p of packsOn(list, marksByDate.get(d) ?? [], d)) {
        total += 1;
        if (d <= today) dueSoFar += 1;
        if (p.status === 'taken') taken += 1;
        else if (p.status === 'skipped') skipped += 1;
        else if (d < today) missed += 1;
      }
    }
    const totalPacks = end === null ? null : total;
    return {
      groupKey,
      memberId: list[0].memberId,
      visitId: list[0].visitId,
      medicationIds: list.map((m) => m.id),
      startDate: start,
      dayNo: today < start ? 0 : daysBetween(start, today) + 1,
      totalDays: end === null ? null : Math.max(0, daysBetween(start, end) + 1),
      totalPacks,
      dueSoFar,
      taken,
      skipped,
      remaining: totalPacks === null ? null : Math.max(0, totalPacks - taken - skipped),
      missedBeforeToday: missed,
    };
  });
}

/** 診所名稱拿掉括號裡的分店、地址：「蔡醫師診所（高雄市前鎮區）」→「蔡醫師診所」 */
export function shortClinic(clinic: string): string {
  return clinic.replace(/\s*[（(].*$/, '').trim() || clinic.trim();
}

/** 一包藥在提醒裡叫什麼：看診開的叫「診所的藥（幾種）」，自己買的叫藥名；同一份在同一個時段分飯前、飯後兩包時加上飯前／飯後 */
export function packLabel(pack: Pick<DosePack, 'visitId' | 'timing' | 'doses'>, clinic: string, medName: string, showTiming = false): string {
  if (!pack.visitId) return medName;
  const t = showTiming ? TIMING_LABEL[pack.timing] : '';
  return `${shortClinic(clinic) || '看診'}${t}的藥（${pack.doses.length} 種）`;
}

/** 實際吃藥時間合不合理（'YYYY-MM-DD HH:MM'）：不能晚於現在、要在那天（半夜才吃的可以到隔天早上 6 點）；沒問題回 null */
export function takenAtProblem(date: string, takenAt: string, now: string): string | null {
  if (takenAt.slice(0, 16) > now.slice(0, 16)) return '吃藥時間不能晚於現在';
  const day = takenAt.slice(0, 10);
  if (day === date || (day === addDays(date, 1) && takenAt.slice(11, 16) < '06:00')) return null;
  return `吃藥時間要在 ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} 當天`;
}

/** 某個時段的提醒內容（手機鎖定畫面看得到；全家自己用，寫名字與哪一包）；沒有要吃的回 null */
export function reminderText(
  slot: Slot,
  due: { memberName: string; label: string; done: boolean }[],
): { title: string; body: string } | null {
  const pending = due.filter((d) => !d.done);
  if (pending.length === 0) return null;
  const byMember = new Map<string, string[]>();
  for (const d of pending) byMember.set(d.memberName, [...(byMember.get(d.memberName) ?? []), d.label]);
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
