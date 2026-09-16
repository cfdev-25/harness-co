from typing import Any
from uuid import UUID

import asyncpg

from app.errors import ApiError


async def owned_session(
    connection: asyncpg.Connection | asyncpg.Pool, session_id: UUID, owner_id: UUID
) -> dict[str, Any]:
    row = await connection.fetchrow(
        "select * from harness_sessions where id=$1 and owner_auth_user_id=$2",
        session_id,
        owner_id,
    )
    if not row:
        raise ApiError(404, "session_not_found", "This session could not be found.")
    return dict(row)
