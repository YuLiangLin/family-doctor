import { Hono } from 'hono';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, type AttachmentKind } from '../../shared/apiTypes';
import { taipeiNow, taipeiToday } from '../../shared/dates';
import { first, run, stmt } from '../db';
import type { AppEnv } from '../env';
import { fail, parseId } from '../http';
import { toAttachment, type AttachmentRow } from '../mappers';
import { requireMember } from '../records';

const KINDS: AttachmentKind[] = ['rx', 'receipt', 'photo', 'report', 'chat', 'other'];

/** 檔頭看得出是不是宣稱的格式（不信瀏覽器給的 Content-Type） */
export function sniffType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...b.slice(4, 8)) === 'ftyp' && /heic|heix|mif1|msf1|hevc/.test(String.fromCharCode(...b.slice(8, 12)))) return 'image/heic';
  if (String.fromCharCode(...b.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}

export async function loadAttachmentRow(db: D1Database, id: number): Promise<AttachmentRow> {
  const row = await first<AttachmentRow>(db, 'SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) return fail(404, '找不到這個檔案');
  return row;
}

export async function serveAttachment(env: { FILES: R2Bucket }, row: AttachmentRow): Promise<Response> {
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return fail(404, '檔案不見了');
  return new Response(obj.body, {
    headers: {
      'Content-Type': row.content_type,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * 上傳：本文是檔案本身，header 帶 X-Upload-Filename（URL 編碼）；?kind=rx&memberId=1&visitId=2。
 * 只收照片與 PDF，最大 10 MB。
 */
export const attachmentsRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const kind = (c.req.query('kind') ?? 'photo') as AttachmentKind;
    if (!KINDS.includes(kind)) fail(400, '檔案種類不對');
    const memberId = c.req.query('memberId') ? parseId(c.req.query('memberId')) : null;
    const visitId = c.req.query('visitId') ? parseId(c.req.query('visitId')) : null;
    if (memberId) await requireMember(c.env.DB, memberId);
    if (visitId && !(await first(c.env.DB, 'SELECT 1 FROM visits WHERE id = ? AND voided_at IS NULL', visitId))) fail(400, '找不到這筆看診');
    const declared = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(declared)) fail(415, '只能上傳照片（JPG、PNG、WEBP、HEIC）或 PDF');
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) fail(400, '檔案是空的');
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) fail(413, '檔案太大（最大 10 MB）');
    const actual = sniffType(buf);
    if (!actual) fail(415, '看不出這是照片或 PDF');
    let filename = 'file';
    try {
      filename = decodeURIComponent(c.req.header('X-Upload-Filename') ?? 'file');
    } catch {
      // 用預設名稱
    }
    filename = filename.replace(/[\\/\r\n"]/g, '_').slice(0, 120) || 'file';
    const key = `${taipeiToday().slice(0, 7)}/${crypto.randomUUID()}`;
    await c.env.FILES.put(key, buf, { httpMetadata: { contentType: actual! } });
    const row = await stmt(
      c.env.DB,
      `INSERT INTO attachments (member_id, visit_id, kind, r2_key, filename, content_type, size, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      memberId,
      visitId,
      kind,
      key,
      filename,
      actual,
      buf.byteLength,
      taipeiNow(),
      c.get('user').email,
    ).first<AttachmentRow>();
    return c.json(toAttachment(row!), 201);
  })
  .get('/:id', async (c) => c.json(toAttachment(await loadAttachmentRow(c.env.DB, parseId(c.req.param('id'))))))
  .get('/:id/file', async (c) => serveAttachment(c.env, await loadAttachmentRow(c.env.DB, parseId(c.req.param('id')))))
  .post('/:id/delete', async (c) => {
    const row = await loadAttachmentRow(c.env.DB, parseId(c.req.param('id')));
    await run(c.env.DB, 'UPDATE attachments SET deleted_at = ?, deleted_by = ? WHERE id = ?', taipeiNow(), c.get('user').email, row.id);
    return c.json({ ok: true });
  });
