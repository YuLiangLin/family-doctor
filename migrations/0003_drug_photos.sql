-- 藥品照片（2026-11-05 Nathan）：食藥署開放資料「藥品外觀」（data.fda.gov.tw export/42，每週由 .github/workflows/drug-catalog.yml 同步）。
-- 照片由家裡的 dr-claude-runner 下載原圖、自動裁到藥丸、縮小後傳回來存 R2（drug_photos）；家人的手機只跟我們的網站拿，不直接連食藥署。
CREATE TABLE drug_catalog (
  license_no   TEXT PRIMARY KEY,                  -- 許可證字號
  name_zh      TEXT NOT NULL DEFAULT '',
  name_en      TEXT NOT NULL DEFAULT '',
  shape        TEXT NOT NULL DEFAULT '',          -- 圓形、膠囊、橢圓形…（多個用、隔開）
  color        TEXT NOT NULL DEFAULT '',          -- 綠、黃
  score_line   TEXT NOT NULL DEFAULT '',          -- 刻痕
  size_mm      TEXT NOT NULL DEFAULT '',
  marking      TEXT NOT NULL DEFAULT '',          -- 藥上的印字
  special      TEXT NOT NULL DEFAULT '',          -- 特殊劑型、氣味
  image_url    TEXT NOT NULL DEFAULT '',          -- 食藥署原圖（只給 runner 用）
  search_text  TEXT NOT NULL DEFAULT '',          -- 正規化後的英文＋中文品名（shared/drugs.ts normalizeDrugText）
  synced_at    TEXT NOT NULL
);

CREATE TABLE drug_photos (
  license_no    TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('queued', 'working', 'done', 'failed')),
  source_url    TEXT NOT NULL DEFAULT '',         -- 處理時的原圖網址；食藥署換照片就重做
  r2_prefix     TEXT NOT NULL DEFAULT '',         -- R2：<prefix>/crop.jpg（裁到藥丸）、<prefix>/full.jpg（整張縮小）
  cropped       INTEGER NOT NULL DEFAULT 0,       -- 有沒有自動裁到藥丸
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT NOT NULL DEFAULT '',
  requested_at  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_drug_photos_status ON drug_photos(status, requested_at);

-- 這個藥是哪一款（drug_catalog.license_no）；null＝還沒對
ALTER TABLE medications ADD COLUMN drug_license TEXT;
