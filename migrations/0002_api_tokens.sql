-- API token（2026-11-05 Nathan）：最高管理者 Google 登入後在設定頁建立，給 Claude Code 等程式用（Authorization: Bearer fdt_…）。
-- 資料庫只存 SHA-256，token 本身只在建立時顯示一次。期限最長一年、可以撤銷；帳號停用、不再是最高管理者就跟著失效。
-- 權限（scope）：read 唯讀；log 唯讀＋記身體狀況、量測、打勾；write 再加家人、看診、用藥。都不能管帳號、建 token、走 /api/agent。
-- 用 token 寫進去的紀錄，created_by 等欄位記成 token:<id>:<名稱>（畫面上標「經 API：名稱」）。
CREATE TABLE api_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT NOT NULL UNIQUE,
  hint          TEXT NOT NULL,                    -- 顯示用：token 的前幾碼（fdt_xxxx…）
  name          TEXT NOT NULL,                    -- 例：Claude Code 雲端
  user_email    TEXT NOT NULL,                    -- 誰建的、代表誰
  scope         TEXT NOT NULL CHECK (scope IN ('read', 'log', 'write')),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT,
  revoked_by    TEXT
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_email, revoked_at);
