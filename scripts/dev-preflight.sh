#!/usr/bin/env bash
# Fails fast with an actionable message when the dev stack cannot start cleanly.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8400}"
WEB_PORT="${WEB_PORT:-3000}"
DEFINITIONS_PORT="${DEFINITIONS_PORT:-8402}"

fail() {
	echo "" >&2
	echo "dev preflight failed: $1" >&2
	shift
	for line in "$@"; do
		echo "  $line" >&2
	done
	echo "" >&2
	exit 1
}

if [[ ! -f "$ROOT_DIR/backend/.env" ]]; then
	fail "backend/.env is missing" \
		"It needs DATABASE_URL, HARNESS_MASTER_KEY, SUPABASE_URL," \
		"SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWKS_URL," \
		"HARNESS_SERVICE_TOKEN and DEFINITIONS_URL (engine 02 §4.1)." \
		"See docs/supabase-migration-plan.md §7.1 for where each value comes from."
fi

if [[ ! -x "$ROOT_DIR/backend/.venv/bin/uv" ]]; then
	fail "backend/.venv is missing or incomplete" \
		"cd backend && uv sync --all-groups" \
		"(uv install: https://docs.astral.sh/uv/getting-started/installation/)"
fi

if [[ ! -d "$ROOT_DIR/web/node_modules" ]]; then
	echo "web/node_modules missing — installing web dependencies..."
	npm ci --prefix "$ROOT_DIR/web"
fi

# Prints the pids listening on port $1, one per line, or nothing.
# lsof exits non-zero when the port is free, so failure here is expected.
port_pids() {
	lsof -nP -sTCP:LISTEN -iTCP:"$1" -t 2>/dev/null || true
}

process_name() {
	ps -o command= -p "$1" 2>/dev/null | head -1
}

# Our own process chain, so a reclaim can never kill the script running it.
SELF_PIDS=" "
for _pid in $$ $PPID; do
	while [[ -n "$_pid" && "$_pid" -gt 1 ]]; do
		SELF_PIDS+="$_pid "
		_pid="$(ps -o ppid= -p "$_pid" 2>/dev/null | tr -d ' ')"
	done
done

parent_pid() {
	ps -o ppid= -p "$1" 2>/dev/null | tr -d ' '
}

killable() {
	local pid=$1
	[[ -n "$pid" && "$pid" -gt 1 ]] || return 1
	[[ "$SELF_PIDS" != *" $pid "* ]]
}

# The dev stack always binds its fixed ports, so anything already listening
# there gets reclaimed. Dev servers are usually a supervisor plus a worker, so
# escalate: TERM the listener, then TERM its supervisor (which would otherwise
# respawn a new listener), then SIGKILL both.
reclaim_port() {
	local port=$1 label=$2 env_var=$3 pid parent round signal
	[[ -z "$(port_pids "$port")" ]] && return 0

	for pid in $(port_pids "$port"); do
		echo "Port $port ($label) held by pid $pid — $(process_name "$pid")"
	done

	for round in 1 2 3; do
		case $round in
		1 | 2) signal=TERM ;;
		3) signal=KILL ;;
		esac

		for pid in $(port_pids "$port"); do
			killable "$pid" || continue
			echo "  freeing port $port: kill -$signal $pid"
			kill -"$signal" "$pid" 2>/dev/null || true

			# Round 1 gives a lone listener the chance to exit on its own.
			if ((round > 1)); then
				parent="$(parent_pid "$pid")"
				if killable "$parent"; then
					echo "  freeing port $port: kill -$signal $parent (supervisor of $pid)"
					kill -"$signal" "$parent" 2>/dev/null || true
				fi
			fi
		done

		for _ in 1 2 3 4 5; do
			sleep 0.3
			[[ -z "$(port_pids "$port")" ]] && break
		done
		[[ -z "$(port_pids "$port")" ]] && return 0
	done

	fail "port $port ($label) could not be freed (held by $(port_pids "$port" | tr '\n' ' '))" \
		"Stop the process manually, or pick another port: $env_var=<port> npm run dev"
}

reclaim_port "$BACKEND_PORT" "backend" BACKEND_PORT
reclaim_port "$DEFINITIONS_PORT" "definitions" DEFINITIONS_PORT
reclaim_port "$WEB_PORT" "web" WEB_PORT

echo "Preflight OK — backend :$BACKEND_PORT · definitions :$DEFINITIONS_PORT · web :$WEB_PORT"
