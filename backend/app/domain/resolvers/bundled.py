"""The bundled vault (04 §7.1, 11 §11.1): PyNaCl SecretBox over
`api_key_versions`, behind the resolver interface."""

from typing import Any

import asyncpg

from app.config import get_settings
from app.crypto import decrypt
from app.domain.resolvers import BUNDLED, Minted, Probe, SessionContext

_ACTIVE = """select v.version, v.ciphertext from api_keys k
               join api_key_versions v on v.api_key_id=k.id and v.status='active'
              where k.ref=$1"""


class Bundled:
    id = BUNDLED

    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    async def probe(self, ref: str) -> Probe:
        row = await self._connection.fetchrow(_ACTIVE, ref)
        if row is None:
            return {"ready": False, "evidence": "declared", "detail": "no active version"}
        return {
            "ready": True,
            "evidence": "verified",
            "detail": f"active version {row['version']}",
        }

    async def resolve(
        self, ref: str, session: SessionContext, mint: dict[str, Any] | None
    ) -> Minted:
        """`verified` here means the platform confirmed a value exists and
        decrypts (D67). It does not confirm the value is still accepted
        upstream — that is learned at first use, through the proxy, and
        reported by the session's endpoint log."""
        row = await self._connection.fetchrow(_ACTIVE, ref)
        if row is None:
            raise LookupError(f"{ref} has no active version.")
        return {
            "value": decrypt(row["ciphertext"], key=get_settings().harness_master_key),
            "kind": "stored",
            "expires_at": None,
            "evidence": "verified",
            "version": str(row["version"]),
        }

    async def revoke(self, minted: Minted) -> None:
        return None
