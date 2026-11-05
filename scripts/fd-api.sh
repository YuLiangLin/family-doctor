#!/usr/bin/env bash
# 用 API token 呼叫家庭醫生的 API（Claude Code 雲端環境查問題、照 Nathan 的指示幫忙記錄）。
# token：環境變數 FD_API_TOKEN（設定頁「API token」建的，只在建立時顯示一次；不要寫進檔案、repo、PR）。
# 環境用 Network secrets 自動帶標頭的話，可以不設 FD_API_TOKEN。
#
# 用法：
#   scripts/fd-api.sh GET /today
#   scripts/fd-api.sh GET '/timeline?days=30'
#   scripts/fd-api.sh POST /notes '{"memberId":1,"notedAt":"2026-11-05 09:10","body":"咳嗽","severity":1}'
# 輸出：回應內容，最後一行是 HTTP 狀態碼。
set -euo pipefail
BASE="${FD_BASE_URL:-https://doctor.nathantw.com}"
method="${1:?用法：fd-api.sh METHOD /path [JSON]}"
path="${2:?缺 API 路徑，例：/today}"
body="${3:-}"

args=(-sS -X "$method" -H 'X-Requested-With: XMLHttpRequest' -w '\n%{http_code}\n')
[ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data "$body")
if [ -n "${FD_API_TOKEN:-}" ]; then
  # token 從 stdin 給 curl，不會出現在指令列（ps 看不到）
  printf 'Authorization: Bearer %s\n' "$FD_API_TOKEN" | curl "${args[@]}" -H @- "$BASE/api${path}"
else
  curl "${args[@]}" "$BASE/api${path}"
fi
