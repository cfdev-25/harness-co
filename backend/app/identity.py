import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

import asyncpg
import jwt

from app.config import Settings
from app.errors import ApiError


@dataclass(frozen=True)
class Principal:
    auth_user_id: UUID
    email: str | None = None
    actor_type: str = "user"


class IdentityProvider(Protocol):
    async def verify(self, token: str) -> Principal | None: ...


class PatProvider:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    async def verify(self, token: str) -> Principal | None:
        if not token.startswith("hpat_"):
            return None
        token_hash = hashlib.sha256(token.removeprefix("hpat_").encode()).hexdigest()
        row = await self.pool.fetchrow(
            """select auth_user_id from personal_access_tokens
               where token_hash=$1 and (expires_at is null or expires_at > now())""",
            token_hash,
        )
        return Principal(row["auth_user_id"]) if row else None


class SupabaseJwtProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def verify(self, token: str) -> Principal | None:
        if token.startswith("hpat_"):
            return None
        try:
            if self.settings.supabase_jwks_url:
                key = jwt.PyJWKClient(self.settings.supabase_jwks_url).get_signing_key_from_jwt(
                    token
                )
                claims = jwt.decode(
                    token, key.key, algorithms=["RS256", "ES256"], audience="authenticated"
                )
            elif self.settings.supabase_jwt_secret:
                claims = jwt.decode(
                    token,
                    self.settings.supabase_jwt_secret,
                    algorithms=["HS256"],
                    audience="authenticated",
                    options={"verify_aud": False},
                )
            else:
                return None
            return Principal(UUID(claims["sub"]), claims.get("email"))
        except (jwt.PyJWTError, KeyError, ValueError):
            return None


async def verify_authorization(
    authorization_header: str | None, pool: asyncpg.Pool, settings: Settings
) -> Principal:
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise ApiError(401, "authentication_required", "Please sign in to continue.")
    token = authorization_header[7:].strip()
    for provider in (PatProvider(pool), SupabaseJwtProvider(settings)):
        principal = await provider.verify(token)
        if principal:
            return principal
    raise ApiError(401, "invalid_token", "Your access token is invalid or has expired.")


def token_is_expired(expires_at: datetime | None) -> bool:
    return expires_at is not None and expires_at <= datetime.now(UTC)
