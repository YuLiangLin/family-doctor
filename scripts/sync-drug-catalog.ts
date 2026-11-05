// 同步食藥署開放資料「藥品外觀」（data.fda.gov.tw export/42）到 D1 的 drug_catalog。
// 每週由 .github/workflows/drug-catalog.yml 跑（--remote）；本機開發、e2e 用 --local。
//
// 用法：
//   node --experimental-strip-types scripts/sync-drug-catalog.ts --local
//   node --experimental-strip-types scripts/sync-drug-catalog.ts --remote
//   node --experimental-strip-types scripts/sync-drug-catalog.ts --sql-only out.sql [--from 下載好的.zip]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { toCatalogRow, type DrugCatalogRow, type FdaAppearanceRow } from '../src/shared/drugs.ts';

export const SOURCE_URL = 'https://data.fda.gov.tw/data/opendata/export/42/json';
/** 少於這麼多筆多半是下載出問題：寧可不更新，也不要把資料表清掉 */
const MIN_ROWS = 1000;

/** zip 裡的第一個檔（食藥署的 export 是只裝一個 json 的 zip） */
export function unzipFirst(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('下載的不是 zip 檔');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('zip 目錄壞了');
  const method = buf.readUInt16LE(cd + 10);
  const compressedSize = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip 檔頭壞了');
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + compressedSize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`不支援的壓縮方式（${method}）`);
}

export function parseSource(buf: Buffer): FdaAppearanceRow[] {
  const zipped = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  const text = (zipped ? unzipFirst(buf) : buf).toString('utf8').replace(/^﻿/, '');
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('資料格式不對（不是陣列）');
  return data as FdaAppearanceRow[];
}

const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;
const COLS: (keyof DrugCatalogRow)[] = ['license_no', 'name_zh', 'name_en', 'shape', 'color', 'score_line', 'size_mm', 'marking', 'special', 'image_url', 'search_text'];

/** 新增或更新每一筆、刪掉這次沒有的（下架）、記下同步時間 */
export function buildSql(rows: DrugCatalogRow[], syncedAt: string): string {
  const lines = rows.map(
    (r) =>
      `INSERT INTO drug_catalog (${COLS.join(', ')}, synced_at) VALUES (${COLS.map((c) => sqlText(r[c])).join(', ')}, ${sqlText(syncedAt)}) ` +
      `ON CONFLICT(license_no) DO UPDATE SET ${COLS.slice(1)
        .map((c) => `${c} = excluded.${c}`)
        .join(', ')}, synced_at = excluded.synced_at;`,
  );
  lines.push(`DELETE FROM drug_catalog WHERE synced_at <> ${sqlText(syncedAt)};`);
  lines.push(
    `INSERT INTO app_state (key, value, updated_at) VALUES ('drug_catalog_synced', ${sqlText(String(rows.length))}, ${sqlText(syncedAt)}) ` +
      `ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  );
  return `${lines.join('\n')}\n`;
}

export function toRows(raw: FdaAppearanceRow[]): DrugCatalogRow[] {
  const seen = new Set<string>();
  const rows: DrugCatalogRow[] = [];
  for (const r of raw) {
    const row = toCatalogRow(r);
    if (!row || seen.has(row.license_no)) continue;
    seen.add(row.license_no);
    rows.push(row);
  }
  return rows;
}

const taipeiNow = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

async function download(): Promise<Buffer> {
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'family-doctor-sync/1.0' } });
  if (!res.ok) throw new Error(`下載失敗：${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const target = argv.includes('--remote') ? '--remote' : argv.includes('--local') ? '--local' : null;
  const sqlOnly = arg('--sql-only');
  if (!target && !sqlOnly) throw new Error('要指定 --local、--remote 或 --sql-only <檔案>');
  const from = arg('--from');
  const raw = parseSource(from ? readFileSync(from) : await download());
  const rows = toRows(raw);
  if (!from && rows.length < MIN_ROWS) throw new Error(`只拿到 ${rows.length} 筆，看起來不對，這次不更新`);
  const sql = buildSql(rows, taipeiNow());
  if (sqlOnly) {
    writeFileSync(sqlOnly, sql);
    console.log(`✓ ${rows.length} 筆（${rows.filter((r) => r.image_url).length} 筆有照片）→ ${sqlOnly}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'drug-catalog-'));
  try {
    const file = join(dir, 'drug-catalog.sql');
    writeFileSync(file, sql);
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', target!, '--file', file, '-y'], { stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`✓ 藥品外觀同步完成：${rows.length} 筆（${rows.filter((r) => r.image_url).length} 筆有照片）`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
