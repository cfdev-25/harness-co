import re
from typing import Any
from uuid import UUID

import asyncpg

from app.crypto import decrypt, encrypt
from app.errors import ApiError


def key_ref(org_path: str, name: str) -> str:
    slug = re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", name.lower())).strip("-")
    if not slug:
        raise ApiError(422, "invalid_key_name", "The key name must contain a letter or number.")
    return f"secret://{org_path}/{slug}"


def last_four(value: str) -> str:
    return value[-4:]


def key_is_visible(key_org_unit_id: UUID, ancestor_ids: set[UUID]) -> bool:
    return key_org_unit_id in ancestor_ids


async def rotate(
    connection: asyncpg.Connection, api_key_id: UUID, value: str, *, master_key: str | None = None
) -> dict[str, Any]:
    exists = await connection.fetchval("select id from api_keys where id=$1 for update", api_key_id)
    if not exists:
        raise ApiError(404, "api_key_not_found", "This API key could not be found.")
    await connection.execute(
        "update api_key_versions set status='grace' where api_key_id=$1 and status='active'",
        api_key_id,
    )
    version = await connection.fetchval(
        "select coalesce(max(version),0)+1 from api_key_versions where api_key_id=$1", api_key_id
    )
    row = await connection.fetchrow(
        """insert into api_key_versions(api_key_id,version,ciphertext,last4,status)
           values($1,$2,$3,$4,'active') returning *""",
        api_key_id,
        version,
        encrypt(value, key=master_key),
        last_four(value),
    )
    return dict(row)


def delivered_value(ciphertext: bytes, *, master_key: str | None = None) -> str:
    return decrypt(ciphertext, key=master_key)
