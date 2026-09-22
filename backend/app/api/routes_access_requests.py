"""The one endpoint a stranger may call.

The public site has no sign-up: an address asks for an invite here, and an
admin decides. Because it is unauthenticated it assumes bad faith — it takes
only what a human would type, answers every caller the same way, keeps no raw
IP, and limits how often one source may write.
"""

import hashlib
import re
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.db import get_pool
from app.errors import ApiError

router = APIRouter(tags=["access requests"])

# Deliberately loose: the address is confirmed by mailing it, not by a regex.
EMAIL = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")

WINDOW = timedelta(hours=1)
PER_WINDOW = 5


class AccessRequest(BaseModel):
    email: str = Field(max_length=254)
    name: str | None = Field(default=None, max_length=120)
    company: str | None = Field(default=None, max_length=120)
    team_size: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=1000)
    # A field no person sees and no browser fills. Anything in it is a bot.
    company_website: str | None = Field(default=None, max_length=200)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def _ip_hash(ip: str) -> str | None:
    """A salted digest. It survives long enough to rate limit and no longer."""
    if not ip:
        return None
    salt = get_settings().harness_master_key or "harness"
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()


@router.post("/access-requests", status_code=status.HTTP_202_ACCEPTED)
async def create_access_request(body: AccessRequest, request: Request) -> dict:
    email = body.email.strip()
    if not EMAIL.match(email):
        raise ApiError(422, "invalid_email", "Please enter a valid email address.")

    # Silently accept the bot. Telling it what gave it away only helps it.
    if body.company_website:
        return {"status": "received"}

    ip_hash = _ip_hash(_client_ip(request))
    pool = get_pool(request)

    if ip_hash:
        recent = await pool.fetchval(
            "select count(*) from access_requests where ip_hash=$1 and created_at > $2",
            ip_hash,
            datetime.now(UTC) - WINDOW,
        )
        if recent and recent >= PER_WINDOW:
            raise ApiError(429, "too_many_requests", "Too many requests. Please try again later.")

    def clean(value: str | None) -> str | None:
        trimmed = (value or "").strip()
        return trimmed or None

    # Asking twice is not an error, and the answer must not reveal which it was.
    await pool.execute(
        """insert into access_requests (email,name,company,team_size,note,ip_hash)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (lower(email)) do update
             set name = coalesce(excluded.name, access_requests.name),
                 company = coalesce(excluded.company, access_requests.company),
                 team_size = coalesce(excluded.team_size, access_requests.team_size),
                 note = coalesce(excluded.note, access_requests.note)""",
        email,
        clean(body.name),
        clean(body.company),
        clean(body.team_size),
        clean(body.note),
        ip_hash,
    )
    return {"status": "received"}
