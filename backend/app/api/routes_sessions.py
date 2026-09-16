import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field

from app.api.deps import current_principal, current_user_unit, require_write
from app.db import get_pool
from app.domain.harness_sessions import owned_session
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["sessions"])


class SessionCreate(BaseModel):
    id: UUID
    org_unit_id: UUID | None = None
    name: str | None = Field(default=None, max_length=200)
    access: dict[str, Any] = Field(default_factory=lambda: {"visibility": "private"})
    model_metadata: dict[str, Any] = Field(default_factory=dict)


class SessionUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    status: Literal["active", "closed"] | None = None
    access: dict[str, Any] | None = None
    last_active_at: datetime | None = None


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    target = body.org_unit_id or user_unit["id"]
    await require_write(get_pool(request), principal, user_unit["id"], target)
    row = await get_pool(request).fetchrow(
        """insert into harness_sessions
           (id,org_unit_id,owner_auth_user_id,name,access,model_metadata)
           values($1,$2,$3,$4,$5,$6) returning *""",
        body.id,
        target,
        principal.auth_user_id,
        body.name,
        json.dumps(body.access),
        json.dumps(body.model_metadata),
    )
    return dict(row)


@router.get("/sessions")
async def list_sessions(
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> list[dict]:
    rows = await get_pool(request).fetch(
        "select * from harness_sessions where owner_auth_user_id=$1 order by last_active_at desc",
        principal.auth_user_id,
    )
    return [dict(row) for row in rows]


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    return await owned_session(get_pool(request), session_id, principal.auth_user_id)


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: UUID,
    body: SessionUpdate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    pool = get_pool(request)
    current = await owned_session(pool, session_id, principal.auth_user_id)
    values = body.model_dump(exclude_unset=True)
    row = await pool.fetchrow(
        """update harness_sessions set
             name=$2,status=$3,access=$4,last_active_at=coalesce($5,now())
           where id=$1 returning *""",
        session_id,
        values.get("name", current["name"]),
        values.get("status", current["status"]),
        json.dumps(values.get("access", current["access"])),
        values.get("last_active_at"),
    )
    return dict(row)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> Response:
    session = await owned_session(get_pool(request), session_id, principal.auth_user_id)
    if session["legal_hold"]:
        raise ApiError(
            409,
            "session_on_legal_hold",
            "This session cannot be deleted while it is on legal hold.",
        )
    await get_pool(request).execute("delete from harness_sessions where id=$1", session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
