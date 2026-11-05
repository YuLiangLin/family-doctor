// 藥品外觀資料（食藥署開放資料 data.fda.gov.tw export/42）：正規化、從藥袋藥名找候選、排序。
// 前端（挑照片）、Worker（/api/drugs）、同步腳本（scripts/sync-drug-catalog.ts）都用這一份。
// 這個檔不 import 別的檔：同步腳本用 node --experimental-strip-types 直接跑。

/** 食藥署原始一筆（只列用到的欄位） */
export interface FdaAppearanceRow {
  許可證字號?: string | null;
  中文品名?: string | null;
  英文品名?: string | null;
  形狀?: string | null;
  特殊劑型?: string | null;
  顏色?: string | null;
  特殊氣味?: string | null;
  刻痕?: string | null;
  外觀尺寸?: string | null;
  標註一?: string | null;
  標註二?: string | null;
  外觀圖檔連結?: string | null;
}

/** 資料庫 drug_catalog 的一列（同步腳本產生） */
export interface DrugCatalogRow {
  license_no: string;
  name_zh: string;
  name_en: string;
  shape: string;
  color: string;
  score_line: string;
  size_mm: string;
  marking: string;
  special: string;
  image_url: string;
  search_text: string;
}

/** 食藥署照片只接受這個網址開頭（runner 也會再檢查一次） */
export const FDA_IMAGE_PREFIX = 'https://mcp.fda.gov.tw/';

const UNITS: [RegExp, string][] = [
  [/毫克|公絲|MG\b/g, 'MG'],
  [/公克/g, 'G'],
  [/微克|MCG\b/g, 'MCG'],
  [/毫升|公撮/g, 'ML'],
];

