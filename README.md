# 家庭醫生

全家人的健康紀錄 App（手機加到主畫面就能用）：看診、藥袋、吃藥打勾與提醒、身體狀況日記、體溫，加上會互動的 3D 水獺醫生 **Dr.Claude**——
可以問他、請他幫忙記、拍藥袋讓他整理成看診紀錄。只有家人的 Google 帳號進得來。

架構沿用二胎代書系統：網站與資料在 Cloudflare，Dr.Claude 跑在家裡的 Linux（Claude Agent SDK），向網站領工作。

- 部署：[`docs/部署指南.md`](docs/部署指南.md)
- 工作備忘（待辦）：[`docs/工作備忘.md`](docs/工作備忘.md)
- 開發規則：[`AGENTS.md`](AGENTS.md)

## 技術

| 層 | 用什麼 |
|---|---|
| 前端 | React 19 + Vite + TypeScript（`src/web`），PWA；3D 醫生用 three.js + @react-three/fiber（`src/web/doctor`，進 Dr.Claude 頁才載入） |
| API | Cloudflare Worker + Hono + zod（`src/worker`） |
| 資料庫／檔案 | D1（`migrations/`）、R2（藥袋、照片） |
| 用藥排程 | `src/shared/meds.ts`（前後端共用：今天吃什麼、療程第幾天、提醒） |
| 登入 | Cloudflare Access（Google）＋ 系統自己的登入憑證；帳號白名單在 `users` 表 |
| Dr.Claude | `scripts/dr-claude-runner/runner.py`（家裡 Linux，systemd 服務）↔ `/api/agent`（Access 服務憑證） |
| 測試 | Vitest（排程、API，Node 內建 SQLite 模擬 D1）、Python unittest（runner）、Playwright 截圖冒煙測試 |

## 常用指令

```bash
npm ci
npm run check        # 型別檢查 + 測試 + build（push 前跑）
python3 -m unittest scripts/dr-claude-runner/test_runner.py
bash scripts/e2e.sh  # 本機起 wrangler dev、建假資料、手機寬度截圖到 e2e-shots/
```
