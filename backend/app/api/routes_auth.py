import hashlib
import secrets
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.api.deps import current_principal, current_user_unit
from app.db import get_pool
from app.identity import Principal

router = APIRouter(tags=["authentication"])


class PatCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = None


@router.post("/personal-access-tokens", status_code=status.HTTP_201_CREATED)
async def create_pat(
    body: PatCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    raw = secrets.token_urlsafe(32)
    row = await get_pool(request).fetchrow(
        """insert into personal_access_tokens(auth_user_id,token_hash,name,expires_at)
           values($1,$2,$3,$4) returning id,name,expires_at,created_at""",
        principal.auth_user_id,
        hashlib.sha256(raw.encode()).hexdigest(),
        body.name,
        body.expires_at,
    )
    return {**dict(row), "token": f"hpat_{raw}"}


@router.get("/me")
async def me(
    principal: Annotated[Principal, Depends(current_principal)],
    unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    return {
        "auth_user_id": principal.auth_user_id,
        "email": principal.email,
        "org_unit_id": unit["id"],
        "org_unit_path": unit["path"],
    }