/** 全形轉半形、大寫、單位統一（５００毫克 → 500MG）、引號括號換成空白 */
export function normalizeDrugText(raw: string | null | undefined): string {
  let s = (raw ?? '').normalize('NFKC').toUpperCase();
  for (const [re, to] of UNITS) s = s.replace(re, to);
  return s
    .replace(/["'“”‘’〝〞「」『』()［\][\]{}<>《》、，,;；:：/\\|]+/g, ' ')
    .replace(/(\d)\s+(MG|G|MCG|ML)\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 食藥署的「綠;;;黃」→「綠、黃」 */
export const joinParts = (raw: string | null | undefined) =>
  (raw ?? '')
    .split(';;;')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i)
    .join('、');

export function toCatalogRow(r: FdaAppearanceRow): DrugCatalogRow | null {
  const license = (r.許可證字號 ?? '').trim();
  if (!license) return null;
  const nameZh = (r.中文品名 ?? '').trim();
  const nameEn = (r.英文品名 ?? '').trim();
  const image = (r.外觀圖檔連結 ?? '').trim();
  return {
    license_no: license,
    name_zh: nameZh,
    name_en: nameEn,
    shape: joinParts(r.形狀),
    color: joinParts(r.顏色),
    score_line: joinParts(r.刻痕),
    size_mm: (r.外觀尺寸 ?? '').trim(),
    marking: [r.標註一, r.標註二].map((s) => (s ?? '').trim()).filter(Boolean).join(' / '),
    special: [joinParts(r.特殊劑型), joinParts(r.特殊氣味)].filter(Boolean).join('、'),
    image_url: image.startsWith(FDA_IMAGE_PREFIX) ? image : '',
    search_text: normalizeDrugText(`${nameEn} ${nameZh}`),
  };
}

// 藥名裡不能拿來比對的字（劑型、包裝、單位）
const STOP_WORDS = new Set([
  'MG', 'G', 'MCG', 'ML', 'TAB', 'TABS', 'TABLET', 'TABLETS', 'CAP', 'CAPS', 'CAPSULE', 'CAPSULES', 'FC', 'F.C', 'F.C.', 'FILM', 'COATED',
  'SUGAR', 'ENTERIC', 'SR', 'ER', 'XR', 'CR', 'ORAL', 'SOLUTION', 'SUSPENSION', 'SYRUP', 'POWDER', 'FOR', 'AND', 'THE', 'HCL', 'SODIUM',
  'INJ', 'INJECTION', 'CREAM', 'OINTMENT', 'GEL', 'DROPS', 'EYE', 'NASAL', 'SPRAY', 'CO', 'LTD', 'INC',
]);
const ZH_GENERIC = /膜衣錠|腸溶錠|糖衣錠|持續性藥效錠|緩釋錠|口溶錠|發泡錠|咀嚼錠|微粒膠囊|軟膠囊|膠囊劑|膠囊|錠劑|錠|口服液|懸液用粉劑|糖漿|液劑|液|乳膏|軟膏|藥膏|顆粒|散劑|粉劑|注射劑|鋁箔片裝|鋁箔|片裝/g;

export interface DrugTerms {
  /** 英文字（≥3 個字母）：藥名、成分 */
  words: string[];
  /** 中文片段（≥2 字）：去掉劑型字之後的品名、藥廠 */
  zh: string[];
  /** 劑量數字（500、0.6） */
  numbers: string[];
}

export function drugTerms(...texts: (string | null | undefined)[]): DrugTerms {
  const s = normalizeDrugText(texts.filter(Boolean).join(' '));
  const words = new Set<string>();
  const zh = new Set<string>();
  const numbers = new Set<string>();
  // CO-TRIMOXAZOLE 跟資料裡的 COTRIMOXAZOLE 要對得上：英文字先去掉連字號
  for (const m of s.replace(/(?<=[A-Z])-(?=[A-Z])/g, '').matchAll(/[A-Z]{3,}/g)) {
    if (!STOP_WORDS.has(m[0])) words.add(m[0]);
  }
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) numbers.add(m[0]);
  for (const m of s.replace(ZH_GENERIC, ' ').matchAll(/[一-鿿]{2,}/g)) zh.add(m[0]);
  return { words: [...words], zh: [...zh], numbers: [...numbers] };
}

// 顏色：長的先比（粉紅、藍綠 先於 粉、藍）
export const DRUG_COLORS = ['粉紅', '藍綠', '黃綠', '淺黃', '米白', '白', '黃', '橘', '粉', '紅', '藍', '綠', '棕', '咖啡', '灰', '紫', '黑', '透明', '米'];

export function colorsIn(text: string | null | undefined): string[] {
  let s = text ?? '';
  const found: string[] = [];
  for (const c of DRUG_COLORS) {
    if (s.includes(c)) {
      found.push(c);
      s = s.split(c).join(' ');
    }
  }
  return found;
}

const sameColor = (a: string, b: string) => a === b || a.includes(b) || b.includes(a) || (a === '咖啡' && b === '棕') || (a === '棕' && b === '咖啡');

/** 外觀描述裡的劑型：膠囊、錠（圓、橢圓…）、液、粉 */
function formOf(text: string): 'capsule' | 'tablet' | 'liquid' | 'powder' | '' {
  if (/膠囊/.test(text)) return 'capsule';
  if (/錠|圓形|橢圓|四邊|三角|六邊|八邊|水滴/.test(text)) return 'tablet';
  if (/液|糖漿|藥水/.test(text)) return 'liquid';
  if (/粉|顆粒|散/.test(text)) return 'powder';
  return '';
}

export interface DrugQuery {
  name: string;
  genericName?: string;
  /** 藥袋上的外觀描述（例：綠白膠囊、黃色圓形錠） */
  appearance?: string;
}

/** 這一款跟藥袋上的藥有多像（越高越像；0 以下＝不像）。藥袋上的藥名比成分重要，劑量對不上扣分。 */
export function scoreDrug(row: Pick<DrugCatalogRow, 'search_text' | 'color' | 'shape' | 'image_url'>, q: DrugQuery): number {
  const text = row.search_text;
  const joined = text.replace(/(?<=[A-Z])-(?=[A-Z])/g, '');
  // 英文要從字頭開始對（CETIRIZINE 不能對到 LEVOCETIRIZINE）；中文沒有字的邊界，片段有就算
  const has = (t: string) => (/^[A-Z]/.test(t) ? new RegExp(`(^|[^A-Z])${t}`).test(joined) : text.includes(t));
  const name = drugTerms(q.name);
  const generic = drugTerms(q.genericName);
  let score = 0;
  let hit = false;
  for (const t of [...name.words, ...name.zh]) {
    if (has(t)) {
      score += 6;
      hit = true;
    }
  }
  for (const t of [...generic.words, ...generic.zh]) {
    if (!name.words.includes(t) && !name.zh.includes(t) && has(t)) {
      score += 2;
      hit = true;
    }
  }
  if (!hit) return 0;
  const want = [...new Set([...name.numbers, ...generic.numbers])];
  if (want.length) {
    const doses = [...text.matchAll(/(\d+(?:\.\d+)?)(?:MG|G|MCG|ML)/g)].map((m) => m[1]);
    const any = want.some((n) => new RegExp(`(^|[^0-9.])${n.replace('.', '\\.')}([^0-9.]|$)`).test(text));
    if (any) score += 3;
    else if (doses.length) score -= 2;
  }
  const wantColors = colorsIn(q.appearance);
  if (wantColors.length) {
    const have = colorsIn(row.color);
    const hits = wantColors.filter((c) => have.some((h) => sameColor(c, h))).length;
    score += hits * 2;
    if (hits === 0 && have.length) score -= 3;
  }
  const wantForm = formOf(q.appearance ?? '');
  const haveForm = formOf(row.shape);
  if (wantForm && haveForm) score += wantForm === haveForm ? 2 : -3;
  if (row.image_url) score += 1;
  return score;
}

export function rankDrugs<T extends Pick<DrugCatalogRow, 'search_text' | 'color' | 'shape' | 'image_url'>>(rows: T[], q: DrugQuery, limit = 6): (T & { score: number })[] {
  return rows
    .map((r) => ({ ...r, score: scoreDrug(r, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 沒有照片時畫的藥丸顏色（食藥署的顏色名稱 → CSS） */
export const PILL_COLOR: Record<string, string> = {
  白: '#f4f3ef',
  米白: '#efe8d6',
  米: '#efe6cf',
  淺黃: '#f6e7a6',
  黃: '#f2cf4a',
  黃綠: '#b9d36a',
  橘: '#f29a3f',
  粉紅: '#f2a7ba',
  粉: '#f4bccb',
  紅: '#d8453b',
  藍綠: '#3fa9a6',
  藍: '#5d8fd8',
  綠: '#57ad73',
  棕: '#8b5a3c',
  咖啡: '#8b5a3c',
  灰: '#b8bcc3',
  紫: '#9a74c9',
  黑: '#2b2b2b',
  透明: 'rgba(220, 232, 240, 0.7)',
};

/** 藥袋寫的顏色跟這一款對不對得上（null＝藥袋沒寫顏色） */
export function colorAgreement(rowColor: string, appearance: string | null | undefined): 'match' | 'mismatch' | null {
  const want = colorsIn(appearance);
  if (!want.length) return null;
  const have = colorsIn(rowColor);
  if (!have.length) return null;
  return want.some((c) => have.some((h) => sameColor(c, h))) ? 'match' : 'mismatch';
}
