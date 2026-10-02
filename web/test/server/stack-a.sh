#!/usr/bin/env bash
# The local stack for the harness-family and Sessions screens (console 02
# rule 30, V3/D22): the real `api` over a real `definitions` over the scratch
# Postgres that carries the exported development organization. No mock of
# `api` exists anywhere in it, because a console that passes against a mock
# proves nothing about the backbone it exists to test.
#
#   bash web/test/server/stack-a.sh start     # definitions 8412, api 8411, next 3011
#   bash web/test/server/stack-a.sh seed      # index + session/request records
#   bash web/test/server/stack-a.sh cookie    # print the Playwright storage state path
#   bash web/test/server/stack-a.sh stop
#
# Distinct ports and a private definitions root, so it never shares a
# repository root or a port with another agent's stack or with `npm run dev`
# (8400/8402/3000).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
run="${STACK_A_RUN:-$HOME/.harness-dev/stack-a}"

export STACK_A_DSN="${STACK_A_DSN:-postgresql://127.0.0.1:5432/harness_stack_a}"
export STACK_A_API="${STACK_A_API:-http://127.0.0.1:8411}"
export STACK_A_DEFINITIONS="${STACK_A_DEFINITIONS:-http://127.0.0.1:8412}"
export STACK_A_URL="${STACK_A_URL:-http://127.0.0.1:3011}"
definitions_root="${STACK_A_DEFINITIONS_ROOT:-$run/definitions}"
source_root="${HARNESS_DEFINITIONS_ROOT:-$HOME/.harness-dev/definitions}"

mkdir -p "$run"

# `api`'s keys, and the service bearer `definitions` and the reindex share.
set -a
# shellcheck disable=SC1091
. "$root/backend/.env"
set +a
export DATABASE_URL="$STACK_A_DSN"
export DEFINITIONS_URL="$STACK_A_DEFINITIONS"

log() { printf '[stack-a] %s\n' "$*" >&2; }

# Next 16 takes an exclusive lock on `<projectDir>/.next/dev` and refuses a
# second `next dev` in the same directory, and `distDir` is only settable in
# `next.config.ts`, which this task does not own. So the stack runs the same
# sources from a second project directory with its own `.next` — inside the
# repository root, because Turbopack refuses a project outside its root, and
# under `.claude/worktrees/`, which the repository already ignores. `app`,
# `lib` and `content` are copied rather than symlinked: Turbopack resolves a
# symlinked app directory to its real path and then matches no route.
web_dir="$root/.claude/worktrees/stack-a-web"

sync_web() {
  mkdir -p "$web_dir"
  for link in node_modules public next-env.d.ts; do
    [[ -e "$web_dir/$link" ]] || ln -s "$root/web/$link" "$web_dir/$link"
  done
  rsync -a --delete "$root/web/app" "$root/web/lib" "$root/web/content" "$web_dir/"
  cp "$root/web/package.json" "$root/web/tsconfig.json" "$root/web/postcss.config.mjs" \
     "$root/web/.env" "$root/web/middleware.ts" "$web_dir/"
  # The dev indicator overlays the sidebar in a screenshot, and this copy is
  # only ever a test server, so it is turned off here and nowhere else.
  sed -e "s#turbopack: { root: __dirname }#turbopack: { root: \"$root\" }, devIndicators: false#" \
    "$root/web/next.config.ts" >"$web_dir/next.config.ts"
}

wait_for() {
  local url="$1" name="$2" tries=0
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    tries=$((tries + 1))
    [[ $tries -gt 120 ]] && { log "$name did not answer at $url"; return 1; }
    sleep 0.5
  done
  log "$name up at $url"
}

