import hashlib
import secrets
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.api.deps import current_principal, role_at
from app.db import get_pool, transaction
from app.domain.audit import append_event
from app.domain.org_tree import accept_pending_invite
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["authentication"])


class PatCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = None


@router.post("/personal-access-tokens", status_code=status.HTTP_201_CREATED)
async def create_pat(
    body: PatCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    raw = secrets.token_urlsafe(32)
    row = await get_pool(request).fetchrow(
        """insert into personal_access_tokens(auth_user_id,token_hash,name,expires_at)
           values($1,$2,$3,$4) returning id,name,expires_at,created_at""",
        principal.auth_user_id,
        hashlib.sha256(raw.encode()).hexdigest(),
        body.name,
        body.expires_at,
    )
    return {**dict(row), "token": f"hpat_{raw}"}


@router.get("/me")
async def me(
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    pool = get_pool(request)
    unit = await pool.fetchrow(
        """select u.* from org_unit_members m join org_units u on u.id=m.user_unit_id
           where m.auth_user_id=$1""",
        principal.auth_user_id,
    )
    if unit is None and principal.email:
        async with transaction(pool) as connection:
            unit = await accept_pending_invite(connection, principal.auth_user_id, principal.email)
            if unit:
                await append_event(
                    connection,
                    org_unit_id=unit["id"],
                    actor_type="user",
                    actor_id=principal.auth_user_id,
                    event_class="authoritative",
                    action="member.invite_accept",
                    payload={"email": principal.email},
                )
    if unit is None:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    # Names, not the path: the path is a dot-separated slug, so an email in it
    # has lost its "@" and dots. Callers that show a human anything use these.
    ancestors = await pool.fetch(
        """with recursive chain as (
             select id, parent_id, role, name, 0 depth from org_units where id=$1
             union all
             select p.id, p.parent_id, p.role, p.name, c.depth+1
               from org_units p join chain c on c.parent_id = p.id
           ) select role, name from chain order by depth desc""",
        unit["id"],
    )
    role = await role_at(pool, principal.auth_user_id, unit["id"])
    granted_at = None
    if role is not None:
        granted_at = await pool.fetchval("select name from org_units where id=$1", role[1])
    return {
        "auth_user_id": principal.auth_user_id,
        "email": principal.email,
        # No grant is the `user` role: membership without administration.
        "role": role[0] if role else "user",
        "role_unit": granted_at,
        "org_unit_id": unit["id"],
        "org_unit_path": unit["path"],
        "units": [{"role": row["role"], "name": row["name"]} for row in ancestors],
    }
