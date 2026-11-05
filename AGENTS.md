# AGENTS.md — 開發注意事項

## 新對話第一件事

讀 `docs/工作備忘.md`（待辦、作業約定）。收到新需求先記進待辦再開工；做完搬到「已完成」。

## 人物

- **Nathan**（GitHub：YuLiangLin）：需求窗口與開發者。家人：太太 Candy、雙胞胎女兒。
- **回覆 Nathan 一律用繁體中文**；程式碼識別字與指令照原樣。

## 鐵則

1. **用藥排程只有一份**：今天吃什麼、療程第幾天、還剩幾包、提醒內容都在 `src/shared/meds.ts`，前端、API、提醒、給 Dr.Claude 的內容都呼叫它，
   不准在別處另寫一套。改規則時程式與 `tests/meds.test.ts` 同一個 commit；改時段時間要連 `wrangler.toml` 的 crons 一起改。
2. **計算結果不存資料庫**：`medications` 只存醫生怎麼開；每天要吃什麼、吃了幾包由排程即時算。
3. **日期**：資料庫與 API 一律 `YYYY-MM-DD`（台北日期）、時間 `YYYY-MM-DD HH:MM(:SS)`。「今天」只准用 `taipeiToday()`，時間戳用 `taipeiNow()`。
4. **健康紀錄不硬刪**：看診、用藥、日記、量測打錯就作廢（`voided_*`，記誰、何時、原因）。打勾紀錄（`dose_logs`）可以刪。
5. **登入 fail closed**（同二胎）：沒設 `ACCESS_TEAM_DOMAIN`／`ACCESS_AUD` 一律拒絕；`DEV_AUTH_EMAIL` 只在 localhost 生效；不在 `users` 名單一律 403。不要放寬。
   **API token**（`Authorization: Bearer fdt_…`，2026-11-05 Nathan 決定）：只有最高管理者 Google 登入後在設定頁建，最長一年、資料庫只存雜湊、可撤銷；
   帳號停用或不再是最高管理者就失效。只能走 `auth.ts` 的 `TOKEN_ROUTES`（read／log／write 一層包一層），不能管帳號、建 token、走 `/api/agent`。
6. **Dr.Claude 的權限**：runner 只能走 `/api/agent` 的 `AGENT_ROUTES`（`auth.ts`）；人不能走 `/api/agent`。
   runner 寫入只能經 `complete` 的 actions，由伺服器再檢查；**看診與用藥只能是草稿**，要人按確認。不要讓 App 裡的 AI 直接改用藥。
   例外（2026-11-05 Nathan 決定）：Claude Code 等程式用 API token（write）**照 Nathan 的指示**寫入，看診與用藥可以直接生效；
   `created_by` 等欄位記成 `token:<id>:<名稱>`，畫面標「經 API」（`ViaTag`）。
7. **Dr.Claude 的安全底線**在 `runner.py` 的 `SYSTEM_PROMPT`：不診斷、危險徵兆直接叫就醫（mood urgent）、小孩劑量只照藥袋／仿單、不建議自行停藥。
   改提示時這幾條不能拿掉。runner 不給 Bash、不上網、不載入機器上的 Claude Code 設定。
   （runner 程式本身會去食藥署下載藥品照片、裁切後傳回系統，只限 `mcp.fda.gov.tw`，不經過 AI；見部署指南 §7。）
8. **個資不進 repo**：真實病歷、照片、資料庫匯出、`.dev.vars`、API key、服務憑證。測試與 e2e 只用假資料。
9. 畫面文字用繁體中文；錯誤訊息要讓家人看得懂（`fail(400, '回診日不能早於看診日')`）。

## Claude Code 用 API token 進系統

環境變數 `FD_API_TOKEN`（設定頁「API token」建的）在的話，可以用 `scripts/fd-api.sh GET /today` 這樣查正式系統。

- 查問題用唯讀就夠；要寫入（家人、看診、用藥、身體狀況）**先把要寫的內容列給 Nathan 確認**再送，藥名、劑量、時段、天數照藥袋，小孩劑量不自己算。
- 鐵則 7 的安全底線一樣適用：不診斷、危險徵兆叫就醫。
- 讀到的健康資料只在對話裡用：不寫進 repo、commit、PR、issue，也不要把 token 印出來。

## 推送前自檢

```bash
npm run check                                              # tsc + vitest + vite build
python3 -m unittest scripts/dr-claude-runner/test_runner.py
bash scripts/e2e.sh                                        # 改到畫面時跑，看 e2e-shots/ 的截圖（亮色、暗色）
```

CI 跑的就是前兩項。push 到 `main` 自動部署。workflow 的 job 一律 `runs-on: ${{ vars.RUNNER || 'ubuntu-latest' }}`。

## 發版

改 `package.json` 的 `version`，`CHANGELOG.md` 加 `## [x.y.z] - YYYY-MM-DD` 段落（沒有 build 會失敗）；段落開頭 `> - ` 寫給家人看的白話更新內容。

## 藥品照片

食藥署開放資料「藥品外觀」：每週 `.github/workflows/drug-catalog.yml` 同步到 `drug_catalog`；從藥名找候選、正規化在 `src/shared/drugs.ts`（前後端、同步腳本共用一份）。
照片由家裡的 runner 下載、自動裁到藥丸、縮小後存 R2（`drug_photos`），手機只跟我們的網站拿。挑錯照片比沒照片糟：一律人點選才算數，不自動選。

## 加欄位／改資料表

新增 `migrations/000N_xxx.sql`，不要改已經套用過的 migration。欄位對應集中在 `src/worker/mappers.ts`，型別在 `src/shared/apiTypes.ts`。
