import json
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field

from app.api.deps import current_principal, current_user_unit, require_admin
from app.config import get_settings
from app.db import get_pool, transaction
from app.domain.audit import append_event
from app.domain.org_tree import (
    Boundary,
    effective_boundary,
    slugify,
    validate_role_order,
    validate_tightening,
)
from app.errors import ApiError
from app.gotrue import invite_email
from app.identity import Principal

router = APIRouter(tags=["org units"])


class OrgUnitCreate(BaseModel):
    parent_id: UUID | None
    role: Literal["org", "team", "user"]
    name: str = Field(min_length=1, max_length=200)


class MemberCreate(BaseModel):
    auth_user_id: UUID
    name: str = Field(min_length=1, max_length=200)


class OrgCreate(BaseModel):
    org_name: str = Field(min_length=1, max_length=200)
    team_name: str = Field(default="General", min_length=1, max_length=200)


class InviteCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    admin_level: Literal["admin", "platform"] | None = None
    admin_unit_id: UUID | None = None


@router.get("/tree")
async def tree(
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    pool = get_pool(request)
    root = await pool.fetchrow(
        """with recursive chain as (
             select *,0 depth from org_units where id=$1
             union all select p.*,c.depth+1 from org_units p join chain c on c.parent_id=p.id
           ) select * from chain order by depth desc limit 1""",
        user_unit["id"],
    )
    rows = await pool.fetch(
        """with recursive subtree as (
             select * from org_units where id=$1
             union all select u.* from org_units u join subtree s on u.parent_id=s.id
           ) select * from subtree order by path""",
        root["id"],
    )
    admin_units = {
        row["org_unit_id"]
        for row in await pool.fetch(
            "select org_unit_id from org_unit_admins where auth_user_id=$1",
            principal.auth_user_id,
        )
    }
    # Admins may inspect their complete subtree. Members see their chain and sibling team names.
    chain_paths = {
        row["path"]
        for row in rows
        if user_unit["path"] == row["path"] or user_unit["path"].startswith(row["path"] + ".")
    }
    visible = []
    for row in rows:
        in_admin_subtree = any(
            row["path"] == a["path"] or row["path"].startswith(a["path"] + ".")
            for a in rows
            if a["id"] in admin_units
        )
        sibling_team = row["role"] == "team" and row["parent_id"] == root["id"]
        if in_admin_subtree or row["path"] in chain_paths or sibling_team:
            visible.append(row)
    tree_units = {
        row["id"]: {"id": row["id"], "role": row["role"], "name": row["name"], "children": []}
        for row in visible
    }
    roots = []
    for row in visible:
        if row["parent_id"] in tree_units:
            tree_units[row["parent_id"]]["children"].append(tree_units[row["id"]])
        else:
            roots.append(tree_units[row["id"]])
    return roots[0] if len(roots) == 1 else {"children": roots}


@router.post("/orgs", status_code=status.HTTP_201_CREATED)
async def create_org(
    body: OrgCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        existing = await connection.fetchval(
            "select user_unit_id from org_unit_members where auth_user_id=$1",
            principal.auth_user_id,
        )
        if existing:
            raise ApiError(409, "already_member", "You already belong to an organization.")
        org = await connection.fetchrow(
            """insert into org_units(parent_id,role,name,path)
               values(null,'org',$1,$2) returning *""",
            body.org_name,
            slugify(body.org_name),
        )
        team = await connection.fetchrow(
            """insert into org_units(parent_id,role,name,path,region)
               values($1,'team',$2,$3,$4) returning *""",
            org["id"],
            body.team_name,
            f"{org['path']}.{slugify(body.team_name)}",
            org["region"],
        )
        user_name = (principal.email or str(principal.auth_user_id)).lower()
        user_unit = await connection.fetchrow(
            """insert into org_units(parent_id,role,name,path,region)
               values($1,'user',$2,$3,$4) returning *""",
            team["id"],
            user_name,
            f"{team['path']}.{slugify(user_name)}",
            team["region"],
        )
        await connection.execute(
            "insert into org_unit_members(auth_user_id,user_unit_id) values($1,$2)",
            principal.auth_user_id,
            user_unit["id"],
        )
        await connection.execute(
            """insert into org_unit_admins(auth_user_id,org_unit_id,level)
               values($1,$2,'platform')""",
            principal.auth_user_id,
            org["id"],
        )
        await append_event(
            connection,
            org_unit_id=org["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="org.create",
            payload={"team_id": str(team["id"]), "user_unit_id": str(user_unit["id"])},
        )
        return {**dict(org), "team_id": team["id"], "user_unit_id": user_unit["id"]}


@router.post("/org-units/{org_unit_id}/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(
    org_unit_id: UUID,
    body: InviteCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    email = body.email.strip().lower()
    async with transaction(get_pool(request)) as connection:
        team = await connection.fetchrow("select * from org_units where id=$1", org_unit_id)
        if not team:
            raise ApiError(404, "org_unit_not_found", "This org unit could not be found.")
        if team["role"] != "team":
            raise ApiError(422, "invite_target_not_team", "Invites must target a team.")
        await require_admin(connection, principal, org_unit_id)
        if body.admin_level and body.admin_unit_id:
            await require_admin(connection, principal, body.admin_unit_id)
        elif body.admin_level or body.admin_unit_id:
            raise ApiError(
                422,
                "invalid_invite_admin",
                "Admin level and admin unit must be set together.",
            )
        try:
            invite = await connection.fetchrow(
                """insert into org_invites
                   (team_unit_id,admin_unit_id,admin_level,email,invited_by)
                   values($1,$2,$3,$4,$5) returning *""",
                org_unit_id,
                body.admin_unit_id,
                body.admin_level,
                email,
                principal.auth_user_id,
            )
        except asyncpg.UniqueViolationError as exc:
            raise ApiError(
                409, "invite_pending", "That email already has a pending invite."
            ) from exc
        await append_event(
            connection,
            org_unit_id=org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="member.invite",
            payload={"invite_id": str(invite["id"]), "email": email},
        )
    try:
        await invite_email(get_settings(), email)
    except ApiError:
        pass
    return dict(invite)


@router.get("/org-units/{org_unit_id}/invites")
async def list_invites(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> list[dict]:
    await require_admin(get_pool(request), principal, org_unit_id)
    rows = await get_pool(request).fetch(
        """select * from org_invites
           where team_unit_id=$1
           order by created_at desc""",
        org_unit_id,
    )
    return [dict(row) for row in rows]


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> Response:
    async with transaction(get_pool(request)) as connection:
        invite = await connection.fetchrow("select * from org_invites where id=$1", invite_id)
        if not invite:
            raise ApiError(404, "invite_not_found", "This invite could not be found.")
        if invite["accepted_at"] is not None:
            raise ApiError(409, "invite_accepted", "This invite has already been accepted.")
        await require_admin(connection, principal, invite["team_unit_id"])
        await connection.execute("delete from org_invites where id=$1", invite_id)
        await append_event(
            connection,
            org_unit_id=invite["team_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="member.invite_revoke",
            payload={"invite_id": str(invite_id)},
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/org-units", status_code=status.HTTP_201_CREATED)
async def create_org_unit(
    body: OrgUnitCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    pool = get_pool(request)
    if body.parent_id is None:
        raise ApiError(403, "admin_required", "You need administrator access to create a root org.")
    async with transaction(pool) as connection:
        parent = await connection.fetchrow("select * from org_units where id=$1", body.parent_id)
        if not parent:
            raise ApiError(404, "org_unit_not_found", "The parent org unit could not be found.")
        await require_admin(connection, principal, body.parent_id)
        validate_role_order(body.role, parent["role"])
        unit = await connection.fetchrow(
            """insert into org_units(parent_id,role,name,path,region)
               values($1,$2,$3,$4,$5) returning *""",
            body.parent_id,
            body.role,
            body.name,
            f"{parent['path']}.{slugify(body.name)}",
            parent["region"],
        )
        await append_event(
            connection,
            org_unit_id=unit["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="org_unit.create",
            payload={"parent_id": str(body.parent_id), "role": body.role, "name": body.name},
        )
        return dict(unit)


@router.get("/org-units/{org_unit_id}/boundary")
async def get_boundary(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    pool = get_pool(request)
    from app.api.deps import can_read

    if not await can_read(pool, principal, user_unit["id"], org_unit_id):
        raise ApiError(403, "org_unit_not_visible", "You do not have access to this org unit.")
    own = await pool.fetchval(
        "select policy from org_unit_boundaries where org_unit_id=$1", org_unit_id
    )
    return {"own": dict(own or {}), "effective": await effective_boundary(pool, org_unit_id)}


@router.put("/org-units/{org_unit_id}/boundary")
async def put_boundary(
    org_unit_id: UUID,
    body: Boundary,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    own = body.model_dump(exclude_none=True, exclude_unset=True)
    async with transaction(get_pool(request)) as connection:
        await require_admin(connection, principal, org_unit_id)
        parent_id = await connection.fetchval(
            "select parent_id from org_units where id=$1", org_unit_id
        )
        if parent_id:
            validate_tightening(own, await effective_boundary(connection, parent_id))
        await connection.execute(
            """insert into org_unit_boundaries(org_unit_id,policy,updated_by)
               values($1,$2,$3) on conflict(org_unit_id) do update
               set policy=excluded.policy,updated_by=excluded.updated_by,updated_at=now()""",
            org_unit_id,
            json.dumps(own),
            principal.auth_user_id,
        )
        await append_event(
            connection,
            org_unit_id=org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="boundary.update",
            payload={"policy": own},
        )
        return {"own": own, "effective": await effective_boundary(connection, org_unit_id)}


@router.post("/org-units/{org_unit_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(
    org_unit_id: UUID,
    body: MemberCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        await require_admin(connection, principal, org_unit_id)
        team = await connection.fetchrow("select * from org_units where id=$1", org_unit_id)
        if not team:
            raise ApiError(404, "org_unit_not_found", "This org unit could not be found.")
        validate_role_order("user", team["role"])
        unit = await connection.fetchrow(
            """insert into org_units(parent_id,role,name,path,region)
               values($1,'user',$2,$3,$4) returning *""",
            org_unit_id,
            body.name,
            f"{team['path']}.{slugify(body.name)}",
            team["region"],
        )
        await connection.execute(
            "insert into org_unit_members(auth_user_id,user_unit_id) values($1,$2)",
            body.auth_user_id,
            unit["id"],
        )
        await append_event(
            connection,
            org_unit_id=org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="member.add",
            payload={"auth_user_id": str(body.auth_user_id), "user_unit_id": str(unit["id"])},
        )
        return dict(unit)


@router.get("/org-units/{org_unit_id}/members")
async def members(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> list[dict]:
    await require_admin(get_pool(request), principal, org_unit_id)
    rows = await get_pool(request).fetch(
        """select m.auth_user_id,u.id user_unit_id,u.name,u.path
           from org_units u join org_unit_members m on m.user_unit_id=u.id
           where u.parent_id=$1 order by u.name""",
        org_unit_id,
    )
    return [dict(row) for row in rows]
