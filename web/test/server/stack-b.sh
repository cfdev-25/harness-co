#!/usr/bin/env bash
# Stack B — the screens-group-B local backbone (02 rule 30, D22).
#
# The same recipe as the cutover dry run (backend/app/migration/cutover.md §3.4)
# on ports nobody else holds, so two people can drive the console at once:
#
#   api 8421 · definitions 8422 · web 3021
#
# over the scratch database `harness_cutover_dryrun` — the mirrored development
# records, never the hosted ones — and its own copy of the definition root, so
# a push here cannot touch another stack's repositories.
#
#   bash web/test/server/stack-b.sh up     # start, wait, print the cookie
#   bash web/test/server/stack-b.sh sync   # re-clone the source dirs into it
#   bash web/test/server/stack-b.sh down   # stop everything it started
#   bash web/test/server/stack-b.sh env    # print STACK_B_URL / STACK_B_COOKIE
#
# Next 16 refuses a second `next dev` in a project directory that already holds
# one (its `build/lockfile.ts`), and port 3000's server was already up. So the
# web half runs from an APFS copy-on-write clone of `web/` under `$run/web` —
# instant, and 539 MB of shared blocks — and `sync` rsyncs the source
# directories into it before a run. Nothing in the checkout moves.
#
# Authentication is a **PAT-backed cookie**: `api` accepts an `hpat_` bearer
# (`app/identity.py`), and `lib/token.server.ts` hands `lib/api.ts` whatever
# `supabase.auth.getSession()` returns, so the session cookie is written with
# the PAT as its `access_token`. No Supabase password is needed and no console
# code changes; `middleware.ts`'s `getSession()` refreshes only an expired
# session, and this one is written unexpired, which is exactly what is wanted.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
run="${HOME}/.harness-dev/stack-b"
scratch="${SCRATCH_DSN:-postgresql://127.0.0.1:5432/harness_cutover_dryrun}"
api_port=8421
definitions_port=8422
web_port=3021
org="${STACK_B_ORG:-b120b8d0-0f44-4939-abad-f66a6df2035b}"

mkdir -p "$run"

supabase_url="$(sed -n 's/^NEXT_PUBLIC_SUPABASE_URL=//p' "$root/web/.env" | tail -1)"
project="$(printf '%s' "$supabase_url" | sed -E 's#^https?://##; s#\..*$##')"

token_of() {
  # One PAT for the one member of the scratch org; minted once and reused, so
  # a restart does not invalidate a browser session already holding it.
  local existing raw hash
  existing="$(cat "$run/pat" 2>/dev/null || true)"
  if [[ -n "$existing" ]]; then printf '%s' "$existing"; return; fi
  raw="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
  hash="$(printf '%s' "$raw" | shasum -a 256 | cut -d' ' -f1)"
  psql "$scratch" -qtAc "insert into personal_access_tokens(auth_user_id, token_hash, name)
      select auth_user_id, '$hash', 'stack-b' from org_unit_members limit 1" >/dev/null
  printf 'hpat_%s' "$raw" | tee "$run/pat"
}

cookie_of() {
  # `@supabase/ssr` stores the session as `base64-` + base64(JSON).
  STACK_B_PAT="$1" python3 -c '
import base64, json, os, time
session = {
    "access_token": os.environ["STACK_B_PAT"],
    "refresh_token": "stack-b",
    "token_type": "bearer",
    "expires_in": 31536000,
    "expires_at": int(time.time()) + 31536000,
    "user": {"id": "3f29b349-aaef-43db-9096-c4fe2758e3cb",
             "aud": "authenticated", "role": "authenticated",
             "email": "corbfurrer@gmail.com", "app_metadata": {}, "user_metadata": {}},
}
print("base64-" + base64.b64encode(json.dumps(session).encode()).decode().rstrip("="))
'
}

wait_for() {
  local url="$1" name="$2" tries=0
  until curl -fsS "$url" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [[ $tries -gt 180 ]] && { echo "stack-b: $name never came up ($url)" >&2; exit 1; }
    sleep 1
  done
}

sync_web() {
  if [[ ! -d "$run/web" ]]; then
    cp -Rc "$root/web" "$run/web"
    rm -rf "$run/web/.next" "$run/web/test/components/.cache"
    # Turbopack refuses a project root that does not contain everything it
    # resolves, and the clone's `next.config.ts` pins the root to itself.
    python3 -c 'import pathlib,sys
p = pathlib.Path(sys.argv[1])
p.write_text(p.read_text().replace("turbopack: { root: __dirname },",
                                   "turbopack: { root: \"%s\" }," % p.parent))' \
      "$run/web/next.config.ts"
  else
    local dir
    for dir in app lib content test; do
      rsync -rlp --delete --no-times --exclude ".cache" "$root/web/$dir/" "$run/web/$dir/"
    done
  fi
}

start() {
  [[ -d "$run/definitions" ]] || cp -Rc "$HOME/.harness-dev/definitions" "$run/definitions"

  set -a; . "$root/backend/.env"; set +a
  export DATABASE_URL="$scratch"
  export DEFINITIONS_URL="http://127.0.0.1:${definitions_port}"
  (cd "$root/backend" && exec .venv/bin/uvicorn app.main:app \
      --host 127.0.0.1 --port "$api_port") >"$run/api.log" 2>&1 &
  echo $! >"$run/api.pid"

  DEFINITIONS_ROOT="$run/definitions" DEFINITIONS_SOCK="$run/definitions.sock" \
  DEFINITIONS_LISTEN="127.0.0.1:${definitions_port}" \
  API_URL="http://127.0.0.1:${api_port}" \
    bash "$root/scripts/dev-definitions.sh" >"$run/definitions.log" 2>&1 &
  echo $! >"$run/definitions.pid"

  wait_for "http://127.0.0.1:${api_port}/health" api

  sync_web
  (cd "$run/web" && HARNESS_API_ORIGIN="http://127.0.0.1:${api_port}" \
      exec npx next dev --port "$web_port") >"$run/web.log" 2>&1 &
  echo $! >"$run/web.pid"
  wait_for "http://127.0.0.1:${web_port}/console/how" web
  env_
}

env_() {
  local pat; pat="$(token_of)"
  echo "STACK_B_URL=http://127.0.0.1:${web_port}"
  echo "STACK_B_API=http://127.0.0.1:${api_port}"
  echo "STACK_B_PAT=${pat}"
  echo "STACK_B_COOKIE_NAME=sb-${project}-auth-token"
  echo "STACK_B_COOKIE=$(cookie_of "$pat")"
}

stop() {
  local name port
  for name in web definitions api; do
    if [[ -f "$run/$name.pid" ]]; then
      pkill -TERM -P "$(cat "$run/$name.pid")" 2>/dev/null || true
      kill -TERM "$(cat "$run/$name.pid")" 2>/dev/null || true
      rm -f "$run/$name.pid"
    fi
  done
  for port in "$web_port" "$definitions_port" "$api_port"; do
    lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | xargs -r kill -TERM 2>/dev/null || true
  done
}

case "${1:-up}" in
  up) start ;;
  sync) sync_web ;;
  down) stop ;;
  env) env_ ;;
  reindex)
    set -a; . "$root/backend/.env"; set +a
    curl -fsS -X POST -H "Authorization: Bearer $HARNESS_SERVICE_TOKEN" \
      "http://127.0.0.1:${definitions_port}/internal/reindex/${org}" && echo ;;
  *) echo "usage: stack-b.sh [up|sync|down|env|reindex]" >&2; exit 2 ;;
esac
