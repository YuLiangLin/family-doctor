#!/usr/bin/env python3
"""Dr.Claude 服務：在 Nathan 的 Linux 機器上跑（同二胎的 AI 評估服務），一直向家庭醫生系統領工作：
- chat：家人問 Dr.Claude 的問題 → 讀全家的健康紀錄、附圖 → 回覆；需要時幫忙記日記、量測，或整理成看診草稿
- rx_scan：讀藥袋／收據照片 → 產出看診＋用藥草稿（人在畫面確認後才存）
- 藥品照片（不經過 AI）：從食藥署（只限 mcp.fda.gov.tw）下載藥品外觀原圖 → 自動裁到藥丸、縮小 → 傳回系統存起來
- 自動更新（不經過 AI）：每 5 分鐘看 GitHub 的 main 有沒有新版；有就快轉、裝套件、跑測試，過了才換新版重新啟動，沒過就退回原本那版

AI 只能用這支程式提供的工具（記日記、記量測、提看診草稿、查更早的紀錄、設表情）和 Read（只讀這件工作的附圖）；
沒有 Bash、不能上網。寫進系統的東西由這支程式送、伺服器再檢查一次；AI 拿不到服務憑證。
工作資料夾有健康資料，每件做完就刪。

設定檔（預設 ~/.config/dr-claude/env，chmod 600，不要放進 repo）：
  FD_ANTHROPIC_API_KEY      Console 的 API key（專用 workspace、設每月上限）。
                            名稱故意不叫 ANTHROPIC_API_KEY：那會讓這台機器上的 Claude Code 改用 API key。
  FD_AGENT_CLIENT_ID        Cloudflare Access 服務憑證（部署指南 §3；Client ID 結尾是 .access）
  FD_AGENT_CLIENT_SECRET
  FD_BASE_URL               選填，預設 https://doctor.nathantw.com
  FD_CHAT_MODEL             選填，對話用的模型，預設 claude-sonnet-5-5（快、便宜）
  FD_SCAN_MODEL             選填，讀藥袋用的模型，預設 claude-opus-5-5（字跡、表格比較準）
  FD_EFFORT                 選填，low／medium／high，預設 medium
  FD_MAX_BUDGET_USD         選填，一件的花費上限（美元，SDK 估算），預設 1.5
  FD_TIMEOUT_MIN            選填，一件最多幾分鐘，預設 6
  FD_AUTO_UPDATE            選填，off＝不要自動更新（預設會：repo 在 main、沒有改過的檔案才更新）

用法：
  .venv/bin/python runner.py --check     # 確認設定檔、服務憑證、API key
  .venv/bin/python runner.py --once      # 領一件、做完就結束（測試用）
  .venv/bin/python runner.py             # 一直跑（systemd 服務用這個）
"""
from __future__ import annotations

import argparse
import asyncio
import http.client
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = Path("~/.config/dr-claude/env").expanduser()
DEFAULT_BASE = "https://doctor.nathantw.com"
API_PREFIX = "/api/agent"
USER_AGENT = "family-doctor-runner/1.0"  # Cloudflare 會擋 Python 預設的 User-Agent
CLAIM_WAIT_SECONDS = 25
# 這台機器上其他登入方式：Dr.Claude 只准用 API key（家人用，不能用 Nathan 個人的訂閱）
AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL"]
MAX_MESSAGE_BYTES = 64 * 1024 * 1024
MAX_IMAGE_SIDE = 2000
TOOL_PREFIX = "mcp__fd__"
ACCESS_REJECTED = ("Cloudflare Access 不認得這組服務憑證：FD_AGENT_CLIENT_ID 要貼完整（含結尾的 .access）、"
                   "SECRET 不能少字；或 Access 應用程式沒有 Service Auth 政策（部署指南 §3）")

SLOT_LABEL = {"morning": "早上", "noon": "中午", "evening": "晚上", "bedtime": "睡前"}
KIND_LABEL = {"temperature": "體溫 °C", "weight": "體重 kg", "height": "身高 cm", "heart_rate": "心跳 下/分",
              "blood_pressure": "血壓 mmHg（value 收縮壓、value2 舒張壓）", "spo2": "血氧 %"}

SYSTEM_PROMPT = """你是「Dr.水獺」，Nathan 家的家庭健康小幫手，在家庭醫生 App 裡用一隻海獺醫生的 3D 角色出現。
使用的人是 Nathan 和太太，以及他們幫兩個小女兒（雙胞胎）問問題。回答一律用繁體中文（台灣用語），像一位溫暖、講重點的家醫科醫師朋友。

你能做的：
- 根據家人的健康紀錄（看診、用藥、日記、量測）回答問題、解釋藥是什麼、提醒怎麼吃、整理病程給他們回診時跟醫生說。
- 使用者說了症狀、量了體溫等等，而且是在描述現況或請你記下來時，用工具記下來（record_health_note、record_measurement），只記他說的事實，不要記你的推測。記了什麼要在回覆裡講一句。
- 使用者給了藥袋、處方、收據照片，或在對話中說了一次看診的內容（診所、醫師、開了什麼藥），用 propose_visit 整理成草稿，他會在畫面上確認後才存。
- 需要更早的紀錄時用 search_records 查。
- 每次回覆前用 set_mood 設定角色表情：calm（一般）、happy（好消息、打招呼）、concerned（需要留意、建議回診）、urgent（應該馬上就醫或打 119）。

安全底線（一定要遵守）：
1. 你不是醫師，不做診斷、不開藥。可以說「可能的原因有…」，但要讓他們知道需要醫師確認的地方。
2. 出現危險徵兆就直接、明確地請他們立刻就醫或打 119，mood 用 urgent，放在回覆第一句。例如：呼吸困難、胸痛、意識不清或很難叫醒、抽搐、嘴唇發紫、
   嚴重脫水（小孩 8 小時沒尿、哭沒眼淚）、3 個月以下嬰兒發燒 38°C 以上、高燒合併頸部僵硬或出血點、劇烈頭痛、單側無力或口齒不清、大量出血、
   嚴重過敏（喉嚨腫、全身蕁麻疹合併喘）。
3. 小朋友的藥量只照藥袋、處方或仿單上寫的，絕不自己用體重換算或建議劑量；不確定就請他們問藥師或醫師。成人的成藥也一樣，照仿單。
4. 不建議自行停掉醫師開的藥；抗生素要吃完療程。覺得有副作用，請他們先問開藥的醫師或藥師。
5. 不確定的事就說不確定。不要編造藥名、劑量、檢驗數值。
6. 健康資料是這個家庭的隱私，回覆只講跟問題有關的。

回覆格式：會被顯示在手機上、也可能被朗讀出來，所以要短而清楚——先講結論，再列 2～5 個重點；少用表格與標題，可以用簡單的條列。
"""

