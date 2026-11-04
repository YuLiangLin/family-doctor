-- 家庭醫生 初始資料表
-- 日期 'YYYY-MM-DD'（台北日期）；時間 'YYYY-MM-DD HH:MM:SS'（台北時間，由程式寫入）。
-- 健康紀錄不硬刪：打錯就作廢（voided_*，記誰、何時、原因），畫面上不顯示。

-- 能登入的帳號（Google，經 Cloudflare Access）；不在名單＝進不來。
-- member_id：這個帳號是哪位家人（「我」的紀錄、Dr.Claude 預設問誰）；小朋友沒有帳號，由爸媽記。
CREATE TABLE users (
  email         TEXT PRIMARY KEY,                 -- 小寫 Google 帳號
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  active        INTEGER NOT NULL DEFAULT 1,
  member_id     INTEGER,
  picture_url   TEXT NOT NULL DEFAULT '',
  last_seen_at  TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL DEFAULT ''
);

-- 系統自己的登入憑證（同二胎 sessions.ts）：Access 驗過 Google 後發，一年、每天用就延長；資料庫只存雜湊
CREATE TABLE user_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT NOT NULL UNIQUE,
  user_email    TEXT NOT NULL,
  device        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  revoked_by    TEXT
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_email, revoked_at);

-- 家人
CREATE TABLE members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,                     -- 畫面上的稱呼（例：Nathan、Candy、蓉蓉）
  relation     TEXT NOT NULL DEFAULT '',          -- 本人、太太、女兒…
  birth_date   TEXT,                              -- 小朋友用藥看年齡、體重
  sex          TEXT NOT NULL DEFAULT '' CHECK (sex IN ('', 'M', 'F')),
  blood_type   TEXT NOT NULL DEFAULT '',
  allergies    TEXT NOT NULL DEFAULT '',          -- 藥物、食物過敏（Dr.Claude 每次都會看）
  conditions   TEXT NOT NULL DEFAULT '',          -- 慢性病、重要病史
  note         TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '#3f8f7a',   -- 畫面上的代表色
  emoji        TEXT NOT NULL DEFAULT '🙂',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL
);

-- 看診紀錄
CREATE TABLE visits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER NOT NULL REFERENCES members(id),
  visit_date      TEXT NOT NULL,
  clinic          TEXT NOT NULL DEFAULT '',
  department      TEXT NOT NULL DEFAULT '',       -- 家醫科、小兒科、耳鼻喉科…
  doctor          TEXT NOT NULL DEFAULT '',
  reason          TEXT NOT NULL DEFAULT '',       -- 為什麼去看（症狀）
  diagnosis       TEXT NOT NULL DEFAULT '',       -- 醫師怎麼說
  advice          TEXT NOT NULL DEFAULT '',       -- 醫囑
  follow_up_date  TEXT,
  copay           INTEGER,                        -- 自付金額（元）
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  voided_at       TEXT,
  voided_by       TEXT,
  void_reason     TEXT
);
CREATE INDEX idx_visits_member ON visits(member_id, visit_date);

-- 用藥（醫生開的藥、自己買的藥都算）。排程由 src/shared/meds.ts 即時算，不存「今天要吃什麼」。
-- slots：逗號分隔 morning,noon,evening,bedtime；timing：飯前 before／飯後 after／隨餐 with／不限 any。
-- days：吃幾天（空＝長期吃到按停止）；as_needed＝需要時才吃（不排進每天的提醒）。
CREATE TABLE medications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id),
  visit_id      INTEGER REFERENCES visits(id),
  name          TEXT NOT NULL,                    -- 藥袋上的名稱（例：CEPHALEXIN 500MG）
  generic_name  TEXT NOT NULL DEFAULT '',         -- 成分（例：Cephalexin）
  category      TEXT NOT NULL DEFAULT '',         -- 抗生素、鼻塞藥、抗過敏…
  purpose       TEXT NOT NULL DEFAULT '',         -- 白話用途
  appearance    TEXT NOT NULL DEFAULT '',         -- 外觀（綠白膠囊）方便對藥
  dose          TEXT NOT NULL DEFAULT '1 顆',
  slots         TEXT NOT NULL DEFAULT '',
  timing        TEXT NOT NULL DEFAULT 'after' CHECK (timing IN ('before', 'after', 'with', 'any')),
  as_needed     INTEGER NOT NULL DEFAULT 0,
  start_date    TEXT NOT NULL,
  days          INTEGER,
  must_finish   INTEGER NOT NULL DEFAULT 0,       -- 抗生素等：要吃完，不可自己停
  cautions      TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  stopped_at    TEXT,                             -- 提早停藥（日期）
  stop_reason   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  voided_at     TEXT,
  voided_by     TEXT,
  void_reason   TEXT
);
CREATE INDEX idx_medications_member ON medications(member_id, start_date);
CREATE INDEX idx_medications_visit ON medications(visit_id);

