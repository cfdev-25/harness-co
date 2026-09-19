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


async def visible_keys(connection: asyncpg.Connection, org_unit_id: UUID) -> list[dict[str, Any]]:
    """Connectors an org unit can use: its own, plus every ancestor's.

    Administration flows down (docs/scoping.md §5.5), but a connector is not
    an asset: two units can each hold a key named `openai` and both stay
    usable, so this is a plain union over the ancestor chain, never
    `resolve.py`'s nearest-ancestor-wins window. Each row keeps `org_unit_id`
    and `org_unit_path` from wherever it actually lives, so a caller below
    can tell its own keys from an inherited one — and rotation, which reads
    that same `org_unit_id` off the row, stays possible only where the key
    lives, no matter how far down it is listed.
    """
    rows = await connection.fetch(
        """with recursive chain as (
             select id,parent_id from org_units where id=$1
             union all select p.id,p.parent_id
             from org_units p join chain c on c.parent_id=p.id
           ) select k.id,k.name,k.ref,k.kind,k.env_var,k.org_unit_id,u.path org_unit_path,
                    v.last4,v.version,v.status,v.created_at
             from api_keys k join chain c on c.id=k.org_unit_id
             join org_units u on u.id=k.org_unit_id
             join api_key_versions v on v.api_key_id=k.id and v.status='active'
             order by k.name""",
        org_unit_id,
    )
    return [dict(row) for row in rows]