start() {
  stop || true

  # A copy of the definition root, so this stack never shares a repository
  # with another. It is derived state; a fresh copy is always correct.
  if [[ ! -d "$definitions_root" || -n "${STACK_A_FRESH:-}" ]]; then
    rm -rf "$definitions_root"
    mkdir -p "$(dirname "$definitions_root")"
    cp -R "$source_root" "$definitions_root"
    log "copied $source_root → $definitions_root"
  fi

  # 0036 gives SessionRow.closedAt a source; applying it twice is a no-op.
  psql "$STACK_A_DSN" -v ON_ERROR_STOP=1 -q \
    -f "$root/backend/supabase/migrations/0036_sessions_harness_ref.sql" >/dev/null
  log "migration 0036 applied"

  ( cd "$root/backend" && exec .venv/bin/uvicorn app.main:app \
      --host 127.0.0.1 --port 8411 --log-level warning ) >"$run/api.log" 2>&1 &
  echo $! >"$run/api.pid"

  DEFINITIONS_ROOT="$definitions_root" \
  DEFINITIONS_SOCK="$run/definitions.sock" \
  DEFINITIONS_LISTEN="127.0.0.1:8412" \
  API_URL="$STACK_A_API" \
    bash "$root/scripts/dev-definitions.sh" >"$run/definitions.log" 2>&1 &
  echo $! >"$run/definitions.pid"

  sync_web
  ( cd "$web_dir" && HARNESS_API_ORIGIN="$STACK_A_API" \
      exec npx next dev --port 3011 ) >"$run/web.log" 2>&1 &
  echo $! >"$run/web.pid"

  wait_for "$STACK_A_API/health" api
  wait_for "$STACK_A_DEFINITIONS/health" definitions
  wait_for "$STACK_A_URL/login" web
}

stop() {
  for name in web definitions api; do
    local file="$run/$name.pid"
    [[ -f "$file" ]] || continue
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
      log "stopped $name ($pid)"
    fi
    rm -f "$file"
  done
  # next dev re-parents; take the port back by name as well.
  lsof -ti tcp:3011 -sTCP:LISTEN 2>/dev/null | xargs -r kill -TERM 2>/dev/null || true
  lsof -ti tcp:8411 -sTCP:LISTEN 2>/dev/null | xargs -r kill -TERM 2>/dev/null || true
  lsof -ti tcp:8412 -sTCP:LISTEN 2>/dev/null | xargs -r kill -TERM 2>/dev/null || true
}

# --- the data the screens are read against ----------------------------------
#
# Every row below is written through the real path it would take in life: the
# definition plane is a git commit followed by `definitions`' own reindex, and
# the records are the tables `api` writes. Nothing is a console fixture (K7);
# the console never sees any of it except through `/v1/console/*`.

# `definitions` reindexes the organization, exactly as the cutover does. Rows
# keyed by a node path that moved are deleted first (cutover §5.3).
reindex() {
  psql "$STACK_A_DSN" -q -c "delete from idx_assets where org='$1'" \
                      -c "delete from idx_harnesses where org='$1'" \
                      -c "delete from idx_policy where org='$1'"
  curl -fsS -X POST -H "Authorization: Bearer $HARNESS_SERVICE_TOKEN" \
    "$STACK_A_DEFINITIONS/internal/reindex/$1" && echo
}

