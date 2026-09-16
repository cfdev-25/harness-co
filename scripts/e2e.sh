#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
# shellcheck disable=SC1091
source "$ROOT/backend/.env"
set +a

: "${DATABASE_URL:?}"
: "${HARNESS_MASTER_KEY:?}"
: "${SUPABASE_URL:?}"
: "${SUPABASE_SERVICE_ROLE_KEY:?}"
: "${SEED_USER_PASSWORD:?}"

TMP_HOME="$(mktemp -d)"
PIDS=()

cleanup() {
  local code=$?
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$TMP_HOME"
  exit "$code"
}
trap cleanup EXIT INT TERM

seed_output="$(
  "$ROOT/backend/.venv/bin/python" "$ROOT/backend/supabase/seed/seed_dev.py"
)"
ANA_PAT="$(printf '%s\n' "$seed_output" | awk -F= '/^ANA_PAT=/{print $2}')"
test -n "$ANA_PAT"

"$ROOT/backend/.venv/bin/uv" run --project "$ROOT/backend" \
  uvicorn app.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 8400 \
  >"$TMP_HOME/backend.log" 2>&1 &
PIDS+=("$!")
node "$ROOT/scripts/mock-provider/server.mjs" >"$TMP_HOME/provider.log" 2>&1 &
PIDS+=("$!")

until curl -fsS http://127.0.0.1:8400/health >/dev/null; do sleep 0.2; done

export HARNESS_HOME="$TMP_HOME/harness"
printf '%s\n' "$ANA_PAT" | node "$ROOT/pi/packages/harness-cli/dist/cli.js" \
  login --api-url http://127.0.0.1:8400

run_output="$(
  node "$ROOT/pi/packages/harness-cli/dist/cli.js" run -p \
    "Read the AGENTS.md rules and say hello as instructed"
)"
printf '%s\n' "$run_output" | grep -q 'MOCK_PROVIDER_OK'

test "$(psql "$DATABASE_URL" -Atc "select count(*) from harness_sessions where status='closed'")" -ge 1
test "$(psql "$DATABASE_URL" -Atc "select count(*) from audit_log where class='authoritative' and action='resolve'")" -ge 1

echo "Golden end-to-end flow passed."
