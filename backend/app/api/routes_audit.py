import json
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import (
    current_principal,
    current_user_unit,
    require_admin,
)
from app.db import get_pool, transaction
from app.domain.audit import append_event, descendant_events, verify_records
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["audit"])


class AttestedEvent(BaseModel):
    action: str = Field(min_length=1, max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime


class AuditBatch(BaseModel):
    events: list[AttestedEvent] = Field(max_length=100)


@router.post("/audit/batch")
async def audit_batch(
    body: AuditBatch,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        for event in body.events:
            payload = {**event.payload, "occurred_at": event.occurred_at.isoformat()}
            if len(json.dumps(payload, separators=(",", ":")).encode()) > 8192:
                raise ApiError(
                    422,
                    "audit_payload_too_large",
                    "Each audit event payload must be no larger than 8 KiB.",
                )
            await append_event(
                connection,
                org_unit_id=user_unit["id"],
                actor_type=principal.actor_type,
                actor_id=principal.auth_user_id,
                event_class="attested",
                action=event.action,
                payload=payload,
            )
    return {"accepted": len(body.events)}


@router.get("/org-units/{org_unit_id}/audit")
async def query_audit(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    after: int | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[dict]:
    pool = get_pool(request)
    await require_admin(pool, principal, org_unit_id)
    return await descendant_events(pool, org_unit_id, after=after, limit=limit)


@router.get("/org-units/{org_unit_id}/audit/verify")
async def verify_audit(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    pool = get_pool(request)
    await require_admin(pool, principal, org_unit_id)
    rows = await pool.fetch("select * from audit_log where org_unit_id=$1 order by id", org_unit_id)
    return verify_records([dict(row) for row in rows])
