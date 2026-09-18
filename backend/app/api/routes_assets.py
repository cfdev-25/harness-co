import base64
import json
from datetime import UTC
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.api.deps import (
    can_read,
    current_principal,
    current_user_unit,
    is_admin,
    require_admin,
    require_write,
)
from app.db import get_pool, transaction
from app.domain.asset_store import decode_files, lint_files, push_version
from app.domain.audit import append_event
from app.domain.org_tree import effective_boundary
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["assets"])


class FileInput(BaseModel):
    path: str
    content_b64: str


class AssetCreate(BaseModel):
    org_unit_id: UUID
    kind: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=500)
    files: list[FileInput]


class VersionCreate(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    parent_version_id: UUID | None
    files: list[FileInput]


class PromoteInput(BaseModel):
    target_org_unit_id: UUID
    message: str | None = None


class RollbackInput(BaseModel):
    to_version_id: UUID


async def _visible_refs(connection, org_unit_id: UUID) -> set[str]:
    rows = await connection.fetch(
        """with recursive chain as (
             select id,parent_id from org_units where id=$1
             union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
           ) select k.ref from api_keys k join chain c on c.id=k.org_unit_id""",
        org_unit_id,
    )
    return {row["ref"] for row in rows}


async def _asset_access(connection, principal, user_unit, asset_id):
    asset = await connection.fetchrow("select * from assets where id=$1", asset_id)
    if not asset:
        raise ApiError(404, "asset_not_found", "This asset could not be found.")
    if not await can_read(connection, principal, user_unit["id"], asset["org_unit_id"]):
        raise ApiError(403, "asset_not_visible", "You do not have access to this asset.")
    return asset


@router.get("/org-units/{org_unit_id}/assets")
async def list_assets(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    pool = get_pool(request)
    if not await can_read(pool, principal, user_unit["id"], org_unit_id):
        raise ApiError(403, "org_unit_not_visible", "You do not have access to this org unit.")
    rows = await pool.fetch(
        """select a.*,v.seq head_seq,v.message head_message from assets a
           left join asset_versions v on v.id=a.head_version_id
           where a.org_unit_id=$1 order by a.kind,a.name""",
        org_unit_id,
    )
    return [dict(row) for row in rows]


@router.get("/assets/{asset_id}")
async def get_asset(
    asset_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    asset = await _asset_access(get_pool(request), principal, user_unit, asset_id)
    return dict(asset)


@router.post("/assets", status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    files = decode_files([item.model_dump() for item in body.files])
    async with transaction(get_pool(request)) as connection:
        await require_write(connection, principal, user_unit["id"], body.org_unit_id)
        lint_files(
            files,
            await effective_boundary(connection, body.org_unit_id),
            await _visible_refs(connection, body.org_unit_id),
        )
        known = await connection.fetchval(
            "select exists(select 1 from asset_kinds where kind=$1)", body.kind
        )
        if not known:
            rows = await connection.fetch("select kind from asset_kinds order by kind")
            kinds = ", ".join(row["kind"] for row in rows)
            raise ApiError(
                422,
                "unknown_asset_kind",
                f"Unknown kind '{body.kind}'. Known kinds: {kinds}.",
            )
        asset = await connection.fetchrow(
            """insert into assets(org_unit_id,kind,name) values($1,$2,$3) returning *""",
            body.org_unit_id,
            body.kind,
            body.name,
        )
        pending = (await effective_boundary(connection, body.org_unit_id)).get(
            "build_policy", {}
        ).get("push_review", False) and not await is_admin(
            connection, principal.auth_user_id, body.org_unit_id
        )
        version = await push_version(
            connection,
            asset_id=asset["id"],
            parent_version_id=None,
            files=files,
            author_id=principal.auth_user_id,
            message=body.message,
            provenance={"pending_review": True} if pending else {},
            make_head=not pending,
        )
        await append_event(
            connection,
            org_unit_id=body.org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.create",
            payload={"asset_id": str(asset["id"]), "version_id": str(version["id"])},
        )
        return {**dict(asset), "version": version}


@router.post("/assets/{asset_id}/versions", status_code=status.HTTP_201_CREATED)
async def create_version(
    asset_id: UUID,
    body: VersionCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    files = decode_files([item.model_dump() for item in body.files])
    async with transaction(get_pool(request)) as connection:
        asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_write(connection, principal, user_unit["id"], asset["org_unit_id"])
        boundary = await effective_boundary(connection, asset["org_unit_id"])
        lint_files(files, boundary, await _visible_refs(connection, asset["org_unit_id"]))
        pending = boundary["build_policy"]["push_review"] and not await is_admin(
            connection, principal.auth_user_id, asset["org_unit_id"]
        )
        version = await push_version(
            connection,
            asset_id=asset_id,
            parent_version_id=body.parent_version_id,
            files=files,
            author_id=principal.auth_user_id,
            message=body.message,
            provenance={"pending_review": True} if pending else {},
            make_head=not pending,
        )
        await append_event(
            connection,
            org_unit_id=asset["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.push",
            payload={"asset_id": str(asset_id), "version_id": str(version["id"])},
        )
        return version


@router.post("/assets/{asset_id}/versions/{version_id}/approve")
async def approve_version(
    asset_id: UUID,
    version_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        asset = await connection.fetchrow("select * from assets where id=$1 for update", asset_id)
        if not asset:
            raise ApiError(404, "asset_not_found", "This asset could not be found.")
        await require_admin(connection, principal, asset["org_unit_id"])
        version = await connection.fetchrow(
            "select * from asset_versions where id=$1 and asset_id=$2", version_id, asset_id
        )
        if not version:
            raise ApiError(404, "version_not_found", "This version could not be found.")
        provenance = dict(version["provenance"])
        provenance.pop("pending_review", None)
        provenance["approved_by"] = str(principal.auth_user_id)
        await connection.execute(
            "update asset_versions set provenance=$2 where id=$1",
            version_id,
            json.dumps(provenance),
        )
        await connection.execute(
            "update assets set head_version_id=$2 where id=$1", asset_id, version_id
        )
        await append_event(
            connection,
            org_unit_id=asset["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.approve",
            payload={"asset_id": str(asset_id), "version_id": str(version_id)},
        )
        return {"approved": True, "version_id": version_id}


async def _copy_version(
    connection,
    *,
    asset_id: UUID,
    parent_id: UUID | None,
    source,
    author_id: UUID,
    message: str,
    provenance: dict,
):
    seq = await connection.fetchval(
        "select coalesce(max(seq),0)+1 from asset_versions where asset_id=$1", asset_id
    )
    row = await connection.fetchrow(
        """insert into asset_versions
           (asset_id,parent_version_id,seq,file_hashes,author_auth_user_id,message,provenance)
           values($1,$2,$3,$4,$5,$6,$7) returning *""",
        asset_id,
        parent_id,
        seq,
        json.dumps(dict(source["file_hashes"])),
        author_id,
        message,
        json.dumps(provenance),
    )
    await connection.execute(
        "update assets set head_version_id=$2 where id=$1", asset_id, row["id"]
    )
    return row


@router.post("/assets/{asset_id}/promote")
async def promote(
    asset_id: UUID,
    body: PromoteInput,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        source_asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_admin(connection, principal, body.target_org_unit_id)
        source = await connection.fetchrow(
            "select * from asset_versions where id=$1", source_asset["head_version_id"]
        )
        if not source:
            raise ApiError(409, "no_active_version", "This asset does not have an active version.")
        target = await connection.fetchrow(
            "select * from assets where org_unit_id=$1 and kind=$2 and name=$3 for update",
            body.target_org_unit_id,
            source_asset["kind"],
            source_asset["name"],
        )
        if not target:
            target = await connection.fetchrow(
                "insert into assets(org_unit_id,kind,name) values($1,$2,$3) returning *",
                body.target_org_unit_id,
                source_asset["kind"],
                source_asset["name"],
            )
        version = await _copy_version(
            connection,
            asset_id=target["id"],
            parent_id=target["head_version_id"],
            source=source,
            author_id=principal.auth_user_id,
            message=body.message or f"Promoted {source_asset['name']}.",
            provenance={"promoted_from": str(source["id"])},
        )
        await append_event(
            connection,
            org_unit_id=body.target_org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.promote",
            payload={"asset_id": str(target["id"]), "source_version_id": str(source["id"])},
        )
        return {**dict(target), "version": dict(version)}


@router.post("/assets/{asset_id}/rollback")
async def rollback(
    asset_id: UUID,
    body: RollbackInput,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_write(connection, principal, user_unit["id"], asset["org_unit_id"])
        source = await connection.fetchrow(
            "select * from asset_versions where id=$1 and asset_id=$2",
            body.to_version_id,
            asset_id,
        )
        if not source:
            raise ApiError(404, "version_not_found", "The version to restore could not be found.")
        date = source["created_at"].astimezone(UTC).date().isoformat()
        version = await _copy_version(
            connection,
            asset_id=asset_id,
            parent_id=asset["head_version_id"],
            source=source,
            author_id=principal.auth_user_id,
            message=f"Restored the version from {date}.",
            provenance={"restored": str(source["id"])},
        )
        await append_event(
            connection,
            org_unit_id=asset["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.rollback",
            payload={"asset_id": str(asset_id), "version_id": str(version["id"])},
        )
        return dict(version)


@router.get("/assets/{asset_id}/history")
async def history(
    asset_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    await _asset_access(get_pool(request), principal, user_unit, asset_id)
    rows = await get_pool(request).fetch(
        """select v.id,v.seq,v.message,v.created_at,v.provenance,v.author_auth_user_id,
                  v.author_auth_user_id::text author_email
           from asset_versions v where v.asset_id=$1 order by v.seq desc""",
        asset_id,
    )
    return [
        {
            "id": row["id"],
            "seq": row["seq"],
            "message": row["message"],
            "author_email": row["author_email"],
            "created_at": row["created_at"],
            "provenance": row["provenance"],
        }
        for row in rows
    ]


@router.get("/assets/{asset_id}/versions/{version_id}/files")
async def files(
    asset_id: UUID,
    version_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    await _asset_access(get_pool(request), principal, user_unit, asset_id)
    version = await get_pool(request).fetchrow(
        "select file_hashes from asset_versions where id=$1 and asset_id=$2", version_id, asset_id
    )
    if not version:
        raise ApiError(404, "version_not_found", "This version could not be found.")
    hashes = dict(version["file_hashes"])
    rows = await get_pool(request).fetch(
        "select hash,content from asset_files where hash=any($1::text[])", list(hashes.values())
    )
    contents = {row["hash"]: row["content"] for row in rows}
    return [
        {"path": path, "content_b64": base64.b64encode(contents[digest]).decode()}
        for path, digest in sorted(hashes.items())
    ]