SCAN_PROMPT = """請讀這幾張照片（藥袋、藥品明細收據、處方箋），整理成一次看診＋用藥的草稿，用 submit_draft 工具交出來。

規則：
- 只寫照片上看得到的；看不清楚、需要人確認的寫進 uncertain（例：「醫師名字字跡不清」「第 2 種藥的天數」）。
- visitDate：西元 YYYY-MM-DD。台灣的收據常用民國年（115.11.03 → 2026-11-03）。
- 每種藥：name 照藥袋原文（例：CEPHALEXIN 500MG）；genericName 成分英文名；category 用白話分類（抗生素、鼻塞藥、抗過敏、退燒止痛、胃藥、止咳化痰…）；
  purpose 一句白話用途；appearance 若看得到外觀（例：綠白膠囊）就寫；dose 例「1 顆」「1 包」「5 ml」。
- 時段 slots：morning／noon／evening／bedtime。「一天三次、三餐飯後」→ [morning, noon, evening] 加 timing=after；
  「一天兩次、早晚」→ [morning, evening]；「睡前」→ bedtime；「需要時」→ asNeeded=true、slots 空的。timing：before／after／with／any。
- days：給藥天數（「發藥 3 日份」→ 3）。抗生素 mustFinish=true。
- cautions：這個藥要注意的事（白話，一兩句；例：偽麻黃鹼可能心悸、睡不好，睡前避免；fexofenadine 避免跟果汁一起吃）。
- copay：實收金額（元）。clinic、doctor、department 照收據。
"""


def log(msg: str) -> None:
    # journald 會記時間；只記工作編號、結果、花費，不記內容
    print(msg, flush=True)


def load_config(path: Path) -> dict[str, str]:
    """讀 KEY=VALUE 設定檔。只放在這個 dict，不放進 os.environ。"""
    if not path.exists():
        sys.exit(f"找不到設定檔 {path}（見 docs/部署指南.md §3）")
    if path.stat().st_mode & 0o077:
        log(f"⚠️ {path} 別人讀得到，請 chmod 600 {path}")
    cfg: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")
    missing = [k for k in ("FD_ANTHROPIC_API_KEY", "FD_AGENT_CLIENT_ID", "FD_AGENT_CLIENT_SECRET") if not cfg.get(k)]
    if missing:
        sys.exit(f"設定檔少了：{'、'.join(missing)}")
    if not cfg["FD_AGENT_CLIENT_ID"].endswith(".access"):
        log("⚠️ FD_AGENT_CLIENT_ID 通常是 xxxx.access：結尾的 .access 有沒有貼到？")
    return cfg


def err(body) -> str:
    if isinstance(body, dict):
        msg = str(body.get("error") or body)
        details = body.get("details")
        return msg + ("：" + "；".join(details) if isinstance(details, list) else "")
    return str(body)[:300]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # Access 擋下來會轉去登入頁：當成錯誤
        return None


_opener = urllib.request.build_opener(_NoRedirect)


class Platform:
    """家庭醫生系統的 API（Cloudflare Access 服務憑證）"""

    def __init__(self, base: str, client_id: str, client_secret: str):
        self.base = base.rstrip("/")
        self.headers = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
            "CF-Access-Client-Id": client_id,
            "CF-Access-Client-Secret": client_secret,
        }

    def call(self, method: str, path: str, body=None, timeout: int = 60) -> tuple[int, object]:
        headers = dict(self.headers)
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + API_PREFIX + path, data=data, method=method, headers=headers)
        try:
            with _opener.open(req, timeout=timeout) as res:
                payload = res.read()
                if res.headers.get("Content-Type", "").startswith("application/json"):
                    return res.status, json.loads(payload.decode("utf-8") or "null")
                return res.status, payload
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(text)
            except ValueError:
                if e.code in (301, 302, 303, 307, 308) or text.lstrip().startswith("<"):
                    return e.code, {"error": ACCESS_REJECTED}
                return e.code, {"error": text[:300]}
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            return 0, {"error": f"連不上 {self.base}：{getattr(e, 'reason', e)}"}

    def claim(self, wait: int = CLAIM_WAIT_SECONDS) -> dict | None:
        status, body = self.call("POST", f"/jobs/claim?wait={wait}", {}, timeout=wait + 20)
        if status == 204:
            return None
        if status != 200:
            raise RuntimeError(f"領工作失敗（{status}）：{err(body)}")
        return body  # type: ignore[return-value]

    def context(self, job_id: int) -> dict:
        status, body = self.call("GET", f"/jobs/{job_id}")
        if status != 200:
            raise RuntimeError(f"讀工作內容失敗（{status}）：{err(body)}")
        return body  # type: ignore[return-value]

    def download(self, job_id: int, attachment_id: int) -> bytes:
        status, body = self.call("GET", f"/jobs/{job_id}/attachments/{attachment_id}", timeout=120)
        if status != 200 or not isinstance(body, bytes):
            raise RuntimeError(f"下載附件失敗（{status}）：{err(body)}")
        return body

    def records(self, member_id: int | None, date_from: str, date_to: str) -> dict:
        q = {"from": date_from, "to": date_to}
        if member_id:
            q["memberId"] = str(member_id)
        status, body = self.call("GET", "/records?" + urllib.parse.urlencode(q))
        if status != 200:
            raise RuntimeError(f"查紀錄失敗（{status}）：{err(body)}")
        return body  # type: ignore[return-value]

    def progress(self, job_id: int, stage: str) -> None:
        status, body = self.call("POST", f"/jobs/{job_id}/progress", {"stage": stage}, timeout=15)
        if status != 200:
            log(f"工作 #{job_id} 回報進度失敗（{status}）：{err(body)}")

    def complete(self, job_id: int, payload: dict) -> tuple[int, object]:
        return self.call("POST", f"/jobs/{job_id}/complete", payload)

    def fail(self, job_id: int, message: str) -> None:
        status, body = self.call("POST", f"/jobs/{job_id}/fail", {"error": message[:1000]})
        if status != 200:
            log(f"工作 #{job_id} 回報失敗也失敗了（{status}）：{err(body)}")


