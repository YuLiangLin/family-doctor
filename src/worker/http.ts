import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { isValidIsoDate } from '../shared/dates';
import { SLOTS } from '../shared/meds';
import type { AppEnv } from './env';

/** 丟出帶中文訊息的 JSON 錯誤；index.ts 的 onError 會轉成 { error, details } */
export class ApiFailure extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
    public details?: string[],
  ) {
    super(message);
  }
}

export const fail = (status: ContentfulStatusCode, message: string, details?: string[]): never => {
  throw new ApiFailure(status, message, details);
};

export async function parseBody<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(400, '資料格式錯誤（需為 JSON）');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return fail(
      400,
      '輸入資料有誤',
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}：${i.message}`),
    );
  }
  return result.data;
}

export function parseId(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(400, '編號錯誤');
  return n;
}

/** 管理帳號：只有最高管理者（SUPER_ADMINS） */
export function requireSuperAdmin(c: Context<AppEnv>): void {
  if (!c.get('user').superAdmin) fail(403, '只有最高管理者能管理帳號');
}

/** 改家人基本資料：管理者 */
export function requireAdmin(c: Context<AppEnv>): void {
  if (c.get('user').role !== 'admin') fail(403, '需要管理者權限');
}

// ---- 常用欄位 ----
export const zText = (max = 200) => z.string().trim().max(max);
export const zRequiredText = (max = 200) => z.string().trim().min(1, '不可空白').max(max);
export const zIsoDate = z.string().refine(isValidIsoDate, '日期格式需為 YYYY-MM-DD');
/** 'YYYY-MM-DD HH:MM' */
export const zDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '時間格式需為 YYYY-MM-DD HH:MM')
  .refine((s) => isValidIsoDate(s.slice(0, 10)) && Number(s.slice(11, 13)) < 24 && Number(s.slice(14, 16)) < 60, '時間不正確');
export const zId = z.number().int().positive();
export const zSlot = z.enum(SLOTS);
export const zTiming = z.enum(['before', 'after', 'with', 'any']);

export const medicationFields = {
  name: zRequiredText(120),
  genericName: zText(120).default(''),
  category: zText(40).default(''),
  purpose: zText(200).default(''),
  appearance: zText(80).default(''),
  dose: zText(40).default('1 顆'),
  slots: z.array(zSlot).max(4).default([]),
  timing: zTiming.default('after'),
  asNeeded: z.boolean().default(false),
  days: z.number().int().min(1, '天數至少 1 天').max(3650).nullable().default(null),
  mustFinish: z.boolean().default(false),
  cautions: zText(500).default(''),
};
