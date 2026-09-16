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
        min_size=1,
        max_size=10,
        init=configure,
        statement_cache_size=0,
    )
    await ensure_audit_partitions(pool)
    return pool


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
