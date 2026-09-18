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


# A role is granted at a node and covers that node's whole subtree. Ranked so
# a stronger grant anywhere above a unit wins over a weaker one.
ROLE_RANK = {"admin": 1, "owner": 2}


async def role_at(
    connection: asyncpg.Connection | asyncpg.Pool, auth_user_id: UUID, org_unit_id: UUID
) -> tuple[str, UUID] | None:
    """The strongest role this user holds over an org unit, and where it is granted.

    None means "member, no grant" — which is what the `user` role is. There is
    no row for it, because the absence of a grant is the role.
    """
    row = await connection.fetchrow(
        """with recursive chain as (
             select id,parent_id from org_units where id=$2
             union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
           )
           select a.level, a.org_unit_id
             from chain c join org_unit_admins a on a.org_unit_id=c.id
            where a.auth_user_id=$1
            order by case a.level when 'owner' then 2 else 1 end desc
            limit 1""",
        auth_user_id,
        org_unit_id,
    )
    return (row["level"], row["org_unit_id"]) if row else None


async def is_admin(
    connection: asyncpg.Connection | asyncpg.Pool, auth_user_id: UUID, org_unit_id: UUID
) -> bool:
    return await role_at(connection, auth_user_id, org_unit_id) is not None


async def require_admin(
    connection: asyncpg.Connection | asyncpg.Pool, principal: Principal, org_unit_id: UUID
) -> None:
    if not await is_admin(connection, principal.auth_user_id, org_unit_id):
        raise ApiError(403, "admin_required", "You need administrator access to do that.")


async def require_can_grant(
    connection: asyncpg.Connection | asyncpg.Pool,
    principal: Principal,
    level: str,
    org_unit_id: UUID,
) -> None:
    """You may grant a role at a node you administer, but never one above your own.

    So a team admin can appoint another admin of that team, and only an owner
    can make someone an owner.
    """
    held = await role_at(connection, principal.auth_user_id, org_unit_id)
    if held is None:
        raise ApiError(403, "admin_required", "You need administrator access to do that.")
    if ROLE_RANK.get(level, 0) > ROLE_RANK[held[0]]:
        raise ApiError(
            403,
            "cannot_grant_higher_role",
            f"You are {held[0]} here, so you cannot grant the {level} role.",
        )


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
