#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS=()
POSTGRES_CONTAINER=""
POSTGRES_OWNED=0

cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM

	if ((${#PIDS[@]})); then
		kill "${PIDS[@]}" 2>/dev/null || true
		wait "${PIDS[@]}" 2>/dev/null || true
	fi

	if [[ -n "$POSTGRES_CONTAINER" && "$POSTGRES_OWNED" == "1" ]]; then
		docker stop "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
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

if [[ -f "$ROOT_DIR/backend/pyproject.toml" && -f "$ROOT_DIR/backend/app/main.py" ]]; then
	if [[ "${HARNESS_SKIP_POSTGRES:-0}" != "1" ]]; then
		command -v docker >/dev/null 2>&1 || {
			echo "Docker is required to start local Postgres." >&2
			exit 1
		}

		POSTGRES_CONTAINER="harness-postgres-dev"
		if docker container inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
			if [[ "$(docker inspect --format '{{.State.Running}}' "$POSTGRES_CONTAINER")" != "true" ]]; then
				docker start "$POSTGRES_CONTAINER" >/dev/null
				POSTGRES_OWNED=1
			fi
		else
			docker run --detach --rm \
				--name "$POSTGRES_CONTAINER" \
				-e POSTGRES_USER=postgres \
				-e POSTGRES_PASSWORD=postgres \
				-e POSTGRES_DB=harness \
				-p "${POSTGRES_PORT:-5433}:5432" \
				postgres:15 >/dev/null
			POSTGRES_OWNED=1
		fi

		echo "Waiting for Postgres..."
		until docker exec "$POSTGRES_CONTAINER" pg_isready -U postgres -d harness >/dev/null 2>&1; do
			sleep 1
		done
	fi

	export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:${POSTGRES_PORT:-5433}/harness}"
	if [[ "${HARNESS_SKIP_POSTGRES:-0}" != "1" ]]; then
		for migration in "$ROOT_DIR"/backend/supabase/migrations/*.sql; do
			docker exec --interactive "$POSTGRES_CONTAINER" \
				psql --username postgres --dbname harness --set ON_ERROR_STOP=1 <"$migration"
		done
	fi
	start_process "backend" bash -c \
		"cd \"\$1\" && exec .venv/bin/uv run uvicorn app.main:app --reload --port \"\$2\"" \
		_ "$ROOT_DIR/backend" "${BACKEND_PORT:-8400}"
fi

if [[ -f "$ROOT_DIR/web/package.json" ]]; then
	start_process "web" npm --prefix "$ROOT_DIR/web" run dev -- --port "${WEB_PORT:-5173}"
fi

if [[ -f "$ROOT_DIR/scripts/mock-provider/server.mjs" ]]; then
	start_process "mock provider" node "$ROOT_DIR/scripts/mock-provider/server.mjs"
fi

if ((${#PIDS[@]} == 0)); then
	echo "No development components are available yet."
	exit 0
fi

echo "Development services started. Press Ctrl-C to stop."
wait "${PIDS[@]}"
