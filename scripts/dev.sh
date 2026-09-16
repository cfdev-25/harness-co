#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS=()

cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM
	if ((${#PIDS[@]})); then
		kill "${PIDS[@]}" 2>/dev/null || true
		wait "${PIDS[@]}" 2>/dev/null || true
	fi
	exit "$exit_code"
}
trap cleanup EXIT INT TERM

start_process() {
	local name=$1
	shift
	echo "Starting ${name}..."
	"$@" &
	PIDS+=("$!")
}

if [[ ! -f "$ROOT_DIR/backend/.env" ]]; then
	echo "Create backend/.env from backend/.env.example" >&2
	exit 1
fi

start_process "backend" bash -c \
	"cd \"\$1\" && set -a && source .env && set +a && exec .venv/bin/uv run uvicorn app.main:app --reload --port \"\$2\"" \
	_ "$ROOT_DIR/backend" "${BACKEND_PORT:-8400}"

start_process "web" npm --prefix "$ROOT_DIR/web" run dev -- --port "${WEB_PORT:-3000}"
start_process "mock provider" node "$ROOT_DIR/scripts/mock-provider/server.mjs"

echo "Development services started. Press Ctrl-C to stop."
wait "${PIDS[@]}"