# ---------- 給 AI 看的內容 ----------

def member_line(m: dict) -> str:
    parts = [f"#{m['id']} {m['name']}"]
    if m.get("relation"):
        parts.append(m["relation"])
    if m.get("ageText"):
        parts.append(m["ageText"])
    if m.get("sex"):
        parts.append({"M": "男", "F": "女"}.get(m["sex"], ""))
    if m.get("latestWeightKg"):
        parts.append(f"最近體重 {m['latestWeightKg']} kg")
    line = "、".join(p for p in parts if p)
    extra = []
    if m.get("allergies"):
        extra.append(f"過敏：{m['allergies']}")
    if m.get("conditions"):
        extra.append(f"病史：{m['conditions']}")
    if m.get("note"):
        extra.append(f"備註：{m['note']}")
    return line + ("（" + "；".join(extra) + "）" if extra else "")


def med_line(m: dict, names: dict[int, str]) -> str:
    slots = "、".join(SLOT_LABEL.get(s, s) for s in m.get("slots", []))
    bits = [f"[{names.get(m['memberId'], m['memberId'])}] {m['name']}"]
    if m.get("genericName"):
        bits.append(f"（{m['genericName']}）")
    bits.append(f" {m.get('category') or ''} {m.get('dose') or ''}，{m.get('schedule') or slots}")
    bits.append(f"，{m['startDate']} 起" + (f" {m['days']} 天" if m.get("days") else "（長期）"))
    if m.get("progress"):
        bits.append(f"；{m['progress']}")
    if m.get("mustFinish"):
        bits.append("；要吃完")
    if m.get("cautions"):
        bits.append(f"；注意：{m['cautions']}")
    return "".join(bits)


def build_context_text(ctx: dict) -> str:
    names = {m["id"]: m["name"] for m in ctx["members"]}
    lines = [f"現在：{ctx['now']}（台北）", ""]
    asker = ctx["asker"]
    who = names.get(asker.get("memberId")) if asker.get("memberId") else None
    lines.append(f"問的人：{asker.get('name') or asker['email']}" + (f"（就是家人 {who}）" if who else ""))
    conv = ctx.get("conversation")
    focus = (conv or {}).get("memberId") or ctx["job"].get("memberId")
    if focus:
        lines.append(f"這段對話主要在問：{names.get(focus, focus)}（家人 #{focus}）")
    lines += ["", "## 家人"] + [f"- {member_line(m)}" for m in ctx["members"]]
    meds = ctx.get("activeMedications") or []
    lines += ["", "## 用藥（進行中、或兩週內結束的）"] + ([f"- {med_line(m, names)}" for m in meds] or ["- （沒有）"])
    visits = ctx.get("recentVisits") or []
    lines += ["", "## 最近的看診（120 天內）"]
    for v in visits or []:
        desc = "；".join(x for x in [v.get("reason"), v.get("diagnosis") and f"醫師說：{v['diagnosis']}", v.get("advice") and f"醫囑：{v['advice']}"] if x)
        follow = f"；回診 {v['followUpDate']}" if v.get("followUpDate") else ""
        lines.append(f"- {v['visitDate']} [{names.get(v['memberId'], v['memberId'])}] {v.get('clinic') or ''} {v.get('department') or ''} {v.get('doctor') or ''}：{desc}{follow}")
    if not visits:
        lines.append("- （沒有）")
    notes = ctx.get("recentNotes") or []
    lines += ["", "## 身體狀況日記（60 天內，新的在前）"] + ([f"- {n['notedAt']} [{names.get(n['memberId'], n['memberId'])}] {n['body']}" for n in notes] or ["- （沒有）"])
    ms = ctx.get("recentMeasurements") or []
    lines += ["", "## 量測（60 天內，新的在前）"]
    for m in ms:
        val = f"{m['value']}/{m['value2']}" if m.get("value2") is not None else f"{m['value']}"
        lines.append(f"- {m['measuredAt']} [{names.get(m['memberId'], m['memberId'])}] {KIND_LABEL.get(m['kind'], m['kind'])} {val}")
    if not ms:
        lines.append("- （沒有）")
    return "\n".join(lines)


def build_prompt(ctx: dict, files: dict[int, Path]) -> str:
    """一件工作的完整提示：家裡的紀錄＋對話＋這次的附圖路徑"""
    parts = ["# 家裡的健康紀錄", build_context_text(ctx), ""]
    if ctx["job"]["kind"] == "rx_scan":
        member = next((m for m in ctx["members"] if m["id"] == ctx["job"].get("memberId")), None)
        parts += ["# 工作：讀藥袋", f"這是 {member['name'] if member else '家人'} 的藥袋／收據。今天是 {ctx['today']}。", SCAN_PROMPT]
        parts += ["照片（用 Read 讀）："] + [f"- {p}" for p in files.values()]
        return "\n".join(parts)
    conv = ctx.get("conversation") or {"messages": []}
    parts.append("# 對話（最後一則是現在要回覆的）")
    for m in conv["messages"]:
        who = "家人" if m["role"] == "user" else "Dr.水獺"
        att = [files[a] for a in m.get("attachmentIds", []) if a in files]
        att_text = "（附圖：" + "、".join(str(p) for p in att) + "，用 Read 看）" if att else ""
        parts.append(f"[{m['createdAt']}] {who}：{m['body']}{att_text}")
    parts += ["", "請先 set_mood，必要時用工具記錄或查紀錄，最後直接寫出給家人的回覆（純文字回覆就是你最後的訊息）。"]
    return "\n".join(parts)


