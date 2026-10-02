"""The resolver registry (04 §7).

Vault ids come from `SecretRef.vault` on the org branch; the same ids
configure the registry here. Credentials for reaching a customer's vault are
`api`'s own configuration and never travel on a branch. We never write to a
customer's vault (prd-v2 §6.2), so no resolver has `create` or `rotate`.
"""

from typing import Any, Literal, NotRequired, Protocol, TypedDict

import asyncpg

BUNDLED = "bundled"


class Probe(TypedDict):
    ready: bool
    evidence: Literal["verified", "harness-reported", "declared"]
    detail: str


class Minted(TypedDict):
    value: str
    kind: Literal["minted", "stored"]
    expires_at: str | None
    evidence: Literal["verified", "harness-reported", "declared"]
    # The provider's version id for the value handed out, compared at the next
    # open to mark earlier sessions' alias retired (11 §5.6). Provenance, not a
    # value; it lands in `slots[alias].version`.
    version: NotRequired[str | None]


class SessionContext(TypedDict):
    person: str
    session: str
    org: str
    group: str
    grant: str


class Resolver(Protocol):
    id: str

    async def probe(self, ref: str) -> Probe: ...
    async def resolve(
        self, ref: str, session: SessionContext, mint: dict[str, Any] | None
    ) -> Minted: ...
    async def revoke(self, minted: Minted) -> None: ...


class VaultUnknown(Exception):
    """A vault id a group names that `api` has not connected. Not validated at
    push (02 §7 step 11); refused here."""


# Vaults `api` has connected, keyed by the id a group's `SecretRef.vault` uses.
# The bundled vault is not in here: it lives in `api`'s own database and is
# built on the broker's transaction so its reads are in it.
registry: dict[str, Resolver] = {}


def resolver_for(vault_id: str, connection: asyncpg.Connection) -> Resolver:
    if vault_id == BUNDLED:
        from app.domain.resolvers.bundled import Bundled

        return Bundled(connection)
    resolver = registry.get(vault_id)
    if resolver is None:
        raise VaultUnknown(vault_id)
    return resolver