seed() {
  local org repo
  org="$(psql "$STACK_A_DSN" -Atc "select id from org_units where role='org' limit 1")"
  repo="$definitions_root/$org.git"
  [[ -d "$repo" ]] || { log "no repository at $repo — run start first"; return 1; }

  # 0. Index what the repositories hold now, so step 1 can read the assets the
  #    chain actually composes. `definitions` owns the reindex (02 §11.2).
  reindex "$org"

  # 1. The harness on the org branch names no assets (the migration recorded
  #    `assignment_unresolved`), so the repository screen would be empty. Name
  #    the five the chain composes, and give the person their own copy of the
  #    team's prompt so *mine* and *the team's* really differ.
  # The asset the person's copy and the offered request both name: the one
  # asset directory on the team's branch, whatever kind the export gave it.
  local asset_dir
  asset_dir="$(git --git-dir "$repo" ls-tree -r --name-only \
      "$(git --git-dir "$repo" for-each-ref --format='%(refname)' refs/heads/teams/ | head -1)" \
    | sed -n 's#^\(assets/[^/]*/[^/]*\)/asset\.json$#\1#p' | head -1)"
  [[ -n "$asset_dir" ]] || { log "no asset directory on the team branch"; return 1; }

  STACK_A_REPO="$repo" STACK_A_DSN="$STACK_A_DSN" STACK_A_ASSET_DIR="$asset_dir" \
    "$root/backend/.venv/bin/python" - <<'PY'
import json, os, subprocess, tempfile, pathlib
repo, dsn = os.environ["STACK_A_REPO"], os.environ["STACK_A_DSN"]
def git(*args, **kw): return subprocess.run(["git", "--git-dir", repo, *args],
                                            check=True, capture_output=True, text=True, **kw).stdout
assets = subprocess.run(["psql", dsn, "-Atc",
    "select asset_id from idx_effective order by asset_id"],
    check=True, capture_output=True, text=True).stdout.split()
name = git("ls-tree", "--name-only", "refs/heads/org", "harnesses/").strip()
current = json.loads(git("show", f"refs/heads/org:{name}"))
if sorted(current.get("assets") or []) != sorted(assets):
    current["assets"] = assets
    with tempfile.TemporaryDirectory() as work:
        blob = pathlib.Path(work, "h.json")
        blob.write_text(json.dumps(current, indent=2) + "\n")
        oid = git("hash-object", "-w", str(blob)).strip()
    env = dict(os.environ, GIT_INDEX_FILE=str(pathlib.Path(tempfile.gettempdir(), "stack-a-index")))
    subprocess.run(["git", "--git-dir", repo, "read-tree", "refs/heads/org"], check=True, env=env)
    subprocess.run(["git", "--git-dir", repo, "update-index", "--add", "--cacheinfo",
                    f"100644,{oid},{name}"], check=True, env=env)
    tree = subprocess.run(["git", "--git-dir", repo, "write-tree"], check=True, env=env,
                          capture_output=True, text=True).stdout.strip()
    commit = subprocess.run(
        ["git", "--git-dir", repo, "commit-tree", tree, "-p", "refs/heads/org",
         "-m", "harness: name the assets the chain composes"],
        check=True, capture_output=True, text=True,
        env=dict(os.environ, GIT_AUTHOR_NAME="Corby Furrer", GIT_AUTHOR_EMAIL="corbfurrer@gmail.com",
                 GIT_COMMITTER_NAME="Corby Furrer", GIT_COMMITTER_EMAIL="corbfurrer@gmail.com"),
    ).stdout.strip()
    git("update-ref", "refs/heads/org", commit)
    print("org branch: harness now names", len(assets), "assets")

# The person's own copy of the team's prompt, same asset id: one asset with two
# copies is what *mine · the team's · Differences* and the file's two histories
# are about, and the export produced none.
user_ref = git("for-each-ref", "--format=%(refname)", "refs/heads/users/").split()[0]
team_ref = "refs/heads/teams/" + git("for-each-ref", "--format=%(refname:short)",
                                     "refs/heads/teams/").split()[0].removeprefix("teams/")
# The asset's kind is the exporter's to choose and it has changed, so the
# directory is read off the branch rather than written down here.
asset_dir = os.environ["STACK_A_ASSET_DIR"]
body_name = next(path.rsplit("/", 1)[1] for path in
                 git("ls-tree", "-r", "--name-only", team_ref, "--", asset_dir + "/").split()
                 if not path.endswith("/asset.json"))
have = git("ls-tree", "--name-only", "-r", user_ref)
if f"{asset_dir}/{body_name}" not in have:
    sidecar = git("show", f"{team_ref}:{asset_dir}/asset.json")
    body = ("Always answer in British English.\n"
            "Keep the first paragraph to two sentences.\n")
    with tempfile.TemporaryDirectory() as work:
        p = pathlib.Path(work, body_name); p.write_text(body)
        blob = git("hash-object", "-w", str(p)).strip()
        s = pathlib.Path(work, "asset.json"); s.write_text(sidecar)
        side = git("hash-object", "-w", str(s)).strip()
    env = dict(os.environ, GIT_INDEX_FILE=str(pathlib.Path(tempfile.gettempdir(), "stack-a-index-u")))
    subprocess.run(["git", "--git-dir", repo, "read-tree", user_ref], check=True, env=env)
    for path, oid in ((f"{asset_dir}/{body_name}", blob),
                      (f"{asset_dir}/asset.json", side)):
        subprocess.run(["git", "--git-dir", repo, "update-index", "--add", "--cacheinfo",
                        f"100644,{oid},{path}"], check=True, env=env)
    tree = subprocess.run(["git", "--git-dir", repo, "write-tree"], check=True, env=env,
                          capture_output=True, text=True).stdout.strip()
    commit = subprocess.run(
        ["git", "--git-dir", repo, "commit-tree", tree, "-p", user_ref,
         "-m", "house style: keep the opening to two sentences"],
        check=True, capture_output=True, text=True,
        env=dict(os.environ, GIT_AUTHOR_NAME="Corby Furrer", GIT_AUTHOR_EMAIL="corbfurrer@gmail.com",
                 GIT_COMMITTER_NAME="Corby Furrer", GIT_COMMITTER_EMAIL="corbfurrer@gmail.com"),
    ).stdout.strip()
    git("update-ref", user_ref, commit)
    print("user branch: own copy of house-style")
PY

  # 2. Index again, now that the definition plane has changed.
  reindex "$org"

  # 3. The records. `auth.users` is the mirror's own table and carries no
  #    email, so every person cell would read empty; a second member gives the
  #    compare control a `member:` option and `?as` something to refuse.
  psql "$STACK_A_DSN" -v ON_ERROR_STOP=1 -q -f /dev/stdin <<'SQL'
update auth.users set email = 'corbfurrer@gmail.com'
 where id = '3f29b349-aaef-43db-9096-c4fe2758e3cb' and coalesce(email,'') = '';

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'sam.ojo@test-org-1.example')
on conflict (id) do nothing;

