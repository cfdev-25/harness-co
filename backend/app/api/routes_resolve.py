from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import current_principal, current_user_unit
from app.db import get_pool, transaction
from app.domain.audit import append_event
from app.domain.org_tree import effective_boundary
from app.domain.resolve import model_from_assets, resolved_assets
from app.identity import Principal

router = APIRouter(tags=["resolution"])


@router.get("/resolve")
async def resolve(
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        assets = await resolved_assets(connection, user_unit["id"])
        boundary = await effective_boundary(connection, user_unit["id"])
        model = model_from_assets(assets)
        if model:
            key = await connection.fetchrow(
                "select env_var from api_keys where ref=$1", model.get("key_ref")
            )
            model["env_var"] = key["env_var"] if key else None
        manifest = {
            "manifest_version": 3,
            "issued_at": datetime.now(UTC),
            "ttl_seconds": 900,
            "user": {
                "auth_user_id": principal.auth_user_id,
                "email": principal.email,
                "org_unit_path": user_unit["path"],
            },
            "assets": assets,
            "boundary": boundary,
            "model": model,
        }
        await append_event(
            connection,
            org_unit_id=user_unit["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="resolve",
            payload={"model": model},
        )
        return manifest
