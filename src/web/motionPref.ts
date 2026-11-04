// 動畫偏好：預設一律打開（2026-10-16 Nathan：「預設動畫讓他開吧」，不看電腦的「減少動態效果」）。
// 在登入畫面按「動畫」關掉的話記在這台瀏覽器（localStorage `sms-motion` = off），寫在 <html data-motion="off">，
// CSS 的減少動態規則看它（login.css、styles.css）；index.html 在畫面出來前先套用。
const KEY = 'sms-motion';

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** 這台瀏覽器有沒有把動畫關掉 */
export function reducedMotion(): boolean {
  return stored() === 'off';
}

/** 打開（預設，不記）或關掉（記 off） */
export function setMotion(on: boolean): void {
  const root = document.documentElement;
  if (on) delete root.dataset.motion;
  else root.dataset.motion = 'off';
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // 無痕視窗等情況存不了，這次有效就好
  }
}
