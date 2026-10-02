from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.api.deps import (
    can_read,
    current_principal,
    current_user_unit,
    require_admin,
)
from app.config import get_settings
from app.db import get_pool, transaction
from app.domain import broker
from app.domain.api_keys import key_ref, rotate, visible_keys
from app.domain.audit import append_event
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["API keys"])


class ApiKeyCreate(BaseModel):
    org_unit_id: UUID
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["provider_api_key", "static_api_key"]
    env_var: str = Field(pattern=r"^[A-Z_][A-Z0-9_]*$")
    value: str = Field(min_length=1)


class RotateInput(BaseModel):
    value: str = Field(min_length=1)


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
async def create_key(
    body: ApiKeyCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        await require_admin(connection, principal, body.org_unit_id)
        path = await connection.fetchval("select path from org_units where id=$1", body.org_unit_id)
        if not path:
            raise ApiError(404, "org_unit_not_found", "This org unit could not be found.")
        key = await connection.fetchrow(
            """insert into api_keys(org_unit_id,name,ref,kind,env_var,created_by)
               values($1,$2,$3,$4,$5,$6) returning *""",
            body.org_unit_id,
            body.name,
            key_ref(path, body.name),
            body.kind,
            body.env_var,
            principal.auth_user_id,
        )
        version = await rotate(
            connection,
            key["id"],
            body.value,
            master_key=get_settings().harness_master_key,
        )
        await append_event(
            connection,
            org_unit_id=body.org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="api_key.create",
            payload={"api_key_id": str(key["id"]), "ref": key["ref"]},
        )
        return {
            **dict(key),
            "last4": version["last4"],
            "version": version["version"],
            "status": version["status"],
        }


@router.get("/org-units/{org_unit_id}/api-keys")
async def list_keys(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    pool = get_pool(request)
    if not await can_read(pool, principal, user_unit["id"], org_unit_id):
        raise ApiError(403, "org_unit_not_visible", "You do not have access to this org unit.")
    return await visible_keys(pool, org_unit_id)


@router.post("/api-keys/{api_key_id}/rotate")
async def rotate_key(
    api_key_id: UUID,
    body: RotateInput,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        key = await connection.fetchrow("select * from api_keys where id=$1", api_key_id)
        if not key:
            raise ApiError(404, "api_key_not_found", "This API key could not be found.")
        await require_admin(connection, principal, key["org_unit_id"])
        version = await rotate(
            connection,
            api_key_id,
            body.value,
            master_key=get_settings().harness_master_key,
        )
        # 04 §5.6: rotation retires the alias on live sessions.
        await broker.retire_for_key(connection, api_key_id)
        await append_event(
            connection,
            org_unit_id=key["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="api_key.rotate",
            payload={"api_key_id": str(api_key_id), "version": version["version"]},
        )
        return {
            "id": api_key_id,
            "version": version["version"],
            "last4": version["last4"],
            "status": version["status"],
        }
