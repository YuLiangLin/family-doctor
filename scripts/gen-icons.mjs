// 產生網站圖示（手機主畫面、分頁、通知小圖示），輸出到 src/web/public。改了圖案才需要重跑：npm run icons
// 圖案同 src/web/components/ui.tsx 的 OtterFace（水獺頭＋額鏡），底色是藥袋的藍。
// 需要 Chromium：CHROMIUM_PATH，或 /opt/pw-browsers/chromium（雲端開發環境）。
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('../src/web/public/', import.meta.url);
const BLUE = '#1f5fbf';

const otter = `
  <circle cx="8.5" cy="17" r="3.2" fill="#6e4429"/>
  <circle cx="31.5" cy="17" r="3.2" fill="#6e4429"/>
  <ellipse cx="20" cy="21" rx="14" ry="12.5" fill="#8a5a3b"/>
  <ellipse cx="20" cy="26.5" rx="10" ry="6.5" fill="#f3e3cc"/>
  <circle cx="14.5" cy="19" r="2" fill="#1b1410"/>
  <circle cx="25.5" cy="19" r="2" fill="#1b1410"/>
  <circle cx="15.1" cy="18.4" r="0.6" fill="#fff"/>
  <circle cx="26.1" cy="18.4" r="0.6" fill="#fff"/>
  <ellipse cx="20" cy="23.5" rx="2.8" ry="1.8" fill="#2a1a12"/>
  <path d="M20 25.3v1.7M17.5 28c1.4 1 3.6 1 5 0" stroke="#2a1a12" stroke-width="1" fill="none" stroke-linecap="round"/>
  <path d="M12 25.5h-5M12 27l-4.5 1.2M28 25.5h5M28 27l4.5 1.2" stroke="#3a2a20" stroke-width="0.6" stroke-linecap="round"/>
  <circle cx="20" cy="10.5" r="3.4" fill="#e9eef5" stroke="#9aa9bd" stroke-width="1"/>
  <circle cx="20" cy="10.5" r="1.2" fill="#9aa9bd"/>`;

/** 藍底＋水獺；pad＝四周留白（maskable 要留比較多） */
const icon = (pad, radius) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${40 + pad * 2} ${40 + pad * 2}">` +
  `<rect x="${-pad}" y="${-pad}" width="${40 + pad * 2}" height="${40 + pad * 2}" rx="${radius}" fill="${BLUE}"/>${otter}</svg>`;

/** 通知小圖示（Android 只看透明度）：白色水獺頭剪影 */
const badge =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="#fff">` +
  `<circle cx="8.5" cy="17" r="3.2"/><circle cx="31.5" cy="17" r="3.2"/><ellipse cx="20" cy="21" rx="14" ry="12.5"/></g>` +
  `<g fill="#000"><circle cx="14.5" cy="19" r="2"/><circle cx="25.5" cy="19" r="2"/><ellipse cx="20" cy="23.5" rx="2.8" ry="1.8"/></g></svg>`;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  const dir = existsSync(base) && readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (dir) return `${base}/${dir}/chrome-linux64/chrome`;
  throw new Error('找不到 Chromium，請設 CHROMIUM_PATH');
}

const jobs = [
  ['icon-192.png', 192, icon(4, 10)],
  ['icon-512.png', 512, icon(4, 10)],
  ['icon-maskable-512.png', 512, icon(10, 0)],
  ['apple-touch-icon.png', 180, icon(5, 0)],
  ['favicon.png', 64, icon(2, 8)],
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
