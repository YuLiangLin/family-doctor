// 產生網站圖示（手機主畫面、分頁、通知小圖示），輸出到 src/web/public。改了圖案才需要重跑：npm run icons
// 圖案：海獺 Dr.Claude 浮在水上、穿小白袍、戴額鏡、雙手捧臉頰；臉同 src/web/components/ui.tsx 的 OtterFace。底色是藥袋的藍。
// 需要 Chromium：CHROMIUM_PATH，或 /opt/pw-browsers/chromium（雲端開發環境）。
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('../src/web/public/', import.meta.url);

// viewBox 0 0 100 100
const otter = `
 <defs>
  <radialGradient id="hd" cx="50%" cy="36%" r="64%"><stop offset="0" stop-color="#f8f4ec"/><stop offset="1" stop-color="#d6c7b2"/></radialGradient>
  <linearGradient id="ch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bca386"/><stop offset="1" stop-color="#432f25"/></linearGradient>
 </defs>
 <ellipse cx="50" cy="90" rx="44" ry="9" fill="#7fbde8" opacity=".35"/>
 <ellipse cx="50" cy="90" rx="32" ry="6.2" fill="none" stroke="#e6f3ff" stroke-width="1.4" opacity=".7"/>
 <path d="M26 90c-1.2-14 1.6-26 8.4-33h31.2c6.8 7 9.6 19 8.4 33z" fill="#f3f5f8"/>
 <path d="M40 62l10 22 10-22z" fill="url(#ch)"/>
 <path d="M36 64c2.5 8.5 8 14 14 15.5 6-1.5 11.5-7 14-15.5" stroke="#3a86ff" stroke-width="2.6" fill="none" stroke-linecap="round"/>
 <circle cx="50" cy="80.8" r="3.6" fill="#eef2f6" stroke="#b8c2cd" stroke-width=".8"/>
 <ellipse cx="50" cy="90" rx="24.5" ry="4.2" fill="#3f86cf"/>
 <path d="M24 74c-2-4-1.6-8 .6-10.6l7.4 3.2c-.8 3-.4 6 1 8.6z" fill="#f3f5f8"/>
 <path d="M76 74c2-4 1.6-8-.6-10.6l-7.4 3.2c.8 3 .4 6-1 8.6z" fill="#f3f5f8"/>
 <circle cx="21.5" cy="34" r="4.6" fill="#8a735e"/><circle cx="78.5" cy="34" r="4.6" fill="#8a735e"/>
 <path d="M50 18c18 0 31 10.5 31 26 0 10-5 17.5-12.6 21.8C63.4 68.6 57 70 50 70s-13.4-1.4-18.4-4.2C24 61.5 19 54 19 44c0-15.5 13-26 31-26z" fill="url(#hd)"/>
 <path d="M19.6 37.5C26.5 29.5 37.4 25.5 50 25.5s23.5 4 30.4 12" stroke="#3b4a5e" stroke-width="1.8" fill="none" stroke-linecap="round"/>
 <circle cx="64" cy="25.5" r="7" fill="#eef3f8" stroke="#9aa9bd" stroke-width="1.6"/><circle cx="64" cy="25.5" r="2" fill="#3b4a5e"/>
 <ellipse cx="44.4" cy="57.4" rx="6.6" ry="5.2" fill="#faf6ef"/><ellipse cx="55.6" cy="57.4" rx="6.6" ry="5.2" fill="#faf6ef"/>
 <path d="M40 60c2.4 2.5 6.6 2.7 10 .4 3.4 2.3 7.6 2.1 10-.4" stroke="#b09a86" stroke-width="1.1" fill="none" stroke-linecap="round"/>
 <circle cx="39" cy="44.5" r="3.6" fill="#120d0b"/><circle cx="61" cy="44.5" r="3.6" fill="#120d0b"/>
 <circle cx="40.1" cy="43.2" r="1.2" fill="#fff"/><circle cx="62.1" cy="43.2" r="1.2" fill="#fff"/>
 <path d="M42 50.2c0-2.5 3.6-3.8 8-3.8s8 1.3 8 3.8c0 3.1-4.4 6.6-8 6.6s-8-3.5-8-6.6z" fill="#1b1411"/>
 <ellipse cx="46.6" cy="48.6" rx="2" ry=".9" fill="#fff" opacity=".55"/>
 <g stroke="#ffffff" stroke-width="1" stroke-linecap="round" opacity=".95">
  <path d="M37 56.5c-6-2-12-2.8-19-2.4M37 58.8c-6-1-12.5-1-19.5.4M37.5 61c-5.5-.2-11 .4-17 2"/>
  <path d="M63 56.5c6-2 12-2.8 19-2.4M63 58.8c6-1 12.5-1 19.5.4M62.5 61c5.5-.2 11 .4 17 2"/>
 </g>
 <ellipse cx="28.5" cy="66" rx="5.8" ry="7" fill="#2e211a" transform="rotate(-20 28.5 66)"/>
 <ellipse cx="71.5" cy="66" rx="5.8" ry="7" fill="#2e211a" transform="rotate(20 71.5 66)"/>`;

/** 藍底＋海獺；scale＜1＝四周留白（maskable 要留比較多）、rx＝圓角 */
const icon = (scale, rx) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b72d9"/><stop offset="1" stop-color="#1a52a8"/></linearGradient></defs>` +
  `<rect width="100" height="100" rx="${rx}" fill="url(#bg)"/>` +
  `<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${otter}</g></svg>`;

/** 通知小圖示（Android 只看透明度）：白色海獺頭剪影＋額鏡 */
const badge =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="#fff">` +
  `<circle cx="7" cy="15.2" r="2.5"/><circle cx="33" cy="15.2" r="2.5"/>` +
  `<path d="M20 6.2c8.8 0 15.4 5 15.4 12.7 0 5-2.5 8.6-6.2 10.8-2.7 1.6-5.8 2.4-9.2 2.4s-6.5-.8-9.2-2.4C7.1 27.5 4.6 23.9 4.6 18.9 4.6 11.2 11.2 6.2 20 6.2z"/>` +
  `<circle cx="26.2" cy="7.6" r="4"/></g></svg>`;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  const dir = existsSync(base) && readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (dir) return `${base}/${dir}/chrome-linux64/chrome`;
  throw new Error('找不到 Chromium，請設 CHROMIUM_PATH');
}

const jobs = [
  ['icon-192.png', 192, icon(1, 22)],
  ['icon-512.png', 512, icon(1, 22)],
  ['icon-maskable-512.png', 512, icon(0.8, 0)],
  ['apple-touch-icon.png', 180, icon(1, 0)],
  ['favicon.png', 64, icon(1, 22)],
  ['badge-96.png', 96, badge],
];

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();
for (const [name, size, svg] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(name, OUT).pathname, omitBackground: true });
  console.log('✓', name);
}
await browser.close();
