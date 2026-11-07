-- 實際吃藥時間（2026-11-07 Nathan：不一定準時吃，也常常吃完過一陣子才打勾）。
-- taken_at：'YYYY-MM-DD HH:MM'（台北），使用者填的，預設是按下去的時間；跳過的是空字串。
-- logged_at 仍是按下去（最後一次改）的時間。以前的紀錄沒有填，當成按下去的時間。
ALTER TABLE dose_logs ADD COLUMN taken_at TEXT NOT NULL DEFAULT '';
UPDATE dose_logs SET taken_at = substr(logged_at, 1, 16) WHERE status = 'taken';
