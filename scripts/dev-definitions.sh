#!/usr/bin/env bash
# `definitions` for local development (engine 02 §4.1, 09 M2).
#
# One bare repository per organization under a root outside the checkout, so a
# `git clean` cannot take the definition plane with it, and so the same root
# survives a rebuild. Nothing here writes to a hosted database: the service's
# only Postgres is `api`'s, reached over HTTP.
#
#   scripts/dev-definitions.sh
#
# `npm run dev` starts it as `[definitions]`. It runs `dist/` under
# `node --watch-path`, so a rebuild of `engine/definitions` or `engine/compose`
# relaunches it by itself — the policy rules it validates with are compiled
# in, and a stale service refused every write that carried a new shape
# (build-log, Wave 6). `backend/.env` needs `DEFINITIONS_URL=http://127.0.0.1:8402`, without
# which every org, team and user creation is refused (`definitions_unconfigured`,
# `app/domain/definitions_client.py`) — fail closed is the point, not a bug.
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The repositories and the socket live under the developer's home, never in the
# checkout: `DEFINITIONS_ROOT` is durable state and the checkout is not.
export DEFINITIONS_ROOT="${DEFINITIONS_ROOT:-$HOME/.harness-dev/definitions}"
export DEFINITIONS_SOCK="${DEFINITIONS_SOCK:-$HOME/.harness-dev/definitions.sock}"
# 02 §6.3: the hooks are the service's, outside any repository, and are set per
# process by the transport — never written into a repo's config.
export DEFINITIONS_HOOKS="${DEFINITIONS_HOOKS:-$root_dir/engine/definitions/dist/hooks}"
export DEFINITIONS_LISTEN="${DEFINITIONS_LISTEN:-127.0.0.1:${DEFINITIONS_PORT:-8402}}"
# `api` on its development port. Overridable, because the cutover dry run
# points the service at a second `api` on 8401 backed by a scratch database.
export API_URL="${API_URL:-http://127.0.0.1:8400}"

# D42: the shared bearer both sides hold. `backend/.env` is where the
# development value lives, so there is one copy of it and no default here.
if [[ -z "${HARNESS_SERVICE_TOKEN:-}" && -f "$root_dir/backend/.env" ]]; then
  HARNESS_SERVICE_TOKEN="$(sed -n 's/^HARNESS_SERVICE_TOKEN=//p' "$root_dir/backend/.env" | tail -1)"
  export HARNESS_SERVICE_TOKEN
fi
if [[ -z "${HARNESS_SERVICE_TOKEN:-}" ]]; then
  echo "HARNESS_SERVICE_TOKEN is not set and backend/.env does not carry it (02 §4.1)." >&2
  exit 1
fi

if [[ ! -f "$root_dir/engine/definitions/dist/index.js" ]]; then
  echo "engine/definitions is not built: npm run build -w engine/compose -w engine/definitions" >&2
  exit 1
fi

mkdir -p "$DEFINITIONS_ROOT" "$(dirname "$DEFINITIONS_SOCK")"
echo "definitions: $DEFINITIONS_LISTEN  root=$DEFINITIONS_ROOT  api=$API_URL"

# `scripts/dev-definitions.mjs` is the three-line entry (`dist/index.js` only
# exports `start`). `--watch-path` relaunches it when either build output
# changes; `start` clears the socket first, so a relaunch binds cleanly.
exec node --watch-path="$root_dir/engine/definitions/dist" \
          --watch-path="$root_dir/engine/compose/dist" \
          --watch-preserve-output \
          "$root_dir/scripts/dev-definitions.mjs"
