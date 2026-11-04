import type { Attachment, AttachmentKind } from '../shared/apiTypes';
import { api } from './api';

const MAX_SIDE = 2200;

/** 手機照片常常 4～8 MB：上傳前縮到長邊 2200px 的 JPEG（藥袋字還看得清楚）；PDF 和瀏覽器讀不了的格式原樣上傳 */
export async function shrinkImage(file: File): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type !== 'image/heic') return { blob: file, name: file.name };
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch {
    return { blob: file, name: file.name };
  }
}

export async function uploadPhoto(file: File, kind: AttachmentKind, opts: { memberId?: number | null; visitId?: number } = {}): Promise<Attachment> {
  const { blob, name } = await shrinkImage(file);
  const q = new URLSearchParams({ kind });
  if (opts.memberId) q.set('memberId', String(opts.memberId));
  if (opts.visitId) q.set('visitId', String(opts.visitId));
  return api.upload<Attachment>(`/attachments?${q}`, blob, name);
}
