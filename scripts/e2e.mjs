// 冒煙測試：本機 wrangler dev（DEV_AUTH_EMAIL）＋ Chromium，用手機寬度走一遍主要畫面並截圖到 e2e-shots/。
// 用法：npm run build && bash scripts/e2e.sh（會自己起 wrangler dev、建假資料）
// 假資料：全部是測試用的名字與藥，不是真的病歷。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function api(method, path, body, retry = true) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // 中間停太久（下載藥品照片）：閒置的連線被伺服器關掉，重連一次
    if (retry) return api(method, path, body, false);
    throw e;
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', q], { stdio: 'pipe' });
const sqlJson = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', q], { stdio: 'pipe' }).toString())[0].results;

/** 藥品照片：用 runner 的程式（下載食藥署原圖、自動裁切）做好，直接放進本機的 R2（e2e 沒有 runner） */
function processDrugPhotos(licenses) {
  const dir = mkdtempSync(join(tmpdir(), 'fd-drug-'));
  for (const license of licenses) {
    const [row] = sqlJson(`SELECT image_url FROM drug_catalog WHERE license_no = '${license.replace(/'/g, "''")}'`);
    if (!row?.image_url) continue;
    const py = `import sys, json, base64; sys.path.insert(0, 'scripts/dr-claude-runner'); import runner
out = runner.make_drug_photo(runner.fetch_fda_image(sys.argv[1]))
open(sys.argv[2] + '/crop.jpg', 'wb').write(base64.b64decode(out['crop'])); open(sys.argv[2] + '/full.jpg', 'wb').write(base64.b64decode(out['full']))
print(json.dumps({'cropped': out['cropped']}))`;
    let cropped;
    try {
      cropped = JSON.parse(execFileSync('python3', ['-c', py, row.image_url, dir], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 }).toString()).cropped;
    } catch (e) {
      console.log('⚠️ 藥品照片做不出來（沒網路或沒裝 Pillow／numpy）：', license, String(e).slice(0, 120));
      continue;
    }
    const prefix = `drug-photos/${createHash('sha256').update(license).digest('hex').slice(0, 32)}`;
    for (const v of ['crop', 'full']) {
      execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `family-doctor-files/${prefix}/${v}.jpg`, '--file', join(dir, `${v}.jpg`), '--local', '--content-type', 'image/jpeg'], { stdio: 'pipe' });
    }
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    sql(
      `INSERT INTO drug_photos (license_no, status, source_url, r2_prefix, cropped, requested_at, updated_at) VALUES (${q(license)}, 'done', ${q(row.image_url)}, ${q(prefix)}, ${cropped ? 1 : 0}, datetime('now'), datetime('now'))
       ON CONFLICT(license_no) DO UPDATE SET status = 'done', source_url = excluded.source_url, r2_prefix = excluded.r2_prefix, cropped = excluded.cropped;`,
    );
    console.log('✓ 藥品照片', license, cropped ? '（裁好）' : '（整張）');
  }
}