insert into org_units (id, parent_id, name, role)
select '22222222-2222-4222-8222-222222222222', u.id, 'sam.ojo@test-org-1.example', 'user'
  from org_units u where u.role = 'team'
on conflict (id) do nothing;

insert into org_unit_members (auth_user_id, user_unit_id)
values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
on conflict do nothing;
SQL

  # 4. The sessions. `POST /v1/sessions` is the real mint path and needs a
  #    live CLI and a reachable vault; these are the records that path writes,
  #    in the engine's own shapes (engine 00 §4.6–§4.7), so the screen reads
  #    exactly what a real run would leave behind. Stated in the report.
  STACK_A_DSN="$STACK_A_DSN" "$root/backend/.venv/bin/python" - <<'PY'
import json, subprocess, os, datetime
dsn = os.environ["STACK_A_DSN"]
def q(sql, *a):
    out = subprocess.run(["psql", dsn, "-Atc", sql % a], check=True,
                         capture_output=True, text=True).stdout.strip()
    return out
org = q("select id from org_units where role='org' limit 1")
team = q("select id from org_units where role='team' limit 1")
harness = q("select id from idx_harnesses limit 1")
person = "3f29b349-aaef-43db-9096-c4fe2758e3cb"
commits = json.loads(q("select coalesce(jsonb_object_agg(ref, commit)::text,'{}') from idx_refs"))
now = datetime.datetime.now(datetime.UTC)
iso = lambda d: d.isoformat()

