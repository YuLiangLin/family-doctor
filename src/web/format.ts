import { addDays, taipeiNow, taipeiToday } from '../shared/dates';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** '2026-11-04' → '11/4（三）'；今天、昨天、明天直接說 */
export function dayLabel(iso: string, today = taipeiToday()): string {
  const short = `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  if (iso === today) return `今天 ${short}`;
  if (iso === addDays(today, -1)) return `昨天 ${short}`;
  if (iso === addDays(today, 1)) return `明天 ${short}`;
  const year = iso.slice(0, 4) !== today.slice(0, 4) ? `${iso.slice(0, 4)}/` : '';
  return `${year}${short}（${weekday(iso)}）`;
}

/** 'YYYY-MM-DD HH:MM(:SS)' → 'HH:MM' */
export const hhmm = (dt: string) => dt.slice(11, 16);

/** 現在（台北）'YYYY-MM-DD HH:MM'，表單預設值 */
export const nowMinute = () => taipeiNow().slice(0, 16);

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 'YYYY-MM-DD HH:MM' ↔ <input type="datetime-local"> 的 'YYYY-MM-DDTHH:MM' */
export const toLocalInput = (dt: string) => dt.replace(' ', 'T').slice(0, 16);
export const fromLocalInput = (v: string) => v.replace('T', ' ').slice(0, 16);
