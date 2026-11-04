// Web Push 的協定層：內容加密 RFC 8291（aes128gcm）、伺服器身分 VAPID（RFC 8292）。
// 只用 WebCrypto＋jose（Worker 與 Node 都能跑），不裝 web-push 套件（它用 Node 的 crypto）。
import { importJWK, SignJWT } from 'jose';

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 字串 → UTF-8 bytes（複製一份到一般的 ArrayBuffer，WebCrypto 的型別要這個） */
const utf8 = (text: string): Bytes => concat(enc.encode(text));

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** P-256 公鑰（65 bytes：0x04‖x‖y）→ JWK；給 d 就是私鑰 */
function p256Jwk(publicKey: Uint8Array, d?: string): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('P-256 公鑰格式錯誤');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(publicKey.slice(1, 33)),
    y: b64urlEncode(publicKey.slice(33)),
    ...(d ? { d } : {}),
  };
}

/** 測試用：固定伺服器的臨時金鑰與 salt（RFC 8291 附錄 A 的範例） */
export interface FixedEncryption {
  asPublic: Bytes;
  asPrivate: string;
  salt: Bytes;
}

/**
 * RFC 8291：用手機（瀏覽器）訂閱時給的公鑰 p256dh 與 auth 加密內容，只有那台手機解得開（推播服務看不到內容）。
 * 輸出＝標頭（salt‖記錄大小 4096‖金鑰長度‖伺服器臨時公鑰）＋一筆 AES-128-GCM 密文。
 */
export async function encryptPayload(plaintext: Uint8Array, uaPublic: Bytes, authSecret: Bytes, fixed?: FixedEncryption): Promise<Bytes> {
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' } as const;
  let asPublic: Bytes;
  let asPrivate: CryptoKey;
  if (fixed) {
    asPublic = fixed.asPublic;
    asPrivate = await crypto.subtle.importKey('jwk', p256Jwk(fixed.asPublic, fixed.asPrivate), ecdh, false, ['deriveBits']);
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ['deriveBits'])) as CryptoKeyPair;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    asPrivate = pair.privateKey;
  }
  const salt = fixed?.salt ?? new Uint8Array(16);
  if (!fixed) crypto.getRandomValues(salt);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ecdh, false, []);
  // WebCrypto 的參數名是 public（workers-types 寫成 $public，執行時認的是 public）
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, asPrivate, 256));
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 只有一筆記錄：內容後面接 0x02（最後一筆的分隔），不補空白
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  new DataView(header.buffer).setUint32(16, 4096);
  header.set(salt, 0);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

export interface VapidKeys {
  /** base64url 的 P-256 公鑰（65 bytes），瀏覽器訂閱時的 applicationServerKey */
  publicKey: string;
  /** base64url 的私鑰 d（32 bytes），Worker secret */
  privateKey: string;
  /** 聯絡方式（mailto: 或 https:），推播服務出問題時找得到人 */
  subject: string;
}

/** RFC 8292：用 VAPID 私鑰簽一張給這個推播服務（aud＝端點的 origin）的 JWT，12 小時有效 */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowMs = Date.now()): Promise<string> {
  const key = await importJWK({ ...p256Jwk(b64urlDecode(keys.publicKey), keys.privateKey), alg: 'ES256' }, 'ES256');
  const jwt = await new SignJWT({ sub: keys.subject })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime(Math.floor(nowMs / 1000) + 12 * 3600)
    .sign(key);
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

/**
 * 只送到已知的推播服務（Chrome／Android 的 FCM、Apple、Firefox、Edge）：訂閱的網址是使用者送上來的，
 * 不限制的話等於讓人叫 Worker 去 POST 任意網址。
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function isPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.port === '' && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

export interface PushTarget {
  endpoint: string;
  /** base64url，瀏覽器訂閱的公鑰 */
  p256dh: string;
  /** base64url，16 bytes */
  auth: string;
}

export interface PushOptions {
  /** 推播服務最多替關機的手機保留幾秒 */
  ttl: number;
  /** 同一個 topic 還沒送到的舊通知會被新的取代（例：每天的收款提醒） */
  topic?: string;
  /** 吃藥提醒用 high（手機省電模式也盡量即時送到） */
  urgency?: 'normal' | 'high';
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** 404／410：手機已經取消訂閱（App 刪了、通知關了），這筆訂閱不用再送 */
  gone: boolean;
}

export async function sendWebPush(target: PushTarget, payload: string, keys: VapidKeys, opts: PushOptions): Promise<PushResult> {
  if (!isPushEndpoint(target.endpoint)) return { ok: false, status: 0, gone: true };
  const body = await encryptPayload(utf8(payload), b64urlDecode(target.p256dh), b64urlDecode(target.auth));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, keys),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl),
    Urgency: opts.urgency ?? 'normal',
  };
  if (opts.topic) headers.Topic = opts.topic;
  const res = await fetch(target.endpoint, { method: 'POST', headers, body });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