slots = [
    {"need": {"kind": "credential", "alias": "anthropic-api-key"}, "state": "satisfied",
     "evidence": "verified", "kind": "minted",
     "resolvedFrom": {"source": "vault", "vault": "bundled",
                      "group": "legacy-anthropic-api-key", "grant": "legacy-anthropic-api-key"},
     "expires_at": iso(now + datetime.timedelta(hours=8))},
    {"need": {"kind": "credential", "alias": "crm-token"}, "state": "deferred",
     "evidence": "declared", "resolvedFrom": None,
     "via": {"grant": "legacy-anthropic-api-key", "group": "legacy-anthropic-api-key",
             "sources": "vault-or-local"}},
    {"need": {"kind": "login", "tool": "gh"}, "state": "satisfied",
     "evidence": "harness-reported", "resolvedFrom": {"source": "local", "tool": "gh"}},
    {"need": {"kind": "asset", "name": "prompt/house-style"}, "state": "satisfied",
     "evidence": "verified", "resolvedFrom": None},
]
failing_slots = [
    {"need": {"kind": "credential", "alias": "anthropic-api-key"}, "state": "unsatisfied",
     "evidence": "declared", "resolvedFrom": None,
     "blocker": {"code": "broker.vault_unreachable",
                 "message": "The bundled vault did not answer for anthropic-api-key.",
                 "remedy": "Check the vault on the Key vaults screen, then run harness run again."}},
]
report = {
    "sessionId": "", "at": iso(now),
    "composed": {"commit": commits, "tree": "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
                 "conflicts": []},
    "choices": {
        "provider": {"id": "pi", "approval": "approved",
                     "pin": {"repo": "https://github.com/harness-co/pi",
                             "commit": "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759"},
                     "speaks": ["openai-completions", "anthropic-messages"]},
        "located": {"kind": "pinned", "commit": "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759"},
        "harness": {"id": harness, "name": "test-harness-1"},
        "view": "mine",
        "model": {"provider": "anthropic", "model": "claude-opus-5",
                  "wireFormat": "openai-completions", "endpoint": "https://api.anthropic.com"},
        "grants": [{"id": "legacy-anthropic-api-key", "group": "legacy-anthropic-api-key",
                    "scope": {"teams": "all"}}],
        "native": False,
    },
    # D131: reach is the plan's, not a grant's (W5-D1b retired that one).
    "plan": {"hosts": ["api.anthropic.com"], "deny": ["*.pastebin.com"],
             "reach": {"mode": "allow", "hosts": ["pypi.org", "files.pythonhosted.org"],
                       "setBy": "test-org-1"}},
    "slots": slots, "drift": [], "passing": True, "blockers": [],
}
failing = json.loads(json.dumps(report))
failing["slots"] = failing_slots
failing["passing"] = False
failing["blockers"] = [
    {"code": "broker.vault_unreachable",
     "message": "The bundled vault did not answer for anthropic-api-key.",
     "remedy": "Open the Key vaults screen and check the bundled vault is connected.",
     "link": "/console/org/vaults"},
    {"code": "preflight.model_unreachable",
     "message": "The model endpoint for anthropic did not answer within five seconds.",
     "remedy": "Check the provider's endpoint on the Providers screen."},
]
failing["drift"] = [
    {"file": "assets/prompt/house-style/PROMPT.md",
     "expected": "two sentences", "actual": "four sentences"},
]