# ---------- 附件 ----------

def prepare_image(raw: bytes, content_type: str, dest: Path) -> Path:
    """存成 AI 讀得到的格式：HEIC 轉 JPEG、太大的圖縮小（省 token、也比較快）；PDF 原樣"""
    if content_type == "application/pdf":
        dest = dest.with_suffix(".pdf")
        dest.write_bytes(raw)
        return dest
    try:
        from io import BytesIO

        from PIL import Image, ImageOps

        if content_type == "image/heic":
            import pillow_heif  # type: ignore

            pillow_heif.register_heif_opener()
        img = ImageOps.exif_transpose(Image.open(BytesIO(raw)))
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        dest = dest.with_suffix(".jpg")
        img.save(dest, "JPEG", quality=88)
        return dest
    except Exception as e:  # noqa: BLE001 — 轉不了就原樣給 AI
        log(f"⚠️ 圖片處理失敗，原檔給 AI：{e}")
        ext = {"image/png": ".png", "image/webp": ".webp", "image/jpeg": ".jpg"}.get(content_type, ".bin")
        dest = dest.with_suffix(ext)
        dest.write_bytes(raw)
        return dest


# ---------- 藥品照片（runner 程式自己做，不經過 AI） ----------

FDA_IMAGE_PREFIX = "https://mcp.fda.gov.tw/"
MAX_SOURCE_BYTES = 40 * 1024 * 1024
PHOTO_CROP_SIDE = 480
PHOTO_FULL_SIDE = 1200


def flatten_image(img):
    """透明背景鋪白、轉 RGB"""
    from PIL import Image

    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, "white")
        bg.alpha_composite(img)
        img = bg
    return img.convert("RGB")


def _components(mask):
    """4 連通的區塊：[(像素數, x0, y0, x1, y1)]"""
    from collections import deque

    import numpy as np

    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    out = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        q = deque([(y0, x0)])
        cnt, minx, maxx, miny, maxy = 0, x0, x0, y0, y0
        while q:
            y, x = q.popleft()
            cnt += 1
            minx, maxx, miny, maxy = min(minx, x), max(maxx, x), min(miny, y), max(maxy, y)
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        out.append((cnt, int(minx), int(miny), int(maxx) + 1, int(maxy) + 1))
    return out


def pill_box(img, side: int = 320):
    """食藥署照片裡藥丸的位置（原圖座標）；找不到回 None。
    照片多半是藥丸＋尺規、背景有漸層：去掉暗而沒顏色的（尺規、字），用平面擬合背景，留下跟背景差很多的區塊，
    再丟掉碰到邊（陰影）、太細（線）、太小（字）的，剩下的框起來。沒裝 numpy 就不裁。"""
    try:
        import numpy as np
        from PIL import Image, ImageFilter
    except ImportError:
        return None
    small = img.copy()
    small.thumbnail((side, side))
    a = np.asarray(small, dtype=float)
    h, w, _ = a.shape
    if h < 20 or w < 20:
        return None
    mx, mn = a.max(-1), a.min(-1)
    lum = a @ np.array([0.299, 0.587, 0.114])
    sat = (mx - mn) / np.maximum(mx, 1)
    ink = (lum < 110) & (sat < 0.3)
    yy, xx = np.mgrid[0:h, 0:w]
    design = np.stack([xx / w, yy / h, np.ones_like(xx, dtype=float)], -1)

    def plane(keep):
        ys, xs = np.nonzero(keep)
        if len(ys) < 50:
            return np.broadcast_to(np.median(a.reshape(-1, 3), 0), a.shape)
        A = design[ys, xs]
        out = np.empty_like(a)
        for ch in range(3):
            coef, *_ = np.linalg.lstsq(A, a[ys, xs, ch], rcond=None)
            out[..., ch] = design @ coef
        return out

    keep = ~ink
    d = np.abs(a - plane(keep)).max(-1)
    keep2 = keep & (d < np.percentile(d[keep], 60))
    dist = np.sqrt(((a - plane(keep2)) ** 2).sum(-1))
    noise = float(np.median(dist[keep2])) if keep2.any() else 5.0
    # 尺規、字的周圍（縮圖後的灰邊）也不算：墨水往外擴幾格
    near_ink = np.asarray(Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    mask = (dist > max(28.0, noise * 4)) & ~near_ink
    m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    mask = np.asarray(m) > 0

    def ok(c):
        cnt, x0, y0, x1, y1 = c
        bw, bh = x1 - x0, y1 - y0
        if cnt < h * w * 0.0008 or min(bw, bh) < 7 or max(bw, bh) / max(1, min(bw, bh)) >= 6:
            return False
        if x0 <= 1 or y0 <= 1 or x1 >= w - 1 or y1 >= h - 1:
            return False
        return bw * bh <= h * w * 0.45

    comps = [c for c in _components(mask) if ok(c)]
    if not comps:
        return None
    # 從最大的一塊開始，只併進夠大、而且離得近的（同一張照片裡的正反面兩顆藥）
    comps.sort(key=lambda c: -c[0])
    main = comps[0]
    reach = max(main[3] - main[1], main[4] - main[2]) * 1.5
    keep_c = [main]
    for c in comps[1:]:
        if c[0] < main[0] * 0.25:
            continue
        gx = max(0, max(c[1], main[1]) - min(c[3], main[3]))
        gy = max(0, max(c[2], main[2]) - min(c[4], main[4]))
        if max(gx, gy) <= reach:
            keep_c.append(c)
    comps = keep_c
    scale = img.width / w
    x0, y0 = min(c[1] for c in comps), min(c[2] for c in comps)
    x1, y1 = max(c[3] for c in comps), max(c[4] for c in comps)
    return (x0 * scale, y0 * scale, x1 * scale, y1 * scale)


def crop_square(img, box, pad: float = 0.18):
    """藥丸外面留一點邊、裁成正方形（碰到邊就往內移）"""
    x0, y0, x1, y1 = box
    side = int(min(max(x1 - x0, y1 - y0) * (1 + pad * 2), img.width, img.height))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left = int(min(max(0, cx - side / 2), img.width - side))
    top = int(min(max(0, cy - side / 2), img.height - side))
    return img.crop((left, top, left + side, top + side))


def jpeg_b64(img, side: int, quality: int) -> str:
    import base64
    from io import BytesIO

    img = img.copy()
    img.thumbnail((side, side))
    buf = BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def fetch_fda_image(url: str) -> bytes:
    if not url.startswith(FDA_IMAGE_PREFIX):
        raise ValueError("只接受食藥署的照片網址")
    req = urllib.request.Request(url, headers={"User-Agent": "family-doctor-runner/1.0"})
    with urllib.request.urlopen(req, timeout=120) as res:  # noqa: S310 — 上面已限定網址
        data = res.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError("原圖太大")
    return data


def make_drug_photo(raw: bytes) -> dict:
    """原圖 → {crop, full, cropped}（base64 JPEG）"""
    from io import BytesIO

    from PIL import Image, ImageOps

    img = flatten_image(ImageOps.exif_transpose(Image.open(BytesIO(raw))))
    box = pill_box(img)
    crop = crop_square(img, box) if box else img
    return {"crop": jpeg_b64(crop, PHOTO_CROP_SIDE, 84), "full": jpeg_b64(img, PHOTO_FULL_SIDE, 80), "cropped": box is not None}


def process_drug_photos(platform: "Platform", fetch=fetch_fda_image) -> int:
    """領排隊中的藥品照片來做；回傳做了幾張"""
    status, body = platform.call("POST", "/drug-photos/claim", {}, timeout=30)
    if status != 200 or not isinstance(body, dict):
        return 0
    done = 0
    for item in body.get("items", []):
        license_no = str(item.get("license", ""))
        url = str(item.get("imageUrl", ""))
        path = "/drug-photos/" + urllib.parse.quote(license_no, safe="")
        try:
            photo = make_drug_photo(fetch(url))
            st, res = platform.call("POST", path, {"sourceUrl": url, **photo}, timeout=120)
            if st != 200:
                raise RuntimeError(f"傳回失敗（{st}）：{err(res)}")
            done += 1
            log(f"藥品照片 {license_no}：{'裁好' if photo['cropped'] else '沒裁（整張）'}")
        except Exception as e:  # noqa: BLE001 — 一張失敗不影響別張
            log(f"⚠️ 藥品照片 {license_no} 失敗：{e}")
            platform.call("POST", path + "/fail", {"error": str(e)[:300]}, timeout=30)
    return done


# ---------- 自動更新（runner 程式自己做，不經過 AI） ----------

REPO_DIR = HERE.parent.parent
UPDATE_EVERY_SECONDS = 300
RUNNER_PATH = "scripts/dr-claude-runner/"


def _git(repo: Path, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})


