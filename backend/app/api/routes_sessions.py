"""The session endpoints (00 §4.10; 04 §5.3–§5.7)."""

import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field

from app.api.deps import current_principal
from app.db import get_pool, transaction
from app.domain import broker
from app.domain.audit import append_event
from app.domain.harness_sessions import owned_session
from app.identity import Principal

router = APIRouter(tags=["sessions"])


class OpenSession(BaseModel):
    id: UUID
    provider: str
    provider_version: str  # D62: from Adapter.locate(); locate precedes mint
    harness: UUID | None = None
    model: tuple[str, str]
    aliases: list[str] = Field(default_factory=list, max_length=64)
    commits: dict[str, str] = Field(default_factory=dict)
    # W5-D14: where the session ran and on which machine. Optional, so a CLI
    # one version behind still opens a session; the owner alone reads them
    # back (console 04 §4).
    workspace: str | None = Field(default=None, max_length=4096)
    hostname: str | None = Field(default=None, max_length=255)


class EndpointTally(BaseModel):
    host: str
    port: int
    alias: str | None = None
    count: int
    refused: int
    # D134: a request that went with a provider-side capability taken out of
    # it, and the reasons this group carried. Defaulted, because a CLI one
    # version behind still closes its session.
    stripped: int = 0
    reasons: dict[str, int] = Field(default_factory=dict)
    firstAt: str
    lastAt: str


class SessionUpdate(BaseModel):
    last_active_at: datetime | None = None
    preflight: dict[str, Any] | None = None
    status: Literal["closed"] | None = None
    endpoints: list[EndpointTally] | None = None


class EndpointBatch(BaseModel):
    events: list[dict[str, Any]] = Field(max_length=500)


class Revoke(BaseModel):
    reason: str = Field(default="revoked", max_length=200)


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: OpenSession,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    return await broker.open_session(
        get_pool(request), principal.auth_user_id, principal.email, body
    )


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    """5.4. Owner only; what the proxy polls, and the supervisor's fallback
    when a heartbeat fails (08 §9 step 3)."""
    row = await owned_session(get_pool(request), session_id, principal.auth_user_id)
    return _validity(row)


def _validity(row: dict) -> dict:
    retired = [
        alias for alias, slot in (row["slots"] or {}).items() if slot.get("retired") is True
    ]
    return {"status": row["status"], "retired": retired, "revoked_reason": row["revoked_reason"]}


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: UUID,
    body: SessionUpdate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        session = await broker.owned_active(connection, session_id, principal)
        if body.status == "closed":
            tally = [item.model_dump() for item in (body.endpoints or [])]
            outcome = await broker.close(connection, session, tally)
            await append_event(
                connection,
                org_unit_id=session["org_unit_id"],
                actor_type="user",
                actor_id=principal.auth_user_id,
                event_class="authoritative",
                action="session.close",
                payload={"endpoints_tally": tally, **outcome},
            )
            return {"status": "closed", **outcome}
        # The report is written once by the first supervise tick and never
        # again (04 §6, console D7); `coalesce` is that, without a second code.
        await connection.execute(
            """update harness_sessions
                  set last_active_at = coalesce($2, now()),
                      preflight = coalesce(preflight, $3)
                where id=$1""",
            session_id,
            body.last_active_at,
            json.dumps(body.preflight) if body.preflight is not None else None,
        )
        # The heartbeat answers with what `GET` would say, so a tick is one
        # request, not two (08 §9 step 3, D145). `owned_active` read the row
        # inside this transaction, and a retirement set since is caught by the
        # next tick, fifteen seconds on — the same lag the second request had.
        return _validity(session)


@router.post("/sessions/{session_id}/endpoints", status_code=status.HTTP_204_NO_CONTENT)
async def post_endpoints(
    session_id: UUID,
    body: EndpointBatch,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> Response:
    """5.7. Authoritative: these come from the proxy (C29), one event per row."""
    async with transaction(get_pool(request)) as connection:
        session = await broker.owned_active(connection, session_id, principal)
        for event in body.events:
            await append_event(
                connection,
                org_unit_id=session["org_unit_id"],
                actor_type="user",
                actor_id=principal.auth_user_id,
                event_class="authoritative",
                action="session.endpoint",
                payload=event,
            )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/{session_id}/revoke")
async def revoke_session(
    session_id: UUID,
    body: Revoke,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        session = await broker.owned_active(connection, session_id, principal, admins_too=True)
        await broker.mark_revoked(connection, session_id, body.reason)
        await append_event(
            connection,
            org_unit_id=session["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="session.revoke",
            payload={"reason": body.reason, "refs": list((session["commits"] or {}).keys())},
        )
    return {"status": "revoked", "revoked_reason": body.reason}
