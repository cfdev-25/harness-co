"""`api` as an OpenID issuer (11 §4) — the shared prerequisite.

Every no-stored-secret path except direct AWS role assumption works the same
way: the customer's identity system trusts tokens from this issuer, fetches
its keys by OpenID discovery, checks `iss`, `sub` and `aud`, and exchanges
the token for its own short-lived credential.

The key is rotated by publishing the next key in the JWKS before signing with
it, so the JWKS never carries more than two (D122; Entra stores only the
first 100 signing keys).
"""

import base64
import hashlib
import json
import os
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import APIRouter

from app.domain.resolvers import SessionContext
from app.errors import ApiError

router = APIRouter(tags=["issuer"])
LIFETIME = 300  # the token is used once, immediately


def _url() -> str:
    url = os.environ.get("HARNESS_ISSUER_URL", "").rstrip("/")
    if not url:
        raise ApiError(503, "issuer_not_configured", "This vault is not connected yet.")
    return url


def _jwk(pem: str) -> tuple[str, dict[str, Any], Any]:
    key = load_pem_private_key(pem.encode(), password=None)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    thumbprint = hashlib.sha256(
        json.dumps(
            {"e": public["e"], "kty": public["kty"], "n": public["n"]},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).digest()
    kid = base64.urlsafe_b64encode(thumbprint).decode().rstrip("=")
    return kid, {**public, "kid": kid, "use": "sig", "alg": "RS256"}, key


def _keys() -> list[tuple[str, dict[str, Any], Any]]:
    """The signing key first, then the next one if it is being published."""
    pems = [os.environ.get("HARNESS_ISSUER_KEY", ""), os.environ.get("HARNESS_ISSUER_NEXT_KEY", "")]
    return [_jwk(pem) for pem in pems if pem]


def token(org_id: str, vault_id: str, audience: str, session: SessionContext | None) -> str:
    """One JWT per `resolve()`/`probe()` call. `sub` is one stable subject per
    connected vault: per-person subjects do not scale, and AWS advises against
    PII in `sub` because it lands in CloudTrail."""
    keys = _keys()
    if not keys:
        raise ApiError(503, "issuer_not_configured", "This vault is not connected yet.")
    kid, _, key = keys[0]
    issued = int(time.time())
    claims: dict[str, Any] = {
        "iss": _url(),
        "sub": f"harness:org:{org_id}:vault:{vault_id}",
        "aud": audience,
        "iat": issued,
        "exp": issued + LIFETIME,
    }
    if session is not None:
        claims |= {
            "harness_person": session["person"],
            "harness_session": session["session"],
            "harness_group": session["group"],
        }
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})


@router.get("/.well-known/openid-configuration")
async def discovery() -> dict:
    url = _url()
    return {
        "issuer": url,
        "jwks_uri": f"{url}/.well-known/jwks.json",
        "response_types_supported": ["id_token"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
    }


@router.get("/.well-known/jwks.json")
async def jwks() -> dict:
    return {"keys": [public for _, public, _ in _keys()]}
