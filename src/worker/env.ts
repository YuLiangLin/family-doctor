import type { Role, TokenScope } from '../shared/apiTypes';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 藥袋、照片（R2，私有；只能經由 /api/attachments 讀取） */
  FILES: R2Bucket;
  /** 例：https://yourteam.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access 應用程式的 AUD tag */
  ACCESS_AUD?: string;
  /** 逗號分隔；第一次登入自動建立為管理者 */
  BOOTSTRAP_ADMINS?: string;
  /** 最高管理者（逗號分隔）：只有他能管理帳號 */
  SUPER_ADMINS?: string;
  /** 只在 localhost 生效的開發用登入身分（.dev.vars） */
  DEV_AUTH_EMAIL?: string;
  /** 家裡 runner 的 Cloudflare Access 服務憑證白名單：`<Client ID>=名稱`，逗號分隔；沒設＝不接受 */
  AGENT_CLIENT_IDS?: string;
  /** 每個帳號每天最多問 Dr.Claude 幾次（含讀藥袋；沒設＝60） */
  AI_DAILY_LIMIT?: string;
  VAPID_PUBLIC_KEY?: string;
  /** Worker secret，不進 repo；沒設＝不送通知 */
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface CurrentUser {
  email: string;
  name: string;
  role: Role;
  picture: string;
  memberId: number | null;
  /** 家裡的 dr-claude-runner（服務憑證；只能走 /api/agent 的 AGENT_ROUTES） */
  agent: boolean;
  superAdmin: boolean;
  /**
   * 用 API token 登入時才有（auth.ts 的 TOKEN_ROUTES 限制能走的 API）。
   * 這時 email 是 token:<id>:<名稱>（寫進 created_by 等欄位標記來源），ownerEmail 才是建 token 的帳號。
   */
  token?: { id: number; name: string; scope: TokenScope; ownerEmail: string };
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: CurrentUser };
};
