// 冒煙測試：本機 wrangler dev（DEV_AUTH_EMAIL）＋ Chromium，用手機寬度走一遍主要畫面並截圖到 e2e-shots/。
// 用法：npm run build && bash scripts/e2e.sh（會自己起 wrangler dev、建假資料）
// 假資料：全部是測試用的名字與藥，不是真的病歷。
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8787';
const SHOTS = new URL('../e2e-shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  const dir = existsSync(base) && readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (dir) return `${base}/${dir}/chrome-linux64/chrome`;
  throw new Error('找不到 Chromium，請設 CHROMIUM_PATH');
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', q], { stdio: 'pipe' });

// ---- 假資料 ----
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
await api('GET', '/me');
const dad = (await api('POST', '/members', { name: '爸爸', relation: '本人', birthDate: '1985-03-27', sex: 'M', emoji: '👨', color: '#1f5fbf', conditions: '幾年前肺炎住院過' })).id;
await api('POST', '/members', { name: '媽媽', relation: '太太', emoji: '👩', color: '#c0507a', sortOrder: 1 });
const kid = (await api('POST', '/members', { name: '小米', relation: '女兒', birthDate: '2021-06-10', sex: 'F', emoji: '👧', color: '#2f8a63', allergies: '無', sortOrder: 2 })).id;
await api('POST', '/members', { name: '小麥', relation: '女兒', birthDate: '2021-06-10', sex: 'F', emoji: '🌷', color: '#b97d0c', allergies: '無', sortOrder: 3 });
await api('PATCH', '/users/me', { memberId: dad, name: '爸爸' });
const visit = await api('POST', '/visits', {
  memberId: dad,
  visitDate: yesterday,
  clinic: '測試診所',
  department: '家醫科',
  reason: '黃鼻涕、鼻塞',
  diagnosis: '急性鼻竇炎',
  advice: '多喝水，三天沒改善回診',
  copay: 200,
  medications: [
    { name: 'CEPHALEXIN 500MG', genericName: 'Cephalexin', category: '抗生素', purpose: '殺細菌', appearance: '綠白膠囊', slots: ['morning', 'noon', 'evening'], days: 3, mustFinish: true },
    { name: 'SUBILIN 30MG', genericName: 'Pseudoephedrine', category: '鼻塞藥', slots: ['morning', 'noon', 'evening'], days: 3, cautions: '可能心悸、睡不好' },
    { name: 'FEXODINE 60MG', genericName: 'Fexofenadine', category: '抗過敏', slots: ['morning', 'evening'], days: 3, cautions: '避免與果汁併服' },
  ],
});
await api('POST', '/medications', { memberId: kid, startDate: today, name: '退燒藥水', category: '退燒止痛', dose: '依藥袋', asNeeded: true });
const meds = (await api('GET', `/visits/${visit.id}`)).medications;
await api('POST', '/doses', { medicationId: meds[0].id, date: yesterday, slot: 'noon' });
await api('POST', '/doses', { medicationId: meds[0].id, date: today, slot: 'morning' });
await api('POST', '/doses', { medicationId: meds[2].id, date: today, slot: 'morning' });
await api('POST', '/notes', { memberId: dad, notedAt: `${yesterday} 21:30`, body: '下班手腳冰冷，九點半就睡了', severity: 2 });
await api('POST', '/notes', { memberId: dad, notedAt: `${today} 13:18`, body: '好一點；擤出黃灰色鼻涕，左邊有一點血，中午又昏睡，有點頭昏', severity: 2 });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.2, measuredAt: `${yesterday} 20:00` });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.8, measuredAt: `${yesterday} 23:00` });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.4, measuredAt: `${today} 08:00` });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.6, measuredAt: `${today} 13:20` });
// 對話：問一題，假裝 runner 回了（直接寫資料庫）
const conv = await api('POST', '/chat/conversations', { memberId: dad });
await api('POST', `/chat/conversations/${conv.id}/messages`, { body: '尿尿的時候會火熱，要緊嗎？' });
const reply = '尿尿灼熱有可能只是水喝太少、尿比較濃，但也可能是泌尿道感染。\\n\\n建議：\\n- 今天多喝溫開水，觀察顏色\\n- 明天回診時跟醫生說，順便驗個尿\\n- 如果發燒超過 38.5 度、腰側痛或尿有血，直接去急診\\n\\n我幫你記下來了。';
const actions = JSON.stringify([{ type: 'note', id: 0, memberId: dad, summary: '尿尿時灼熱' }]).replace(/'/g, "''");
sql(
  `UPDATE ai_jobs SET status='done', finished_at=datetime('now') WHERE conversation_id=${conv.id};` +
    `INSERT INTO chat_messages (conversation_id, role, body, actions, mood, created_at) VALUES (${conv.id}, 'assistant', replace('${reply}', '\\n', char(10)), '${actions}', 'concerned', '${today} 13:24:00');` +
    `INSERT INTO app_state (key, value, updated_at) VALUES ('runner_last_poll', '${today} 23:59:00', '${today} 23:59:00') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
);

// ---- 截圖 ----
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|ERR_TUNNEL_CONNECTION_FAILED/.test(m.text()) && errors.push(`${scheme} ${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${scheme} ${page.url()}: ${e.message}`));
  const shot = async (path, name, wait = 600) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${SHOTS}${scheme}-${name}.png`, fullPage: name !== 'doctor' });
    console.log('✓', scheme, name);
  };
  await shot('/', 'today');
  if (scheme === 'light') {
    // 打勾：中午那包抗生素
    const tick = page.getByRole('button', { name: /CEPHALEXIN 500MG 中午按一下記已吃/ });
    if (await tick.count()) {
      await tick.click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${SHOTS}${scheme}-today-ticked.png` });
    }
  }
  await shot('/log', 'log');
  await shot(`/family/${dad}`, 'member');
  await shot(`/visits/${visit.id}`, 'visit');
  await shot('/visits/new', 'visit-new');
  await shot(`/doctor/${conv.id}`, 'doctor', 2500);
  await shot('/doctor', 'doctor-new', 2500);
  await shot('/settings', 'settings');
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error('畫面有錯誤：\n' + errors.join('\n'));
  process.exit(1);
}
console.log('全部正常，截圖在 e2e-shots/');
