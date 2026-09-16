from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import Depends, Header, Request

from app.config import get_settings
from app.db import get_pool
from app.errors import ApiError
from app.identity import Principal, verify_authorization


async def current_principal(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> Principal:
    return await verify_authorization(authorization, get_pool(request), get_settings())


async def current_user_unit(
    request: Request, principal: Annotated[Principal, Depends(current_principal)]
) -> dict:
    row = await get_pool(request).fetchrow(
        """select u.* from org_unit_members m join org_units u on u.id=m.user_unit_id
           where m.auth_user_id=$1""",
        principal.auth_user_id,
    )
    if not row:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    return dict(row)


async def is_admin(
    connection: asyncpg.Connection | asyncpg.Pool, auth_user_id: UUID, org_unit_id: UUID
) -> bool:
    return bool(
        await connection.fetchval(
            """with recursive chain as (
                 select id,parent_id from org_units where id=$2
                 union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
               ) select exists(
                 select 1 from chain c join org_unit_admins a on a.org_unit_id=c.id
                 where a.auth_user_id=$1
               )""",
            auth_user_id,
            org_unit_id,
        )
    )


async def require_admin(
    connection: asyncpg.Connection | asyncpg.Pool, principal: Principal, org_unit_id: UUID
) -> None:
    if not await is_admin(connection, principal.auth_user_id, org_unit_id):
        raise ApiError(403, "admin_required", "You need administrator access to do that.")


async def can_read(
    connection: asyncpg.Connection | asyncpg.Pool,
    principal: Principal,
    user_unit_id: UUID,
    target_id: UUID,
) -> bool:
    if await is_admin(connection, principal.auth_user_id, target_id):
        return True
    return bool(
        await connection.fetchval(
            """with recursive chain as (
                 select id,parent_id from org_units where id=$1
                 union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
               ) select exists(select 1 from chain where id=$2)""",
            user_unit_id,
            target_id,
        )
    )


async def require_write(
    connection: asyncpg.Connection | asyncpg.Pool,
    principal: Principal,
    user_unit_id: UUID,
    target_id: UUID,
) -> None:
    if target_id != user_unit_id and not await is_admin(
        connection, principal.auth_user_id, target_id
    ):
        raise ApiError(
            403, "write_not_allowed", "You do not have permission to change this org unit."
        )
