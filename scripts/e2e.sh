#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="harness-co-e2e-postgres"
DATABASE_URL="${HARNESS_E2E_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5433/harness_test}"
MASTER_KEY="AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
TMP_HOME="$(mktemp -d)"
PIDS=()
USE_DOCKER=1
if [[ -n "${HARNESS_E2E_DATABASE_URL:-}" ]]; then USE_DOCKER=0; fi

cleanup() {
  local code=$?
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  if [[ "$USE_DOCKER" == "1" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_HOME"
  exit "$code"
}
trap cleanup EXIT INT TERM

if [[ "$USE_DOCKER" == "1" ]]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run --rm -d --name "$CONTAINER" \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=harness_test \
    -p 5433:5432 postgres:15 >/dev/null

  until docker exec "$CONTAINER" pg_isready -U postgres -d harness_test >/dev/null 2>&1; do
    sleep 1
  done
else
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -c 'drop schema public cascade; create schema public;' >/dev/null
fi

for migration in "$ROOT"/backend/supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

seed_output="$(
  DATABASE_URL="$DATABASE_URL" HARNESS_MASTER_KEY="$MASTER_KEY" \
    "$ROOT/backend/.venv/bin/python" "$ROOT/backend/supabase/seed/seed_dev.py"
)"
ANA_PAT="$(printf '%s\n' "$seed_output" | awk -F= '/^ANA_PAT=/{print $2}')"
test -n "$ANA_PAT"

DATABASE_URL="$DATABASE_URL" HARNESS_MASTER_KEY="$MASTER_KEY" HARNESS_ENV=test \
  "$ROOT/backend/.venv/bin/uv" run --project "$ROOT/backend" \
  uvicorn app.main:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port 8400 \
  >"$TMP_HOME/backend.log" 2>&1 &
PIDS+=("$!")
node "$ROOT/scripts/mock-provider/server.mjs" >"$TMP_HOME/provider.log" 2>&1 &
PIDS+=("$!")

until curl -fsS http://127.0.0.1:8400/health >/dev/null; do sleep 0.2; done
until curl -fsS http://127.0.0.1:8401/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"mock-model","messages":[{"role":"user","content":"ready"}]}' >/dev/null; do
  sleep 0.2
done

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
test "$(psql "$DATABASE_URL" -Atc "select count(*) from audit_log where class='authoritative' and action='api_key.deliver'")" -ge 1
test "$(psql "$DATABASE_URL" -Atc "select count(*) from audit_log where class='attested' and action='tool.call'")" -ge 1

ANA_UNIT="$(
  psql "$DATABASE_URL" -Atc \
    "select m.user_unit_id from org_unit_members m join org_units u on u.id=m.user_unit_id where u.name='ana@acme.test'"
)"
verify="$(
  curl -fsS "http://127.0.0.1:8400/v1/org-units/$ANA_UNIT/audit/verify" \
    -H "Authorization: Bearer $ANA_PAT"
)"
printf '%s\n' "$verify" | grep -q '"intact":true'

echo "Golden end-to-end flow passed."