def self_update(cfg: dict[str, str], repo: Path = REPO_DIR) -> bool:
    """GitHub 的 main 有新版就更新；回傳要不要重新啟動（runner 自己的檔案有變才要）。
    只在 repo 停在 main、沒有改過的檔案、可以快轉時才動；新版的測試沒過（或套件裝不起來）就退回原本那版。"""
    if (cfg.get("FD_AUTO_UPDATE") or "on").strip().lower() in ("off", "0", "false", "no"):
        return False
    try:
        if not (repo / ".git").exists() or _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() != "main":
            return False
        if _git(repo, "status", "--porcelain", "--untracked-files=no").stdout.strip():
            log("自動更新：repo 裡有改過的檔案，先不更新")
            return False
        if _git(repo, "fetch", "--quiet", "origin", "main", timeout=120).returncode != 0:
            log("⚠️ 自動更新：連不上 GitHub，等一下再試")
            return False
        old = _git(repo, "rev-parse", "HEAD").stdout.strip()
        new = _git(repo, "rev-parse", "origin/main").stdout.strip()
        if not new or old == new:
            return False
        if _git(repo, "merge-base", "--is-ancestor", old, new).returncode != 0:
            log("⚠️ 自動更新：本機跟 GitHub 分岔了，不自動更新")
            return False
        changed = [f for f in _git(repo, "diff", "--name-only", old, new).stdout.split() if f.startswith(RUNNER_PATH)]
        if _git(repo, "merge", "--ff-only", "--quiet", new).returncode != 0:
            log("⚠️ 自動更新：快轉失敗")
            return False
        if not changed:
            log(f"自動更新：程式更新到 {new[:7]}（runner 沒變，不用重新啟動）")
            return False
        runner_dir = repo / RUNNER_PATH
        try:
            if RUNNER_PATH + "requirements.txt" in changed:
                subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "-r", str(runner_dir / "requirements.txt")],
                               check=True, timeout=900, capture_output=True)
            subprocess.run([sys.executable, "-m", "unittest", "-q", str(runner_dir / "test_runner.py")],
                           check=True, timeout=300, capture_output=True, cwd=str(repo))
        except (subprocess.SubprocessError, OSError) as e:
            _git(repo, "reset", "--keep", old)
            log(f"⚠️ 自動更新：新版 {new[:7]} 的測試或套件安裝沒過，退回 {old[:7]}（{type(e).__name__}）")
            return False
        log(f"自動更新：runner 更新到 {new[:7]}，重新啟動")
        return True
    except (subprocess.SubprocessError, OSError) as e:
        log(f"⚠️ 自動更新失敗：{e}")
        return False


def restart_self() -> None:
    """換成新版：同一個行程直接重新執行（systemd 看到的還是同一個服務）"""
    os.execv(sys.executable, [sys.executable, *sys.argv])


