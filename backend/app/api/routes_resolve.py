from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps import current_principal, current_user_unit
from app.db import get_pool, transaction
from app.domain.audit import append_event
from app.domain.harnesses import assignments, visible_harness, visible_harnesses
from app.domain.org_tree import effective_boundary
from app.domain.resolve import model_from_assets, resolved_assets
from app.identity import Principal

router = APIRouter(tags=["resolution"])


@router.get("/resolve")
async def resolve(
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
    harness_id: UUID | None = None,
) -> dict:
    """Everything a session is entitled to, plus which harness asked.

    The asset list is the full resolved set whatever the harness: the client
    hydrates from all of it and lays out a session from the names the harness
    contains. With no harness the whole set is laid out, which is how
    sessions behaved before harnesses existed — no harness is not an empty
    harness.

    A harness that has been deleted or unshared is a 404 rather than a silent
    fall back, because the caller asked for a specific working context and is
    not getting it.
    """
    async with transaction(get_pool(request)) as connection:
        harness = (
            await visible_harness(connection, user_unit["id"], harness_id)
            if harness_id is not None
            else None
        )
        assets = await resolved_assets(connection, user_unit["id"])
        boundary = await effective_boundary(connection, user_unit["id"])
        model = model_from_assets(assets)
        if model:
            key = await connection.fetchrow(
                "select env_var from api_keys where ref=$1", model.get("key_ref")
            )
            model["env_var"] = key["env_var"] if key else None
        manifest = {
            "manifest_version": 4,
            "issued_at": datetime.now(UTC),
            "ttl_seconds": 900,
            "user": {
                "auth_user_id": principal.auth_user_id,
                "email": principal.email,
                "org_unit_path": user_unit["path"],
            },
            "harness": (
                {
                    "id": harness["id"],
                    "name": harness["name"],
                    "description": harness["description"],
                    "icon": harness["icon"],
                    "org_unit_path": harness["org_unit_path"],
                    # What it contains, by name. The client keeps the assets
                    # whose (kind, name) is on this list and no others.
                    "assets": await assignments(connection, harness["id"]),
                }
                if harness
                else None
            ),
            # Named, so the CLI can say "you have three and none is selected"
            # without a second request.
            "harnesses": [
                {"id": row["id"], "name": row["name"], "org_unit_path": row["org_unit_path"]}
                for row in await visible_harnesses(connection, user_unit["id"])
            ],
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
            payload={"model": model, "harness_id": str(harness_id) if harness_id else None},
        )
        return manifest
