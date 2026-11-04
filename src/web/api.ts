interface ApiError {
  error: string;
  details?: string[];
}

const AUTH_LOST = 'fd:auth-lost';
const EXPIRED = '登入已逾時，請重新登入';

/**
 * 每個 API 請求都帶 X-Requested-With：Cloudflare Access 的登入過期時會回 401，而不是把請求轉去登入頁；
 * 再加 redirect: 'manual' 當保險（我們的 API 不會轉址，有轉址就是被 Access 攔下）。
 */
const BASE_INIT: RequestInit = {
  credentials: 'same-origin',
  redirect: 'manual',
};
const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

/** 登入不見了（逾時、被登出）：通知 App 顯示「重新登入」 */
function authLost(): ApiRequestError {
  window.dispatchEvent(new Event(AUTH_LOST));
  return new ApiRequestError(401, EXPIRED);
}

export function onAuthLost(cb: () => void): () => void {
  window.addEventListener(AUTH_LOST, cb);
  return () => window.removeEventListener(AUTH_LOST, cb);
}

/** 被 Access 攔下或 401 */
const isAuthLost = (res: Response) => res.type === 'opaqueredirect' || res.status === 401;

/** 登入（經過 Cloudflare Access，再回到 next 這一頁）的網址 */
export function signInUrl(next: string = window.location.pathname + window.location.search): string {
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
}

/**
 * 登出這台裝置：先撤銷系統自己的登入憑證（一年的那張），再請 Cloudflare Access 登出（Google 登入那一層）。
 * 連不上也照樣繼續（呼叫的人接著回登入畫面）。
 */
export async function signOutDevice(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { ...BASE_INIT, method: 'POST', headers: { ...XHR, 'Content-Type': 'application/json' }, body: '{}' });
  } catch {
    // 連不上：照樣往下
  }
  try {
    await fetch('/cdn-cgi/access/logout', { credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
  } catch {
    // 同上
  }
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...BASE_INIT,
      method,
      headers: body === undefined ? XHR : { ...XHR, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, '連不上伺服器，請檢查網路後再試');
  }
  if (isAuthLost(res)) throw authLost();
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // 被導到 Access 的 HTML 登入頁（舊設定、或其他攔截）
    if (!res.ok || text.trimStart().startsWith('<')) throw authLost();
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(res.status, err.error ?? `請求失敗（${res.status}）`, err.details ?? []);
  }
  return data as T;
}

async function errorOf(res: Response): Promise<ApiRequestError> {
  if (isAuthLost(res)) return authLost();
  const text = await res.text().catch(() => '');
  try {
    const err = JSON.parse(text) as Partial<ApiError>;
    return new ApiRequestError(res.status, err.error ?? `請求失敗（${res.status}）`, err.details ?? []);
  } catch {
    return new ApiRequestError(res.status, `請求失敗（${res.status}）`);
  }
}

/** 上傳附件：本文就是檔案；檔名放 header（後端也靠這個 header 擋 CSRF） */
async function upload<T>(path: string, file: Blob, filename: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...BASE_INIT,
      method: 'POST',
      headers: { ...XHR, 'Content-Type': file.type, 'X-Upload-Filename': encodeURIComponent(filename) },
      body: file,
    });
  } catch {
    throw new ApiRequestError(0, '連不上伺服器，請檢查網路後再試');
  }
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** 讀檔案（附件內容） */
async function blob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...BASE_INIT, headers: XHR });
  } catch {
    throw new ApiRequestError(0, '連不上伺服器，請檢查網路後再試');
  }
  if (!res.ok) throw await errorOf(res);
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T = unknown>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T = unknown>(path: string, body: unknown) => request<T>('PUT', path, body),
  upload,
  blob,
};