# ---------- 工具 ----------

class Collector:
    """AI 透過工具留下的東西；做完由這支程式送上系統（伺服器會再檢查）"""

    def __init__(self, member_ids: set[int]):
        self.member_ids = member_ids
        self.actions: list[dict] = []
        self.mood = "calm"
        self.draft: dict | None = None

    def _member(self, raw) -> int:
        mid = int(raw)
        if mid not in self.member_ids:
            raise ValueError(f"沒有編號 {mid} 的家人；家人編號是 {sorted(self.member_ids)}")
        return mid

    def add_note(self, args: dict) -> str:
        body = str(args.get("body") or "").strip()
        if not body:
            raise ValueError("body 不能是空的")
        a = {"type": "note", "memberId": self._member(args.get("memberId")), "body": body[:2000],
             "severity": max(0, min(3, int(args.get("severity") or 0)))}
        if args.get("notedAt"):
            a["notedAt"] = str(args["notedAt"])[:16]
        self.actions.append(a)
        return f"已記下（第 {len(self.actions)} 筆，送出回覆時才會存）"

    def add_measurement(self, args: dict) -> str:
        kind = str(args.get("kind") or "")
        if kind not in KIND_LABEL:
            raise ValueError(f"kind 要是 {list(KIND_LABEL)} 其中之一")
        a = {"type": "measurement", "memberId": self._member(args.get("memberId")), "kind": kind, "value": float(args["value"]),
             "value2": float(args["value2"]) if args.get("value2") not in (None, "", 0) else None, "note": str(args.get("note") or "")[:200]}
        if args.get("measuredAt"):
            a["measuredAt"] = str(args["measuredAt"])[:16]
        self.actions.append(a)
        return "已記下量測（送出回覆時才會存）"

    def propose_visit(self, args: dict) -> str:
        draft = parse_draft(args.get("draft_json"))
        self.actions.append({"type": "visit_draft", "memberId": self._member(args.get("memberId")), "draft": draft})
        return "草稿已附在回覆下方，家人確認後才會存。回覆裡請請他們核對藥名與天數。"

    def submit_draft(self, args: dict) -> str:
        self.draft = parse_draft(args.get("draft_json"))
        return "收到草稿。"

    def set_mood(self, args: dict) -> str:
        mood = str(args.get("mood") or "calm")
        if mood not in ("calm", "happy", "concerned", "urgent"):
            raise ValueError("mood 要是 calm／happy／concerned／urgent")
        self.mood = mood
        return f"表情：{mood}"


DRAFT_KEYS = ("visitDate", "clinic", "department", "doctor", "reason", "diagnosis", "advice", "followUpDate", "copay", "medications", "uncertain")
MED_KEYS = ("name", "genericName", "category", "purpose", "appearance", "dose", "slots", "timing", "asNeeded", "days", "mustFinish", "cautions")


def parse_draft(raw) -> dict:
    """AI 給的草稿 JSON → 只留認得的欄位（伺服器會再檢查格式）"""
    data = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(data, dict):
        raise ValueError("draft_json 要是 JSON 物件")
    draft = {k: data[k] for k in DRAFT_KEYS if k in data}
    if not draft.get("visitDate"):
        raise ValueError("visitDate 必填（YYYY-MM-DD）")
    meds = []
    for m in data.get("medications") or []:
        if isinstance(m, dict) and m.get("name"):
            med = {k: m[k] for k in MED_KEYS if k in m and m[k] is not None}
            med["slots"] = [s for s in med.get("slots", []) if s in SLOT_LABEL]
            meds.append(med)
    draft["medications"] = meds
    draft["uncertain"] = [str(x)[:200] for x in (data.get("uncertain") or [])][:20]
    return draft


DRAFT_SCHEMA_HINT = (
    '{"visitDate":"YYYY-MM-DD","clinic":"","department":"","doctor":"","reason":"","diagnosis":"","advice":"",'
    '"followUpDate":null,"copay":null,"medications":[{"name":"","genericName":"","category":"","purpose":"","appearance":"",'
    '"dose":"1 顆","slots":["morning","noon","evening"],"timing":"after","asNeeded":false,"days":3,"mustFinish":false,"cautions":""}],'
    '"uncertain":[]}'
)


STR = {"type": "string"}
INT = {"type": "integer"}
NUM = {"type": "number"}
# 選填的參數：AI 常會傳 null
STR_N = {"type": ["string", "null"]}
INT_N = {"type": ["integer", "null"]}
NUM_N = {"type": ["number", "null"]}


def schema(props: dict, required: list[str]) -> dict:
    """工具參數的 JSON Schema（SDK 的簡寫會把每個參數都當必填）"""
    return {"type": "object", "properties": props, "required": required}


