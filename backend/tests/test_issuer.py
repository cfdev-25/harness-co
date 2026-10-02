"""11 §4: `api` as an OpenID issuer — the shared prerequisite for every
no-stored-secret vault path."""

import base64
import os
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
)
from fastapi.testclient import TestClient

from app.domain import issuer
from app.errors import ApiError
from app.main import create_app

ISSUER_URL = "https://api.harness.test"


def _pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()


@pytest.fixture
def configured(monkeypatch):
    signing, following = _pem(), _pem()
    monkeypatch.setenv("HARNESS_ISSUER_URL", ISSUER_URL)
    monkeypatch.setenv("HARNESS_ISSUER_KEY", signing)
    monkeypatch.setenv("HARNESS_ISSUER_NEXT_KEY", following)
    return signing, following


def test_discovery_and_jwks_are_at_a_stable_path(configured):
    with TestClient(create_app(pool=object())) as client:
        discovery = client.get("/.well-known/openid-configuration").json()
        assert discovery["issuer"] == ISSUER_URL
        assert discovery["jwks_uri"] == f"{ISSUER_URL}/.well-known/jwks.json"
        assert discovery["id_token_signing_alg_values_supported"] == ["RS256"]

        keys = client.get("/.well-known/jwks.json").json()["keys"]
    # The next key is published before it is signed with, and never more than
    # two are carried (D122).
    assert len(keys) == 2
    assert {key["kty"] for key in keys} == {"RSA"}
    assert all("d" not in key for key in keys), "the private half must never be published"
    assert len({key["kid"] for key in keys}) == 2


def test_token_carries_iss_sub_aud_and_the_session_claims(configured):
    session = {
        "person": "dana@acme.co",
        "session": "3f1b2c4d",
        "org": "acme",
        "group": "marketing",
        "grant": "g-marketing",
    }
    token = issuer.token(
        "11111111-1111-1111-1111-111111111111", "aws-prod", "sts.amazonaws.com", session
    )
    header = jwt.get_unverified_header(token)
    claims = jwt.decode(token, options={"verify_signature": False}, audience="sts.amazonaws.com")

    assert header["alg"] == "RS256"
    assert claims["iss"] == ISSUER_URL
    assert claims["sub"] == "harness:org:11111111-1111-1111-1111-111111111111:vault:aws-prod"
    assert claims["aud"] == "sts.amazonaws.com"
    assert claims["exp"] - claims["iat"] == 300
    assert claims["iat"] <= int(time.time())
    assert claims["harness_person"] == "dana@acme.co"
    assert claims["harness_session"] == "3f1b2c4d"
    assert claims["harness_group"] == "marketing"


def test_token_verifies_against_the_published_jwks(configured):
    token = issuer.token("org-1", "vault-1", "api://harness", None)
    with TestClient(create_app(pool=object())) as client:
        keys = client.get("/.well-known/jwks.json").json()["keys"]
    signing = next(key for key in keys if key["kid"] == jwt.get_unverified_header(token)["kid"])
    claims = jwt.decode(
        token,
        jwt.PyJWK.from_dict(signing).key,
        algorithms=["RS256"],
        audience="api://harness",
        issuer=ISSUER_URL,
    )
    assert claims["sub"] == "harness:org:org-1:vault:vault-1"
    # A token signed by the key we publish second does not verify against it.
    other = next(key for key in keys if key["kid"] != signing["kid"])
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(
            token,
            jwt.PyJWK.from_dict(other).key,
            algorithms=["RS256"],
            audience="api://harness",
            issuer=ISSUER_URL,
        )


def test_kid_is_the_rfc7638_thumbprint(configured):
    signing, _ = configured
    kid, public, _key = issuer._jwk(signing)
    assert public["kid"] == kid
    assert base64.urlsafe_b64decode(kid + "=") is not None
    assert kid == issuer._jwk(signing)[0], "the same key always gets the same kid"


def test_an_unconfigured_issuer_refuses_rather_than_signing_with_nothing(monkeypatch):
    monkeypatch.delenv("HARNESS_ISSUER_KEY", raising=False)
    monkeypatch.delenv("HARNESS_ISSUER_NEXT_KEY", raising=False)
    monkeypatch.setenv("HARNESS_ISSUER_URL", ISSUER_URL)
    with pytest.raises(ApiError) as caught:
        issuer.token("org-1", "vault-1", "aud", None)
    assert caught.value.status_code == 503
    assert os.environ.get("HARNESS_ISSUER_KEY") is None
