import { describe, expect, it } from 'vitest';
import { buildSql, toRows, unzipFirst } from '../scripts/sync-drug-catalog.ts';
import { colorAgreement, colorsIn, drugTerms, normalizeDrugText, rankDrugs, toCatalogRow } from '../src/shared/drugs';
import { deflateRawSync } from 'node:zlib';

const row = (license: string, zh: string, en: string, shape: string, color: string, image = 'https://mcp.fda.gov.tw/x') =>
  toCatalogRow({ 許可證字號: license, 中文品名: zh, 英文品名: en, 形狀: shape, 顏色: color, 外觀圖檔連結: image })!;

describe('藥品外觀', () => {
  it('全形、公絲、毫克都統一', () => {
    expect(normalizeDrugText('"優良"優力黴素膠囊５００毫克（賜福力欣）')).toBe('優良 優力黴素膠囊500MG 賜福力欣');
    expect(normalizeDrugText('美德錠5公絲')).toBe('美德錠5MG');
    expect(normalizeDrugText('Cephalexin 500 mg')).toBe('CEPHALEXIN 500MG');
  });

  it('藥名拆成能比對的字：去掉劑型與單位、連字號接起來', () => {
    expect(drugTerms('Co-trimoxazole')).toEqual({ words: ['COTRIMOXAZOLE'], zh: [], numbers: [] });
    expect(drugTerms('普拿疼 Panadol Tablets 500mg')).toEqual({ words: ['PANADOL'], zh: ['普拿疼'], numbers: ['500'] });
    expect(drugTerms('安舒疼膜衣錠（生達）').zh).toEqual(['安舒疼', '生達']);
  });

  it('顏色', () => {
    expect(colorsIn('粉紅白相間膠囊')).toEqual(['粉紅', '白']);
    expect(colorAgreement('綠、白', '綠白膠囊')).toBe('match');
    expect(colorAgreement('橘、透明', '紅白膠囊')).toBe('mismatch');
    expect(colorAgreement('橘', '')).toBeNull();
  });

  it('食藥署原始資料轉成一列：多個顏色用、、只收食藥署的照片網址', () => {
    const r = toCatalogRow({ 許可證字號: 'A', 中文品名: '甲', 英文品名: 'X', 顏色: '綠;;;黃', 標註一: 'TBC', 標註二: '500', 外觀圖檔連結: 'https://evil.example.com/a.png' })!;
    expect(r.color).toBe('綠、黃');
    expect(r.marking).toBe('TBC / 500');
    expect(r.image_url).toBe('');
    expect(toCatalogRow({ 中文品名: '沒字號' })).toBeNull();
  });

  it('藥名比成分重要：Cetirizine 不會對到 Levocetirizine；劑量對不上排後面', () => {
    const rows = [
      row('1', '驅異樂膜衣錠5毫克', 'XYZAL F.C. TABLETS 5MG (LEVOCETIRIZINE)', '橢圓形', '白'),
      row('2', '驅異樂錠10毫克', 'ZYRTEC TABLETS 10MG (CETIRIZINE)', '長橢圓形', '白'),
      row('3', '"國嘉"舒鼻寧錠30毫克', 'Subilin Tablets 30mg "Kojar"', '圓形', '橘'),
      row('4', '舒鼻寧錠６０毫克（鹽酸假麻黃素）', 'SUBILIN TABLETS 60MG "KOJAR" (PSEUDOEPHEDRINE)', '圓形', '黃'),
    ];
    expect(rankDrugs(rows, { name: 'Cetirizine 10mg' }).map((r) => r.license_no)).toEqual(['2']);
    expect(rankDrugs(rows, { name: 'Subilin', genericName: 'Pseudoephedrine 30mg' }).map((r) => r.license_no)).toEqual(['3', '4']);
    expect(rankDrugs(rows, { name: '藥膏' })).toEqual([]);
  });

  it('同步：zip 解得開、SQL 會刪掉這次沒有的', () => {
    const json = Buffer.from(JSON.stringify([{ 許可證字號: "O'K", 中文品名: '甲', 英文品名: 'X' }]));
    const data = deflateRawSync(json);
    const name = Buffer.from('42_5.json');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(json.length, 22);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(json.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length + name.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, data, cd, name, eocd]);
    expect(unzipFirst(zip).toString()).toBe(json.toString());
    const sql = buildSql(toRows(JSON.parse(json.toString())), '2026-11-05 03:17:00');
    expect(sql).toContain(`VALUES ('O''K', '甲', 'X'`);
    expect(sql).toContain(`DELETE FROM drug_catalog WHERE synced_at <> '2026-11-05 03:17:00';`);
  });
});