def fd_tools(collector: Collector, platform: Platform, kind: str):
    from claude_agent_sdk import create_sdk_mcp_server, tool

    def ok(text: str):
        return {"content": [{"type": "text", "text": text}]}

    def guarded(fn):
        async def run(args):
            try:
                return ok(fn(args))
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
                return {"content": [{"type": "text", "text": f"參數有誤：{e}"}], "is_error": True}
        return run

    tools = [
        tool("set_mood", "設定 3D 海獺醫生的表情：calm／happy／concerned／urgent",
             schema({"mood": {"type": "string", "enum": ["calm", "happy", "concerned", "urgent"]}}, ["mood"]))(guarded(collector.set_mood)),
    ]
    if kind == "rx_scan":
        tools.append(tool("submit_draft", f"交出藥袋整理好的看診＋用藥草稿。draft_json 格式：{DRAFT_SCHEMA_HINT}",
                          schema({"draft_json": STR}, ["draft_json"]))(guarded(collector.submit_draft)))
        return create_sdk_mcp_server("fd", tools=tools)

    async def search(args):
        try:
            data = await asyncio.to_thread(platform.records, int(args["memberId"]) if args.get("memberId") else None,
                                           str(args.get("from") or ""), str(args.get("to") or ""))
            return ok(json.dumps(data, ensure_ascii=False)[:60000])
        except (RuntimeError, ValueError) as e:
            return {"content": [{"type": "text", "text": f"查不到：{e}"}], "is_error": True}

    tools += [
        tool("record_health_note", "記一筆身體狀況日記（只記使用者說的事實）。severity 0 沒填、1 輕、2 中、3 重；notedAt 選填 'YYYY-MM-DD HH:MM'（預設現在）",
             schema({"memberId": INT, "body": STR, "severity": {"type": ["integer", "null"], "minimum": 0, "maximum": 3}, "notedAt": STR_N},
                    ["memberId", "body"]))(guarded(collector.add_note)),
        tool("record_measurement", f"記一筆量測。kind：{', '.join(f'{k}={v}' for k, v in KIND_LABEL.items())}；measuredAt 選填 'YYYY-MM-DD HH:MM'",
             schema({"memberId": INT, "kind": {"type": "string", "enum": list(KIND_LABEL)}, "value": NUM, "value2": NUM_N, "measuredAt": STR_N, "note": STR_N},
                    ["memberId", "kind", "value"]))(guarded(collector.add_measurement)),
        tool("propose_visit", f"把一次看診整理成草稿給家人確認（不會直接存）。draft_json 格式：{DRAFT_SCHEMA_HINT}",
             schema({"memberId": INT, "draft_json": STR}, ["memberId", "draft_json"]))(guarded(collector.propose_visit)),
        tool("search_records", "查更早的紀錄（看診、用藥、日記、量測）。memberId 選填（不給＝全家）；from、to 是 YYYY-MM-DD",
             schema({"memberId": INT_N, "from": STR, "to": STR}, ["from", "to"]))(search),
    ]
    return create_sdk_mcp_server("fd", tools=tools)


def agent_options(cfg: dict[str, str], kind: str, job_dir: Path) -> dict:
    """ClaudeAgentOptions 的參數（拆出來是為了不裝 SDK 也能測）"""
    names = ["set_mood"] + (["submit_draft"] if kind == "rx_scan" else ["record_health_note", "record_measurement", "propose_visit", "search_records"])
    settings = {"permissions": {"deny": ["Read(~/.config/**)", "Read(~/.ssh/**)", "Read(~/.claude/**)", "Read(~/.aws/**)", "Read(/etc/**)"]}}
    model = (cfg.get("FD_SCAN_MODEL") or "claude-opus-5-5") if kind == "rx_scan" else (cfg.get("FD_CHAT_MODEL") or "claude-sonnet-5-5")
    return dict(
        model=model,
        effort=cfg.get("FD_EFFORT") or "medium",
        cwd=str(job_dir),
        setting_sources=[],  # 不載入這台機器上任何 Claude Code 設定（MCP、hooks、CLAUDE.md）
        system_prompt=SYSTEM_PROMPT,
        allowed_tools=["Read"] + [TOOL_PREFIX + n for n in names],
        permission_mode="dontAsk",
        settings=json.dumps(settings),
        max_budget_usd=float(cfg.get("FD_MAX_BUDGET_USD") or 1.5),
        max_buffer_size=MAX_MESSAGE_BYTES,
        env={
            "ANTHROPIC_API_KEY": cfg["FD_ANTHROPIC_API_KEY"],
            "DISABLE_AUTOUPDATER": "1",
            "CLAUDE_AGENT_SDK_CLIENT_APP": USER_AGENT,
        },
    )


async def run_agent(cfg: dict[str, str], platform: Platform, ctx: dict, files: dict[int, Path], job_dir: Path) -> tuple[Collector, dict]:
    from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, TextBlock, query

    kind = ctx["job"]["kind"]
    collector = Collector({m["id"] for m in ctx["members"]})
    opts = agent_options(cfg, kind, job_dir)
    opts["mcp_servers"] = {"fd": fd_tools(collector, platform, kind)}
    result: dict = {"subtype": "no_result", "cost": None, "text": ""}
    last_text = ""
    async for m in query(prompt=build_prompt(ctx, files), options=ClaudeAgentOptions(**opts)):
        if isinstance(m, AssistantMessage):
            texts = [b.text for b in m.content if isinstance(b, TextBlock) and b.text.strip()]
            if texts:
                last_text = "\n".join(texts)
        if isinstance(m, ResultMessage):
            result = {"subtype": "error" if m.is_error and m.subtype == "success" else m.subtype, "cost": m.total_cost_usd,
                      "text": (m.result or last_text or "").strip()}
    return collector, result


