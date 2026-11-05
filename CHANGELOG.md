# 更新紀錄

每一版開頭的 `> - ` 行是給家人看的更新內容（會顯示在「有新版本了」提醒裡）。

## [0.6.0] - 2026-11-05

> - 醫生改名叫「Dr.水獺」。
> - 登入頁重新設計：Dr.水獺 浮在水上跟你打招呼，手機、電腦都好看。
> - 同一個人可以用好幾個 Google 帳號登入（例：公司的帳號），登入後都算同一個人。

- 多信箱登入：`user_emails`（migration 0004）綁到 `users.email`，登入時換成本人（名單、權限、紀錄都算本人），用別的信箱登入不蓋掉大頭照；
  `user_sessions.login_email` 記用哪個信箱登入，拿掉登入信箱時只登出那些裝置。`POST /api/users/:email/emails`、`/emails/remove`（只有最高管理者）；
  設定頁「能登入的帳號」可以加、拿掉。Cloudflare Access 的「家人」政策也要加同一個信箱（部署指南 §2）。
- 登入頁：`LoginArt`（同 App 圖示的海獺，會漂、眨眼、漣漪；減少動態時停住）、台北時間的招呼語、Google 樣式的登入鈕、手機上下排／電腦左右排；沒開通、連不上也用同一個版面。
- 舊網址 `doctor.lottery-wangwang.com` 拿掉（還沒人用）：`wrangler.toml`、`ACCESS_AUD`、舊的 Access 應用程式、轉址與搬家提示。
- 畫面、通知、錯誤訊息、Dr.水獺 的自稱改成「Dr.水獺」（runner 提示詞只改名字，安全底線沒動）。

## [0.5.1] - 2026-11-05

> - 家庭醫生搬到新網址 doctor.nathantw.com，資料都在。開舊網址會自動轉過來；第一次要重新用 Google 登入，再把新網址加到主畫面、刪掉舊的圖示。

- Nathan 買了自己的網域 `nathantw.com`：Worker 掛 `doctor.nathantw.com`，舊網址 `doctor.lottery-wangwang.com` 先留著（API 兩邊都能用）。
- Access：新網域另外一個應用程式「家庭醫生（nathantw.com）」，`ACCESS_AUD` 可以放好幾個（逗號分隔）。加進原本的應用程式在新網域沒有生效；新網域的 Access 大約 40 分鐘後才開始擋。
- 舊網址打開畫面就轉到新網址（`index.html`），新網址提醒重新加到主畫面（`src/web/moved.ts`）、登入頁提示重新登入。
- runner、`fd-api.sh`、`VAPID_SUBJECT` 改用新網址。部署指南 §9。

## [0.5.0] - 2026-11-05

> - Dr.Claude 換成海獺醫生：淺色毛茸茸的頭、亮亮的大黑鼻子，浮在水上，穿小白袍、戴額鏡、掛聽診器。
> - 聽你說話時雙手捧臉頰、想事情時抱著一顆膠囊、開心會拍手、擔心會皺眉；沒事時會漂一漂、偶爾搓搓臉。
> - 手機桌面的圖示、選單上的小頭像也換成海獺。

- 3D 角色重做（`src/web/doctor/seaOtter.ts`）：頭、身體、白袍用 SDF（橢球平滑相接）長成網格，頂點上色＋凹處陰影；殼層毛做毛茸茸的邊緣（手機少幾層）；
  手臂兩段 IK、水面以下用 clipping 切掉、漣漪；暗色模式的水與燈光另一組（`useIsDark`）。Nathan 從 A 寫實萌／B 吉祥物萌兩個提案選 A。
- `Otter3D.tsx`：state 決定身體動作、mood 決定表情（待機時 happy 拍手、concerned／urgent 合手皺眉；urgent 往前傾）。
- 2D 海獺臉（`OtterFace`，含額鏡）、`scripts/gen-icons.mjs` 重畫並重產所有圖示；放海獺臉的底改成海獺的深咖啡色（`--otter-coat`）。
- runner 提示詞的角色描述改成海獺醫生（安全底線沒動）。

## [0.4.1] - 2026-11-05

> - 家裡的 Dr.Claude 主機會自己更新，不用再手動處理。

- `runner.py` 的 `self_update`：每 5 分鐘 `git fetch` GitHub 的 `main`，有新版就快轉；runner 的檔案有變才裝套件（requirements 有變時）、
  跑 `test_runner.py`，過了用 `os.execv` 換成新版，沒過就 `git reset --keep` 退回。repo 不在 `main`、有改過的檔案、分岔都不動。
  `FD_AUTO_UPDATE=off` 可以關掉；`--check` 會顯示能不能自動更新。
- 測試用暫時的 git repo 模擬 GitHub 與家裡的 clone（更新、不用重啟、測試沒過退回、有改過的檔案不動）。
- 部署指南 §3-3、§7 改寫；`dr-claude.service` 的章節號修正。

## [0.4.0] - 2026-11-05

> - 每種藥可以配上真實照片（食藥署的藥品外觀資料）：今天頁一眼看出要吃哪一顆，點開看大圖和大小。
> - 記看診時打藥名，會列出最像的幾款照片，對照藥袋點一下就好。

- 藥品資料：食藥署開放資料「藥品外觀」（export/42）每週同步到 D1 `drug_catalog`（`scripts/sync-drug-catalog.ts`、`.github/workflows/drug-catalog.yml`）。
- 找候選（`src/shared/drugs.ts`）：全形、公絲／毫克統一；藥名比成分重要、英文從字頭比（Cetirizine 不會對到 Levocetirizine）、劑量對不上扣分、藥袋寫的顏色與劑型加減分。
- 照片：`drug_photos` 佇列，家裡的 runner 下載原圖、自動裁到藥丸（去掉尺規、背景平面擬合、連通區塊）、縮小後交回存 R2；手機只跟我們的網站拿。
  還沒好時畫一顆同顏色、同形狀的藥（`PillGlyph`）。runner 多了 numpy。
