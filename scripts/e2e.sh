#!/usr/bin/env bash
# 本機冒煙測試：乾淨的本機資料庫 → 起 wrangler dev → 建假資料、截圖（scripts/e2e.mjs）→ 關掉
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
[ -d dist/client ] || npm run build
rm -rf .wrangler/state
npx wrangler d1 migrations apply DB --local >/dev/null
npx wrangler dev --port 8787 > e2e-server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:8787/api/me >/dev/null 2>&1 && break; sleep 1; done
node scripts/e2e.mjs
