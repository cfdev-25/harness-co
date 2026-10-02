import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import asyncpg
from fastapi import Request

from app.config import Settings


async def create_pool(settings: Settings) -> asyncpg.Pool:
    async def configure(connection: asyncpg.Connection) -> None:
        def encode(value: Any) -> str:
            return value if isinstance(value, str) else json.dumps(value)

        await connection.set_type_codec(
            "json", schema="pg_catalog", encoder=encode, decoder=json.loads
        )
        await connection.set_type_codec(
            "jsonb", schema="pg_catalog", encoder=encode, decoder=json.loads
        )

    pool = await asyncpg.create_pool(
        settings.database_url,
        # A request's two reads run in parallel (the shell's viewer and the
        # screen), and a cold connection is a TLS handshake plus `configure`'s
        # two introspection queries; four warm ones cover a person clicking.
        min_size=4,
        max_size=10,
        init=configure,
        reset=released,
        # Prepared statements are cached, which is what makes a query one
        # round trip instead of two (parse, then execute). It also means the
        # DSN must be a session — the direct host or the session pooler; a
        # transaction pooler loses the statement between the two halves.
        statement_cache_size=256,
    )
    await ensure_audit_partitions(pool)
    return pool


async def released(connection: asyncpg.Connection) -> None:
    """The pool's reset on release. asyncpg's default sends a query — unlock
    advisory locks, close cursors, unlisten, reset GUCs — on every release, and
    with the database a network away that is one round trip paid for nothing:
    no request sets a session variable, listens, or takes an advisory lock. An
    open transaction is still rolled back before this runs (asyncpg's own
    `_reset`), so the one thing that must not leak between requests cannot."""


async def ensure_audit_partitions(pool: asyncpg.Pool) -> None:
    now = datetime.now(UTC)
    year, month = now.year, now.month
    async with pool.acquire() as connection:
        for _ in range(2):
            start = datetime(year, month, 1, tzinfo=UTC)
            if month == 12:
                end = datetime(year + 1, 1, 1, tzinfo=UTC)
            else:
                end = datetime(year, month + 1, 1, tzinfo=UTC)
            table = f"audit_log_{year:04d}_{month:02d}"
            await connection.execute(
                f"""create table if not exists {table} partition of audit_log
                    for values from ('{start.isoformat()}') to ('{end.isoformat()}')"""
            )
            year, month = end.year, end.month


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


@asynccontextmanager
async def transaction(pool: asyncpg.Pool) -> AsyncIterator[asyncpg.Connection]:
    async with pool.acquire() as connection:
        async with connection.transaction():
            yield connection


def record(row: asyncpg.Record | None) -> dict[str, Any] | None:
    return dict(row) if row else None