rows = [
    # id, name, status, provider, version, model_provider, model, minutes ago, slots, preflight, tally, revoked
    ("aaaaaaaa-0000-4000-8000-000000000001", "morning triage", "active", "pi", "0.4.2",
     "anthropic", "claude-opus-5", 12, slots, report, None, None),
    ("aaaaaaaa-0000-4000-8000-000000000002", "native claude", "closed", "claude-code", "1.9.0",
     None, None, 180, slots, report,
     [{"host": "api.anthropic.com", "port": 443, "count": 31, "refused": 0,
       "firstAt": iso(now - datetime.timedelta(minutes=180)),
       "lastAt": iso(now - datetime.timedelta(minutes=140))}], None),
    ("aaaaaaaa-0000-4000-8000-000000000003", "crm sync", "revoked", "pi", "0.4.2",
     "anthropic", "claude-opus-5", 420, failing_slots, failing,
     [{"host": "api.anthropic.com", "port": 443, "alias": "anthropic-api-key", "count": 4,
       "refused": 2, "firstAt": iso(now - datetime.timedelta(minutes=420)),
       "lastAt": iso(now - datetime.timedelta(minutes=410))},
      {"host": "crm.internal.example", "port": 443, "count": 0, "refused": 7,
       "firstAt": iso(now - datetime.timedelta(minutes=419)),
       "lastAt": iso(now - datetime.timedelta(minutes=412))}],
     "The grant covering anthropic-api-key was narrowed while this session ran."),
    ("aaaaaaaa-0000-4000-8000-000000000004", "older cli", "closed", "pi", "0.3.9",
     "anthropic", "claude-opus-5", 2880, slots, None, [], None),
]
statements = []
for (sid, name, status, provider, version, mprov, model, ago, s, pf, tally, reason) in rows:
    started = now - datetime.timedelta(minutes=ago)
    last = started + datetime.timedelta(minutes=8)
    pf_json = "null" if pf is None else json.dumps({**pf, "sessionId": sid})
    slots_json = json.dumps({
        (slot["need"].get("alias") or slot["need"].get("tool") or slot["need"].get("name")): {
            k: v for k, v in slot.items() if k != "need"}
        for slot in s})
    statements.append(f"""
insert into harness_sessions
  (id, org_unit_id, owner_auth_user_id, harness_id, name, status, provider_id,
   provider_version, model_provider, model, commits, slots, preflight,
   endpoints_tally, revoked_reason, created_at, last_active_at, closed_at)
values ('{sid}', '{team}', '{person}', '{harness}', $s${name}$s$, '{status}', '{provider}',
        '{version}', {'null' if mprov is None else f"'{mprov}'"},
        {'null' if model is None else f"'{model}'"},
        $j${json.dumps(commits)}$j$, $j${slots_json}$j$, $j${pf_json}$j$,
        {'null' if tally is None else f"$j${json.dumps(tally)}$j$"},
        {'null' if reason is None else f"$s${reason}$s$"},
        '{iso(started)}', '{iso(last)}',
        {"null" if status == 'active' else f"'{iso(last)}'"})
on conflict (id) do update set
  status = excluded.status, slots = excluded.slots, preflight = excluded.preflight,
  commits = excluded.commits, endpoints_tally = excluded.endpoints_tally,
  model_provider = excluded.model_provider, model = excluded.model,
  revoked_reason = excluded.revoked_reason, last_active_at = excluded.last_active_at,
  closed_at = excluded.closed_at;""")

# The live session's endpoint events: `session_row` counts them from the audit
# log while a session is active, which is what fills *Endpoints reached*.
for index, (host, status_code) in enumerate(
        [("api.anthropic.com", "200")] * 3 + [("crm.internal.example", "denied")]):
    statements.append(f"""
insert into audit_log (org_unit_id, actor_type, actor_id, class, action, payload,
                       created_at, prev_hash, hash)
select '{team}', 'system', null, 'attested', 'session.endpoint',
       $j${json.dumps({"session": rows[0][0], "host": host, "status": status_code, "n": index})}$j$,
       now() - interval '{index} minutes', '', md5(random()::text)
 where not exists (select 1 from audit_log where action='session.endpoint'
                     and payload->>'session' = '{rows[0][0]}'
                     and payload->>'n' = '{index}');""")

subprocess.run(["psql", dsn, "-v", "ON_ERROR_STOP=1", "-q", "-c", "\n".join(statements)],
               check=True)