// ---- 假資料 ----
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const inThreeDays = new Date(Date.now() + 8 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10);
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
  followUpDate: inThreeDays,
  copay: 200,
  medications: [
    { name: 'CEPHALEXIN 500MG', genericName: 'Cephalexin', category: '抗生素', purpose: '殺細菌', appearance: '綠白膠囊', slots: ['morning', 'noon', 'evening'], days: 3, mustFinish: true },
    { name: 'SUBILIN 30MG', genericName: 'Pseudoephedrine', category: '鼻塞藥', slots: ['morning', 'noon', 'evening'], days: 3, cautions: '可能心悸、睡不好' },
    { name: 'FEXODINE 60MG', genericName: 'Fexofenadine', category: '抗過敏', slots: ['morning', 'evening'], days: 3, cautions: '避免與果汁併服' },
  ],
});
await api('POST', '/medications', { memberId: kid, startDate: today, name: '退燒藥水', category: '退燒止痛', dose: '依藥袋', asNeeded: true });
const meds = (await api('GET', `/visits/${visit.id}`)).medications;
// 藥品照片：前兩種藥對到食藥署那一款（第三種留著顯示「加照片」）
const picked = [];
for (const m of meds.slice(0, 2)) {
  const c = await api('GET', `/drugs/match?${new URLSearchParams({ name: m.name, generic: m.genericName, appearance: m.appearance })}`);
  if (!c.length) continue;
  await api('POST', `/medications/${m.id}/drug`, { license: c[0].licenseNo });
  picked.push(c[0].licenseNo);
}
processDrugPhotos(picked);
await api('POST', '/doses', { medicationId: meds[0].id, date: yesterday, slot: 'noon' });
await api('POST', '/doses', { medicationId: meds[0].id, date: today, slot: 'morning' });
await api('POST', '/doses', { medicationId: meds[2].id, date: today, slot: 'morning' });
await api('POST', '/notes', { memberId: dad, notedAt: `${yesterday} 21:30`, body: '下班手腳冰冷，九點半就睡了', severity: 2 });
await api('POST', '/notes', { memberId: dad, notedAt: `${today} 13:18`, body: '好一點；擤出黃灰色鼻涕，左邊有一點血，中午又昏睡，有點頭昏', severity: 2 });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.2, measuredAt: `${yesterday} 20:00` });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.8, measuredAt: `${yesterday} 23:00` });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.4, measuredAt: `${today} 08:00` });
await api('POST', '/measurements', { memberId: dad, kind: 'temperature', value: 37.6, measuredAt: `${today} 13:20` });
// API token（給 Claude Code 等程式用）：用 token 記一筆，畫面上要標「經 API」
const tok = await api('POST', '/tokens', { name: 'Claude Code', scope: 'log', days: 90 });
const viaToken = await fetch(`${BASE}/api/notes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.token}` },
  body: JSON.stringify({ memberId: kid, notedAt: `${today} 09:10`, body: '早上咳了幾聲，精神不錯', severity: 1 }),
});
if (viaToken.status !== 201) throw new Error(`用 token 記錄失敗：${viaToken.status} ${await viaToken.text()}`);
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
const watch = (page, label) => {
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|ERR_TUNNEL_CONNECTION_FAILED/.test(m.text()) && errors.push(`${label} ${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${label} ${page.url()}: ${e.message}`));
};
const shooter = (page, prefix) => async (path, name, wait = 700) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${SHOTS}${prefix}-${name}.png`, fullPage: !name.startsWith('doctor') });
  console.log('✓', prefix, name);
};

for (const scheme of ['light', 'dark']) {
  // 手機（iPhone 寬度）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, `${scheme} 手機`);
  const shot = shooter(page, scheme);
  await shot('/', 'today');
  if (scheme === 'light') {
    // 打勾：中午那包抗生素
    const tick = page.getByRole('button', { name: /CEPHALEXIN 500MG 中午按一下記已吃/ });
    if (await tick.count()) {
      await tick.click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}${scheme}-today-ticked.png` });
    }
  }
  // 站內換頁（不重新載入）：換頁時 effect 的 cleanup 出錯會整頁變白，下面的整頁載入測不到
  for (const name of ['紀錄', 'Dr.Claude', '家人', '今天']) {
    await page.getByRole('link', { name, exact: true }).click();
    await page.waitForTimeout(300);
  }
  // 新增選單 → 量體溫面板
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}${scheme}-add-menu.png` });
  await page.getByRole('dialog').getByRole('button', { name: /量體溫/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}${scheme}-add-temperature.png` });
  await page.keyboard.press('Escape');
  await shot('/log', 'log');
  await shot('/family', 'family');
  await shot(`/family/${dad}`, 'member');
  // App 內的對話框（取代 prompt）：停藥要寫原因
  await page.getByRole('button', { name: '停藥' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}${scheme}-dialog.png` });
  await page.getByRole('button', { name: '取消' }).click();
  await shot(`/visits/${visit.id}`, 'visit');
  await shot('/visits/new', 'visit-new');
  if (scheme === 'light' && picked.length) {
    // 記看診：打藥名就列出候選照片
    await page.getByRole('button', { name: '加一種藥' }).click();
    await page.getByLabel('藥名（照藥袋）').fill('CEPHALEXIN 500MG');
    await page.waitForTimeout(2500);
    await page.getByText('是哪一款？').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}${scheme}-visit-drug-suggest.png` });
    // 今天頁：點藥品照片看大圖
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /看 CEPHALEXIN 500MG 的照片/ }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}${scheme}-drug-lightbox.png` });
    await page.keyboard.press('Escape');
  }
  await shot(`/doctor/${conv.id}`, 'doctor', 2500);
  await shot('/doctor', 'doctor-new', 2500);
  // 語音對話模式（只看畫面；headless 沒有麥克風）
  const voiceBtn = page.getByRole('button', { name: '語音對話' });
  if (await voiceBtn.count()) {
    await voiceBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}${scheme}-doctor-voice.png` });
    await voiceBtn.click(); // 關掉，免得下一頁也是語音模式
  }
  await shot('/settings', 'settings');
  if (scheme === 'light') {
    // 建一把 token：建立後只顯示一次
    await page.getByRole('button', { name: '建立', exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}${scheme}-token-new.png` });
    await page.getByRole('dialog').getByRole('button', { name: '建立', exact: true }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}${scheme}-token-created.png` });
    await page.getByRole('button', { name: '我存好了' }).click();
    // 從舊網址轉過來（?moved=1）：提醒搬家、按「知道了」之後不再出現（src/web/moved.ts）
    await page.goto(`${BASE}/?moved=1`, { waitUntil: 'networkidle' });
    const notice = page.getByText('家庭醫生搬到新網址了');
    await notice.waitFor();
    if (page.url().includes('moved=')) throw new Error('moved 參數沒有從網址拿掉');
    await page.screenshot({ path: `${SHOTS}${scheme}-moved.png` });
    await page.getByRole('button', { name: '知道了' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    if (await notice.count()) throw new Error('按了知道了，搬家提醒還在');
    console.log('✓', scheme, 'moved');
  }
  await ctx.close();

  // 電腦（筆電 1440×900）
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
  const dpage = await dctx.newPage();
  watch(dpage, `${scheme} 電腦`);
  const dshot = shooter(dpage, `${scheme}-desktop`);
  await dshot('/', 'today');
  await dshot('/log', 'log');
  await dshot('/family', 'family');
  await dshot(`/family/${dad}`, 'member');
  await dshot(`/visits/${visit.id}`, 'visit');
  await dshot('/visits/new', 'visit-new');
  await dshot(`/doctor/${conv.id}`, 'doctor', 2500);
  await dshot('/settings', 'settings');
  await dctx.close();
}
await browser.close();
if (errors.length) {
  console.error('畫面有錯誤：\n' + errors.join('\n'));
  process.exit(1);
}
console.log('全部正常，截圖在 e2e-shots/');
