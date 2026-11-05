// 藥品照片（食藥署開放資料「藥品外觀」）：找候選、看資料、拿照片。
// 照片不讓家人的手機直接連食藥署：第一次有人要看時排進 drug_photos，家裡的 runner 下載、自動裁到藥丸、縮小後傳回來存 R2（routes/agent.ts）。
import { Hono } from 'hono';
import type { DrugCandidate } from '../../shared/apiTypes';
import { taipeiNow } from '../../shared/dates';
import { colorAgreement, drugTerms, rankDrugs, type DrugQuery } from '../../shared/drugs';
import { all, first, likeParam, run } from '../db';
import type { AppEnv } from '../env';
import { fail } from '../http';
import { toDrugInfo, type DrugCatalogDbRow } from '../mappers';

/** 照片一個月內不用再問（換照片的機會很少） */
const PHOTO_CACHE = 'private, max-age=2592000';
/** 失敗幾次就不再自動重試（食藥署換照片時會重來） */
const MAX_ATTEMPTS = 3;

export interface DrugPhotoRow {
  license_no: string;
  status: 'queued' | 'working' | 'done' | 'failed';
  source_url: string;
  r2_prefix: string;
  cropped: number;
  attempts: number;
  error: string;
  requested_at: string;
  updated_at: string;
}

export const loadDrug = (db: D1Database, license: string) => first<DrugCatalogDbRow>(db, 'SELECT * FROM drug_catalog WHERE license_no = ?', license);

/** 存用藥前檢查許可證字號都在資料裡 */
export async function requireDrugs(db: D1Database, licenses: (string | null | undefined)[]): Promise<void> {
  for (const l of new Set(licenses.filter((x): x is string => !!x))) {
    if (!(await loadDrug(db, l))) fail(400, `找不到這個藥品許可證字號：${l}（藥品資料可能還沒同步）`);
  }
}

/** 先用 LIKE 粗篩（任一個字對到），再用 shared/drugs.ts 排序 */
async function candidates(db: D1Database, q: DrugQuery, limit: number): Promise<DrugCandidate[]> {
  const t = drugTerms(q.name, q.genericName);
  const terms = [...t.words, ...t.zh].slice(0, 8);
  if (!terms.length) return [];
  const rows = await all<DrugCatalogDbRow>(
    db,
    `SELECT * FROM drug_catalog WHERE ${terms.map(() => `search_text LIKE ? ESCAPE '\\'`).join(' OR ')} LIMIT 400`,
    ...terms.map(likeParam),
  );
  return rankDrugs(rows, q, limit).map((r) => ({ ...toDrugInfo(r), score: r.score, colorAgreement: colorAgreement(r.color, q.appearance) }));
}

const text = (v: string | undefined, max = 120) => (v ?? '').trim().slice(0, max);

export const drugsRoutes = new Hono<AppEnv>()
  // 自己打字找：?q=CEPHALEXIN 500
  .get('/', async (c) => c.json(await candidates(c.env.DB, { name: text(c.req.query('q')) }, 20)))
  // 從藥袋上的藥名、成分、外觀找最像的幾款：?name=&generic=&appearance=
  .get('/match', async (c) =>
    c.json(
      await candidates(c.env.DB, { name: text(c.req.query('name')), genericName: text(c.req.query('generic')), appearance: text(c.req.query('appearance'), 60) }, 6),
    ),
  )
  .get('/:license', async (c) => {
    const row = await loadDrug(c.env.DB, c.req.param('license'));
    if (!row) return fail(404, '找不到這個藥');
    return c.json(toDrugInfo(row));
  })
  // 照片好了沒（畫面先問這個，好了才載入圖片；沒好就排進佇列給 runner 做）
  .get('/:license/photo/status', async (c) => c.json({ status: await ensurePhoto(c.env, c.req.param('license')) }))
  // 照片：?v=full 是整張（看大小、尺規），預設是裁到藥丸的小圖
  .get('/:license/photo', async (c) => {
    const license = c.req.param('license');
    const status = await ensurePhoto(c.env, license);
    if (status === 'done') {
      const p = (await first<DrugPhotoRow>(c.env.DB, 'SELECT * FROM drug_photos WHERE license_no = ?', license))!;
      const obj = await c.env.FILES.get(`${p.r2_prefix}/${c.req.query('v') === 'full' ? 'full' : 'crop'}.jpg`);
      if (obj) return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': PHOTO_CACHE } });
    }
    return c.json({ error: status === 'none' ? '食藥署沒有這個藥的照片' : status === 'failed' ? '這張照片處理不了' : '照片準備中', status }, 404);
  });

export type PhotoStatus = 'done' | 'queued' | 'failed' | 'none';

/** 照片狀態；還沒做（或食藥署換了照片、失敗次數還沒到）就排進佇列 */
async function ensurePhoto(env: AppEnv['Bindings'], license: string): Promise<PhotoStatus> {
  const db = env.DB;
  const row = await loadDrug(db, license);
  if (!row) return fail(404, '找不到這個藥');
  if (!row.image_url) return 'none';
  const p = await first<DrugPhotoRow>(db, 'SELECT * FROM drug_photos WHERE license_no = ?', license);
  if (p?.status === 'done' && p.source_url === row.image_url) return 'done';
  if (p?.status === 'queued' || p?.status === 'working') return 'queued';
  const now = taipeiNow();
  if (!p) {
    await run(db, `INSERT INTO drug_photos (license_no, status, requested_at, updated_at) VALUES (?, 'queued', ?, ?) ON CONFLICT(license_no) DO NOTHING`, license, now, now);
    return 'queued';
  }
  if (p.status === 'failed' && p.attempts >= MAX_ATTEMPTS && p.source_url === row.image_url) return 'failed';
  await run(db, `UPDATE drug_photos SET status = 'queued', requested_at = ?, updated_at = ? WHERE license_no = ?`, now, now, license);
  return 'queued';
}