-- 吃了沒（每一包藥按一下）；取消打勾＝刪掉這筆
CREATE TABLE dose_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id  INTEGER NOT NULL REFERENCES medications(id),
  dose_date      TEXT NOT NULL,
  slot           TEXT NOT NULL,                   -- morning／noon／evening／bedtime；需要時吃的用 prn
  status         TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
  logged_at      TEXT NOT NULL,
  logged_by      TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_dose_logs_slot ON dose_logs(medication_id, dose_date, slot) WHERE slot <> 'prn';
CREATE INDEX idx_dose_logs_date ON dose_logs(dose_date);

-- 身體狀況日記（自己記、或請 Dr.Claude 記）
CREATE TABLE health_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id),
  noted_at    TEXT NOT NULL,                      -- 'YYYY-MM-DD HH:MM'
  body        TEXT NOT NULL,
  severity    INTEGER NOT NULL DEFAULT 0 CHECK (severity BETWEEN 0 AND 3),  -- 0 沒填、1 輕、2 中、3 重
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'dr_claude')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  voided_at   TEXT,
  voided_by   TEXT,
  void_reason TEXT
);
CREATE INDEX idx_health_notes_member ON health_notes(member_id, noted_at);

-- 量測：體溫、體重、身高、心跳、血壓（value 收縮壓／value2 舒張壓）、血氧
CREATE TABLE measurements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    INTEGER NOT NULL REFERENCES members(id),
  kind         TEXT NOT NULL CHECK (kind IN ('temperature', 'weight', 'height', 'heart_rate', 'blood_pressure', 'spo2')),
  value        REAL NOT NULL,
  value2       REAL,
  measured_at  TEXT NOT NULL,                     -- 'YYYY-MM-DD HH:MM'
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'dr_claude')),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  voided_at    TEXT,
  voided_by    TEXT,
  void_reason  TEXT
);
CREATE INDEX idx_measurements_member ON measurements(member_id, kind, measured_at);

-- 附件：藥袋、收據、患部照片、檢驗報告（檔案在 R2）
CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER REFERENCES members(id),
  visit_id      INTEGER REFERENCES visits(id),
  kind          TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('rx', 'receipt', 'photo', 'report', 'chat', 'other')),
  r2_key        TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  deleted_at    TEXT,
  deleted_by    TEXT
);
CREATE INDEX idx_attachments_visit ON attachments(visit_id);
CREATE INDEX idx_attachments_member ON attachments(member_id);

-- Dr.Claude 對話（每個帳號自己的；健康紀錄是全家共用的）
CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL,
  member_id   INTEGER REFERENCES members(id),     -- 主要在問哪位家人
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_conversations_user ON conversations(user_email, updated_at);

CREATE TABLE chat_messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body             TEXT NOT NULL,
  attachment_ids   TEXT NOT NULL DEFAULT '[]',    -- JSON 陣列
  actions          TEXT NOT NULL DEFAULT '[]',    -- Dr.Claude 這次幫忙記了什麼／建議存的看診草稿（JSON）
  mood             TEXT NOT NULL DEFAULT '',      -- 3D 醫生的表情（calm／happy／concerned／urgent）
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, id);

-- AI 工作佇列：家裡 Linux 的 dr-claude-runner 來領（同二胎 AI 評估服務的作法）
-- kind：chat＝回覆一則訊息；rx_scan＝讀藥袋照片，產出看診＋用藥草稿（使用者確認後才存）
CREATE TABLE ai_jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL CHECK (kind IN ('chat', 'rx_scan')),
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  conversation_id  INTEGER REFERENCES conversations(id),
  message_id       INTEGER REFERENCES chat_messages(id),
  member_id        INTEGER REFERENCES members(id),
  attachment_ids   TEXT NOT NULL DEFAULT '[]',
  stage            TEXT NOT NULL DEFAULT '',      -- 做到哪一步（顯示用）
  result           TEXT,                          -- JSON（rx_scan 的草稿）
  error            TEXT NOT NULL DEFAULT '',
  cost_usd         REAL,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  claimed_at       TEXT,
  updated_at       TEXT NOT NULL,
  finished_at      TEXT
);
CREATE INDEX idx_ai_jobs_status ON ai_jobs(status, id);

-- 小型的系統狀態（例：runner 最後一次來領工作的時間）
CREATE TABLE app_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 手機通知（同二胎）
CREATE TABLE push_subscriptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email       TEXT NOT NULL,
  endpoint         TEXT NOT NULL UNIQUE,
  p256dh           TEXT NOT NULL,
  auth             TEXT NOT NULL,
  device           TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  last_success_at  TEXT,
  last_error       TEXT NOT NULL DEFAULT '',
  fail_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_email);

-- 吃藥提醒跑過了沒（Cron 同一個時段觸發兩次也只送一次）：run_key＝'2026-11-04 morning'
CREATE TABLE reminder_runs (
  run_key     TEXT PRIMARY KEY,
  result      TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  devices     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