- `medications.drug_license`（migration 0003）；`POST /api/medications/:id/drug`；`/api/drugs`、`/api/drugs/match`、`/api/drugs/:license/photo(/status)`。
  API token 唯讀可以找藥、看照片，完整寫入可以幫用藥對照片。
- 畫面：今天頁（照片＋右下角頭像）、家人頁、看診頁的藥都有照片，點開看大圖；記看診時列出候選；挑選面板可以自己打字找。
- 修好：頁面裡打開的面板被頁面動畫框住、跑到頁面最底下（改成畫在最外層）。

## [0.3.0] - 2026-11-05

> - 設定頁可以建立「API token」，讓 Claude Code 這類 AI 助理幫忙查系統、記錄；它記的會標「經 API」。

- API token（migration 0002 `api_tokens`）：只有最高管理者 Google 登入後在設定頁建，期限最長一年，只在建立時顯示一次、資料庫只存 SHA-256，可撤銷、記上次使用時間。
- 權限一層包一層（`auth.ts` 的 `TOKEN_ROUTES`）：唯讀／記日常（身體狀況、量測、打勾）／完整寫入（家人、看診、用藥、附件）；都不能管帳號、建 token、用 Dr.Claude 對話、走 `/api/agent`。
  帳號停用、不再是最高管理者，token 跟著失效；正式網域沒設 Access 一樣拒絕。
- 用 token 寫入的紀錄 `created_by` 記 `token:<id>:<名稱>`，時間軸、家人頁、看診頁標「經 API：名稱」。
- AGENTS.md 鐵則 5、6 補上 API token 的規則（Nathan 決定：照他的指示寫入的看診與用藥可以直接生效）；部署指南 §6；`scripts/fd-api.sh`。

## [0.2.0] - 2026-11-05

> - 全新的畫面：今天的藥一眼看完（還有幾包、下一次什麼時候），吃完的時段會自動收起來。
> - 電腦也好用了：左邊有選單，各頁分成兩欄。
> - Dr.Claude 可以「語音對話」：按一下麥克風說話，說完自動送出，回覆會念給你聽。
> - 設定頁可以選亮色或暗色；刪除、停藥改成 App 裡的確認視窗，記好了會跳出提示。

- 設計系統重做（`styles.css`）：溫暖紙色底＋藥袋藍，Inter＋Noto Sans TC，Dr.Claude 說的話用霞鶩文楷；亮色／暗色 token、`html[data-theme]` 手動切換（`theme.ts`）。
- 版面：手機底部分頁列（今天、紀錄、Dr.Claude、新增、家人）；≥ 960px 左側選單，≥ 1180px 今天、家人、看診、Dr.Claude 變兩欄。
- 「新增」選單統一入口（拍藥袋、身體狀況、量體溫、其他量測、用說的）；記錄後畫面自動重抓（`emitDataChanged`）、跳提示。
- `confirm()`／`prompt()`／`alert()` 換成 App 內的對話框（`confirmDialog`／`promptDialog`）與提示（`toast`）。
- 今天頁：藥袋卡（進度圈、四個時段格子）、時段卡可收合、打勾改成原子筆圈起來再打勾、顯示幾點吃的。
- 紀錄頁：依日期分組、類型圖示、發燒標示；量測也可以刪除（作廢）。
- 家人頁：卡片格狀排列、正在吃幾種藥、過敏標紅；家人頁有最新體溫／體重／身高、體溫曲線（實際寬度繪製）。
- 看診頁：藥袋格子「□早 ■午 □晚 □睡前」、拍藥袋區塊與讀取進度；新增看診表單分區、底部固定儲存列。
- Dr.Claude 頁：回覆支援條列與粗體、緊急回覆有「建議盡快就醫／119」、每則可單獨朗讀；電腦版左邊診間＋對話紀錄、右邊對話。
- 語音對話模式（`DoctorPage` 的 `VoicePad`、`speech.ts` 的 `unlockSpeech`）：一樣用瀏覽器內建的語音辨識與朗讀（語音轉文字由 Chrome／iPhone 自家的服務處理）。
- e2e 加電腦寬度（1440×900）截圖、新增選單、量體溫面板、對話框、語音模式；`e2e.sh` 結束時連 workerd 一起關（之前會留下舊伺服器佔著 8787）。
- 文件章節號修正：`runner.py`（§3）、設定頁與 `wrangler.toml` 的通知金鑰（§4）。

## [0.1.1] - 2026-11-05

> - 修好：在新版瀏覽器切換頁面時，畫面會變成一片空白的問題。

- `App.tsx` 換頁捲回頂端的 effect 不再回傳 `scrollTo` 的結果（Chrome 新版回傳 Promise，React 當成 cleanup 呼叫就崩潰）。
- e2e 加上站內換頁（點底下的分頁），原本都是整頁載入，測不到這類問題。

## [0.1.0] - 2026-11-04

> - 第一版：家人、看診、吃藥打勾與提醒、身體狀況與體溫紀錄、Dr.Claude 水獺醫生。

- 從二胎代書系統搬來登入（Cloudflare Access＋系統登入憑證）、PWA、手機通知、部署流程。
- Dr.Claude：家裡 Linux 的 runner（Agent SDK）領工作，對話、讀藥袋；寫入紀錄要經伺服器檢查，看診與用藥只會是草稿。