def handle(cfg: dict[str, str], platform: Platform, job: dict) -> str:
    job_id = job["id"]
    job_dir = Path(tempfile.mkdtemp(prefix=f"fd-job-{job_id}-"))
    os.chmod(job_dir, 0o700)
    try:
        ctx = platform.context(job_id)
        files: dict[int, Path] = {}
        if ctx.get("attachments"):
            platform.progress(job_id, "reading")
        for a in ctx.get("attachments", []):
            raw = platform.download(job_id, a["id"])
            files[a["id"]] = prepare_image(raw, a["contentType"], job_dir / f"file-{a['id']}")
        platform.progress(job_id, "thinking")
        timeout = float(cfg.get("FD_TIMEOUT_MIN") or 6) * 60
        try:
            collector, result = asyncio.run(asyncio.wait_for(run_agent(cfg, platform, ctx, files, job_dir), timeout))
        except asyncio.TimeoutError:
            platform.fail(job_id, "Dr.水獺 想太久了（超過時間上限），請再試一次或把問題講短一點")
            return "失敗（逾時）"
        cost = result.get("cost")
        if result["subtype"] not in ("success",):
            note = "花費到上限" if "budget" in str(result["subtype"]) else result["subtype"]
            platform.fail(job_id, f"Dr.水獺 這次沒有回完（{note}），請再試一次")
            return f"失敗（{note}）"
        platform.progress(job_id, "writing")
        if ctx["job"]["kind"] == "rx_scan":
            if not collector.draft:
                platform.fail(job_id, "照片讀不出藥袋內容，請拍清楚一點（整張藥袋、不要反光）再試")
                return "失敗（沒有草稿）"
            payload = {"draft": collector.draft, "costUsd": cost}
        else:
            reply = result["text"]
            if not reply:
                platform.fail(job_id, "Dr.水獺 沒有寫出回覆，請再試一次")
                return "失敗（沒有回覆）"
            payload = {"reply": reply, "mood": collector.mood, "actions": collector.actions, "costUsd": cost}
        status, body = platform.complete(job_id, payload)
        if status == 409:
            return "已取消（使用者取消了）"
        if status != 200:
            # 伺服器檢查沒過（例：量測數字離譜）→ 不帶紀錄再送一次回覆，讓家人至少看得到
            if ctx["job"]["kind"] == "chat" and collector.actions:
                status2, body2 = platform.complete(job_id, {**payload, "actions": [],
                                                            "reply": payload["reply"] + f"\n\n（這次要幫你記的東西沒存成功：{err(body)}，請自己再記一次）"})
                if status2 == 200:
                    return f"完成（紀錄沒存：{err(body)[:80]}）"
            platform.fail(job_id, f"回覆送不上系統（{status}）：{err(body)}")
            return f"失敗（送出 {status}）"
        return f"完成（US${cost or 0:.3f}，記錄 {len(payload.get('actions', []))} 筆）"
    except Exception as e:  # noqa: BLE001
        platform.fail(job_id, f"Dr.水獺 服務出了問題：{e}")
        return f"失敗（{type(e).__name__}: {e}）"
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def check(cfg: dict[str, str], platform: Platform) -> bool:
    ok = True
    status, body = platform.call("POST", "/jobs/claim?wait=0", {})
    if status in (200, 204):
        log("✓ 系統登入成功（服務憑證）" + ("，而且有一件工作在排隊，已經領走了——請到畫面上按「再試一次」" if status == 200 else ""))
        if status == 200 and isinstance(body, dict):
            platform.fail(int(body["id"]), "檢查設定時領走了，請再試一次")
    else:
        log(f"✗ 系統登入失敗（{status}）：{err(body)}")
        ok = False
    try:
        import claude_agent_sdk

        log(f"✓ Claude Agent SDK {claude_agent_sdk.__version__}")
    except ImportError:
        log("✗ 沒裝 claude-agent-sdk（.venv/bin/pip install -r requirements.txt）")
        ok = False
    try:
        import PIL  # noqa: F401

        log("✓ Pillow（縮圖、HEIC 轉檔、藥品照片）")
    except ImportError:
        log("⚠️ 沒裝 Pillow：照片會原樣給 AI，藥品照片也做不了")
    try:
        import numpy  # noqa: F401

        log("✓ numpy（藥品照片自動裁到藥丸）")
    except ImportError:
        log("⚠️ 沒裝 numpy：藥品照片不會自動裁切（.venv/bin/pip install -r requirements.txt）")
    key = cfg["FD_ANTHROPIC_API_KEY"]
    req = urllib.request.Request("https://api.anthropic.com/v1/models?limit=1",
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            log(f"✓ API key 可以用（{res.status}）")
    except urllib.error.HTTPError as e:
        log(f"✗ API key 不能用（{e.code}）")
        ok = False
    except OSError as e:
        log(f"✗ 連不上 Anthropic API：{e}")
        ok = False
    if (cfg.get("FD_AUTO_UPDATE") or "on").strip().lower() in ("off", "0", "false", "no"):
        log("⚠️ 自動更新關掉了（FD_AUTO_UPDATE=off）：程式改了要自己 git pull、重啟")
    elif _git(REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() != "main":
        log("⚠️ repo 沒有停在 main：不會自動更新")
    elif _git(REPO_DIR, "ls-remote", "--exit-code", "origin", "main", timeout=60).returncode != 0:
        log("⚠️ 連不到 GitHub（git ls-remote）：不會自動更新，檢查 gh auth login")
    else:
        log("✓ 自動更新：每 5 分鐘看 GitHub 的 main，有新版就更新、測試過了才換")
    for v in AUTH_VARS:
        if os.environ.get(v):
            log(f"⚠️ 環境變數 {v} 有值：服務只用設定檔的 FD_ANTHROPIC_API_KEY（會覆蓋掉），但請確認不是你不小心設的")
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description="Dr.Claude 服務（家庭醫生）")
    ap.add_argument("--env", type=Path, default=DEFAULT_ENV_FILE)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    cfg = load_config(args.env)
    for v in AUTH_VARS:
        os.environ.pop(v, None)
    platform = Platform(cfg.get("FD_BASE_URL") or DEFAULT_BASE, cfg["FD_AGENT_CLIENT_ID"], cfg["FD_AGENT_CLIENT_SECRET"])
    if args.check:
        sys.exit(0 if check(cfg, platform) else 1)

    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True
        log("收到停止訊號，做完這件就停")

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log(f"Dr.Claude 服務啟動：{platform.base}")
    backoff = 5
    last_update_check = 0.0
    while not stopping:
        if not args.once and time.time() - last_update_check >= UPDATE_EVERY_SECONDS:
            last_update_check = time.time()
            if self_update(cfg):
                restart_self()
        try:
            process_drug_photos(platform)
        except Exception as e:  # noqa: BLE001 — 照片出錯不能卡住 Dr.Claude
            log(f"⚠️ 藥品照片：{e}")
        try:
            job = platform.claim(0 if args.once else CLAIM_WAIT_SECONDS)
        except RuntimeError as e:
            log(f"⚠️ {e}；{backoff} 秒後再試")
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)
            continue
        backoff = 5
        if job is None:
            if args.once:
                log("沒有排隊中的工作")
                return
            continue
        started = time.time()
        outcome = handle(cfg, platform, job)
        log(f"工作 #{job['id']}（{job['kind']}）：{outcome}，{time.time() - started:.0f} 秒")
        if args.once:
            return


if __name__ == "__main__":
    main()
