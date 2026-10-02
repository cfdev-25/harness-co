"""`GET /v1/me` (00 §4.10) — the chain the CLI composes from, and the role
preflight reads (03 D50; the broker is authoritative)."""

import os
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import current_principal
from app.db import get_pool
from app.domain import broker
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["identity"])


@router.get("/me")
async def read_me(
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    as_user: Annotated[UUID | None, Query(alias="as")] = None,
) -> dict:
    pool = get_pool(request)
    unit = await pool.fetchrow(
        """select u.id from org_unit_members m join org_units u on u.id=m.user_unit_id
            where m.auth_user_id=$1""",
        principal.auth_user_id,
    )
    if unit is None:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    org_id = await broker._org_id(pool, unit["id"])
    chain = await broker.chain_for(pool, unit["id"], principal.auth_user_id, org_id)
    role = await broker.role_on_chain(pool, principal.auth_user_id, chain)
    if as_user is not None:
        chain = await _member_chain(pool, principal, as_user, role)
    return {
        "user": {"id": str(principal.auth_user_id), "email": principal.email},
        "chain": chain,
        "role": role,
        # 01 §7.2: `origin` is `<definitions>/<org>.git`, and the CLI can derive
        # neither half from the chain — a ref name carries no host and no org id.
        # Without these two the supervisor has no remote to fetch (engine 08).
        "org": str(org_id),
        "definitions": os.environ.get("DEFINITIONS_URL", "").rstrip("/"),
    }


async def _member_chain(pool, principal: Principal, as_user: UUID, role: dict) -> list[dict]:
    """A team admin reading a member's branch (prd-v2 §18): their chain when
    `role.at` is on it, else 403."""
    member = await pool.fetchrow(
        """select u.id from org_unit_members m join org_units u on u.id=m.user_unit_id
            where m.auth_user_id=$1""",
        as_user,
    )
    if member is None:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    org_id = await broker._org_id(pool, member["id"])
    chain = await broker.chain_for(pool, member["id"], as_user, org_id)
    if role["at"] is None or role["at"] not in {node["path"] for node in chain}:
        raise ApiError(
            403,
            "console.as_forbidden",
            "You can read a member's versions only for teams you administer.",
        )
    return chain
