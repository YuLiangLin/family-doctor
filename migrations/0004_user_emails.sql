-- 同一個人可以用好幾個 Google 帳號登入（2026-11-05 Nathan：公司的 Google Workspace 帳號也要能登入，綁同一個使用者）。
-- 登入時先查 users，查不到再查這裡：找到就當成 users.email 那個人（名單、權限、紀錄都算本人的）。
CREATE TABLE user_emails (
  email       TEXT PRIMARY KEY,                -- 小寫，不能跟 users.email 重複（程式檢查）
  user_email  TEXT NOT NULL REFERENCES users(email),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_user_emails_user ON user_emails(user_email);

-- 這張登入憑證是用哪個信箱登入的（拿掉某個登入信箱時，只登出用它登入的裝置）；空字串＝用本人的信箱
ALTER TABLE user_sessions ADD COLUMN login_email TEXT NOT NULL DEFAULT '';
