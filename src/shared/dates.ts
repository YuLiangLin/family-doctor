// 日期一律以 'YYYY-MM-DD'（西元、台北牆上日期）字串存放與比較；畫面才轉民國。
// 字串格式固定，所以可以直接用 < > 比大小。

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 加 n 個月；日期超過該月天數時取月底（1/31 + 1 個月 = 2/28）。 */
export function addMonthsClamped(iso: string, n: number): string {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`日期格式錯誤：${iso}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return toIso(y, mo, Math.min(Number(m[3]), daysInMonth(y, mo)));
}

/** 加 n 天（n 可為負）。 */
export function addDays(iso: string, n: number): string {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`日期格式錯誤：${iso}`);
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 台北今天（UTC+8，無日光節約）。伺服器與瀏覽器時區都不可靠，一律用這支。 */
export function taipeiToday(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 台北現在時間 'YYYY-MM-DD HH:mm:ss'，寫入 created_at 等欄位用。 */
export function taipeiNow(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())} ${pad2(t.getUTCHours())}:${pad2(
    t.getUTCMinutes(),
  )}:${pad2(t.getUTCSeconds())}`;
}

/** '2025-07-04' → '114/07/04' */
export function toRoc(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = ISO_RE.exec(iso.slice(0, 10));
  if (!m) return iso;
  return `${Number(m[1]) - 1911}/${m[2]}/${m[3]}`;
}

/** '114/7/4' 或 '114/07/04' → '2025-07-04'；格式不對回 null。 */
export function fromRoc(roc: string): string | null {
  const m = /^\s*(\d{2,3})\/(\d{1,2})\/(\d{1,2})\s*$/.exec(roc);
  if (!m) return null;
  const iso = toIso(Number(m[1]) + 1911, Number(m[2]), Number(m[3]));
  return isValidIsoDate(iso) ? iso : null;
}

/** 兩個日期相差天數（b - a）。 */
export function daysBetween(a: string, b: string): number {
  const pa = ISO_RE.exec(a);
  const pb = ISO_RE.exec(b);
  if (!pa || !pb) return 0;
  const ta = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const tb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((tb - ta) / 86400000);
}
