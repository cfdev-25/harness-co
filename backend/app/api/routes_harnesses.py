import json
from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import can_read, current_principal, current_user_unit, require_write
from app.db import get_pool, transaction
from app.domain.audit import append_event
from app.domain.harnesses import Icon, assignments, visible_harness, visible_harnesses
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["harnesses"])


class HarnessCreate(BaseModel):
    org_unit_id: UUID
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=2000)
    icon: Icon = Field(default_factory=Icon)


class AssetRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)


class HarnessAssets(BaseModel):
    assets: list[AssetRef] = Field(max_length=500)


class HarnessUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=2000)
    icon: Icon | None = None


@router.get("/org-units/{org_unit_id}/harnesses")
async def list_harnesses(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    """The harnesses available at an org unit: its own and its ancestors'.

    Unlike the asset tabs this includes inherited rows, because "which
    harnesses can this team use" is the question the list exists to answer.
    """
    pool = get_pool(request)
    if not await can_read(pool, principal, user_unit["id"], org_unit_id):
        raise ApiError(403, "org_unit_not_visible", "You do not have access to this org unit.")
    return await visible_harnesses(pool, org_unit_id)


@router.post("/harnesses", status_code=status.HTTP_201_CREATED)
async def create_harness(
    body: HarnessCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        await require_write(connection, principal, user_unit["id"], body.org_unit_id)
        try:
            row = await connection.fetchrow(
                """insert into harnesses(org_unit_id,name,description,icon,created_by)
                   values($1,$2,$3,$4,$5) returning *""",
                body.org_unit_id,
                body.name.strip(),
                body.description,
                json.dumps(body.icon.model_dump()),
                principal.auth_user_id,
            )
        except asyncpg.UniqueViolationError as exc:
            raise ApiError(
                409, "harness_name_taken", "This org unit already has a harness with that name."
            ) from exc
        except asyncpg.ForeignKeyViolationError as exc:
            raise ApiError(404, "org_unit_not_found", "This org unit could not be found.") from exc
        await append_event(
            connection,
            org_unit_id=body.org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="harness.create",
            payload={"harness_id": str(row["id"]), "name": row["name"]},
        )
        return dict(row)


@router.get("/harnesses/{harness_id}")
async def get_harness(
    harness_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    """The harness, and everything that could be in it.

    One list: every name that resolves at the harness's own unit, each
    flagged with whether this harness contains it. That is both "what this
    loads" and "what you can add", which is why it is one request and one
    checkbox list rather than two of each.

    A name that is assigned but resolves to nothing here is included with no
    asset behind it, so an assignment can never be silently invisible.
    """
    pool = get_pool(request)
    harness = await visible_harness(pool, user_unit["id"], harness_id)
    rows = await pool.fetch(
        """with recursive chain as (
             select id,parent_id,0 depth from org_units where id=$1
             union all select p.id,p.parent_id,c.depth+1
             from org_units p join chain c on c.parent_id=p.id
           ), resolved as (
             select a.id asset_id,a.kind,a.name,u.path org_unit_path,
                    row_number() over(partition by a.kind,a.name order by c.depth asc) choice
               from chain c
               join assets a on a.org_unit_id=c.id and a.status='active'
               join org_units u on u.id=a.org_unit_id
           ), available as (
             select asset_id,kind,name,org_unit_path from resolved where choice=1
           ), assigned as (
             select kind,name from harness_assets where harness_id=$2
           )
           select coalesce(v.kind,g.kind) kind,
                  coalesce(v.name,g.name) name,
                  v.asset_id, v.org_unit_path,
                  g.kind is not null assigned
             from available v
             full join assigned g on g.kind=v.kind and g.name=v.name
            order by 1,2""",
        harness["org_unit_id"],
        harness_id,
    )
    return {**harness, "assets": [dict(row) for row in rows]}


@router.put("/harnesses/{harness_id}/assets")
async def set_harness_assets(
    harness_id: UUID,
    body: HarnessAssets,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    """Replace what a harness contains.

    Naming something grants nothing. A session still resolves each name the
    way that user always would, so a harness can only ever narrow what its
    owner already had.
    """
    async with transaction(get_pool(request)) as connection:
        harness = await visible_harness(connection, user_unit["id"], harness_id)
        await require_write(connection, principal, user_unit["id"], harness["org_unit_id"])
        wanted = list({(item.kind, item.name): None for item in body.assets})
        # Checked before anything is written, not by catching the foreign key:
        # once a statement has failed, the transaction is aborted and the
        # query needed to write a helpful message cannot run.
        if wanted:
            known = {row["kind"] for row in await connection.fetch("select kind from asset_kinds")}
            unknown = sorted({kind for kind, _ in wanted} - known)
            if unknown:
                raise ApiError(
                    422,
                    "unknown_asset_kind",
                    f"Unknown kind '{unknown[0]}'. Known kinds: {', '.join(sorted(known))}.",
                )
        await connection.execute("delete from harness_assets where harness_id=$1", harness_id)
        await connection.executemany(
            "insert into harness_assets(harness_id,kind,name) values($1,$2,$3)",
            [(harness_id, kind, name) for kind, name in wanted],
        )
        await append_event(
            connection,
            org_unit_id=harness["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="harness.assets",
            payload={
                "harness_id": str(harness_id),
                "assets": [{"kind": kind, "name": name} for kind, name in wanted],
            },
        )
        return {"assets": await assignments(connection, harness_id)}


@router.patch("/harnesses/{harness_id}")
async def update_harness(
    harness_id: UUID,
    body: HarnessUpdate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        harness = await visible_harness(connection, user_unit["id"], harness_id)
        await require_write(connection, principal, user_unit["id"], harness["org_unit_id"])
        values = body.model_dump(exclude_unset=True)
        icon = values.get("icon")
        try:
            row = await connection.fetchrow(
                """update harnesses
                      set name=$2, description=$3, icon=$4, updated_at=now()
                    where id=$1 returning *""",
                harness_id,
                (values.get("name") or harness["name"]).strip(),
                values.get("description", harness["description"]),
                json.dumps(icon if icon is not None else harness["icon"]),
            )
        except asyncpg.UniqueViolationError as exc:
            raise ApiError(
                409, "harness_name_taken", "This org unit already has a harness with that name."
            ) from exc
        await append_event(
            connection,
            org_unit_id=harness["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="harness.update",
            payload={"harness_id": str(harness_id), "fields": sorted(values)},
        )
        return dict(row)


@router.delete("/harnesses/{harness_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_harness(
    harness_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> Response:
    """Removes the harness and its assignments.

    Nothing else goes: an asset that was in it still exists, still has its
    history, and still resolves for everyone it resolved for before. It is
    simply not in a harness any more.
    """
    async with transaction(get_pool(request)) as connection:
        harness = await visible_harness(connection, user_unit["id"], harness_id)
        await require_write(connection, principal, user_unit["id"], harness["org_unit_id"])
        contents = await assignments(connection, harness_id)
        await connection.execute("delete from harnesses where id=$1", harness_id)
        await append_event(
            connection,
            org_unit_id=harness["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="harness.delete",
            payload={
                "harness_id": str(harness_id),
                "name": harness["name"],
                "assets": contents,
            },
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