print(f"sessions: {len(rows)} rows")
PY

  # 5. A real request, opened through `POST /v1/requests` with the person's
  #    own token — the endpoint the CLI's `harness offer` calls. The offered
  #    commit is the person's branch head, so the request carries the real
  #    change against the team's copy rather than an empty diff.
  local token mine
  token="$(mint_pat 3f29b349-aaef-43db-9096-c4fe2758e3cb)"
  mine="$(psql "$STACK_A_DSN" -Atc \
    "select commit from idx_refs where ref like 'refs/heads/users/%' limit 1")"
  if [[ "$(psql "$STACK_A_DSN" -Atc 'select count(*) from requests')" == "0" ]]; then
    curl -fsS -X POST "$STACK_A_API/v1/requests" \
      -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
      -d "$(printf '{"title":"%s","reasoning":"%s","subject":{"kind":"promotion","paths":["%s"],"commit":"%s","harness":"%s"}}' \
            "Keep the opening to two sentences" \
            "The house style prompt runs long in every draft; this holds the opening to two sentences." \
            "$asset_dir" \
            "$mine" \
            "$(psql "$STACK_A_DSN" -Atc 'select id from idx_harnesses limit 1')")" >/dev/null \
      || log "POST /v1/requests refused — see api.log"
  fi

  write_state
  log "seeded"
}

# A personal access token for a person, minted the way `mirror.py` does — the
# records' own table, no auth route involved.
mint_pat() {
  local user="$1" raw hash
  raw="stack-a-$(echo -n "$user" | shasum | cut -c1-32)"
  hash="$(printf '%s' "$raw" | shasum -a 256 | cut -d' ' -f1)"
  psql "$STACK_A_DSN" -q -c \
    "insert into personal_access_tokens (auth_user_id, token_hash, name)
     select '$user', '$hash', 'stack-a'
      where not exists (select 1 from personal_access_tokens where token_hash = '$hash')"
  printf 'hpat_%s' "$raw"
}

# Playwright's storage state. `lib/token.server.ts` reads the Supabase session
# cookie and hands `request()` its `access_token`, and `api` accepts a personal
# access token on the same header (`identity.py`), so a session whose
# `access_token` is the person's PAT is a real, server-checked credential —
# nothing about the token is trusted by the browser side.
write_state() {
  local token project
  token="$(mint_pat 3f29b349-aaef-43db-9096-c4fe2758e3cb)"
  project="$(sed -n 's#^NEXT_PUBLIC_SUPABASE_URL=https://\([^.]*\)\..*#\1#p' "$root/web/.env")"
  STACK_A_TOKEN="$token" STACK_A_PROJECT="$project" STACK_A_STATE="$run/state.json" \
  STACK_A_URL="$STACK_A_URL" "$root/backend/.venv/bin/python" - <<'PY'
import base64, json, os, time
token, project = os.environ["STACK_A_TOKEN"], os.environ["STACK_A_PROJECT"]
session = {
    "access_token": token, "refresh_token": "stack-a", "token_type": "bearer",
    "expires_in": 31536000, "expires_at": int(time.time()) + 31536000,
    "user": {"id": "3f29b349-aaef-43db-9096-c4fe2758e3cb",
             "email": "corbfurrer@gmail.com", "aud": "authenticated", "role": "authenticated"},
}
raw = base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip("=")
value = "base64-" + raw
host = os.environ["STACK_A_URL"].split("//", 1)[1].split(":")[0]
state = {"cookies": [{"name": f"sb-{project}-auth-token", "value": value, "domain": host,
                      "path": "/", "expires": session["expires_at"], "httpOnly": False,
                      "secure": False, "sameSite": "Lax"}], "origins": []}
open(os.environ["STACK_A_STATE"], "w").write(json.dumps(state, indent=2))
print(os.environ["STACK_A_STATE"])
PY
}

cookie() { write_state; }

case "${1:-start}" in
  start) start ;;
  sync) sync_web ;;
  stop) stop ;;
  seed) seed ;;
  cookie) cookie ;;
  restart) stop; start ;;
  *) echo "usage: stack-a.sh {start|stop|restart|seed|cookie}" >&2; exit 2 ;;
esac
