from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.deps import current_principal, current_user_unit, require_admin
from app.errors import ApiError
from app.identity import Principal
from app.main import create_app


def test_health_and_uniform_authentication_error():
    with TestClient(create_app(pool=object())) as client:
        assert client.get("/health").json() == {"status": "ok"}
        response = client.get("/v1/me")
    assert response.status_code == 401
    assert response.json() == {
        "code": "authentication_required",
        "message": "Please sign in to continue.",
        "detail": {},
    }


def test_openapi_contains_full_backend_surface():
    paths = create_app(pool=object()).openapi()["paths"]
    expected = {
        "/v1/access-requests",
        "/v1/personal-access-tokens",
        "/v1/me",
        "/v1/tree",
        "/v1/orgs",
        "/v1/org-units",
        "/v1/org-units/{org_unit_id}/invites",
        "/v1/invites/{invite_id}",
        "/v1/org-units/{org_unit_id}/boundary",
        "/v1/org-units/{org_unit_id}/members",
        "/v1/assets",
        "/v1/assets/{asset_id}",
        "/v1/assets/{asset_id}/versions",
        "/v1/assets/{asset_id}/lineage",
        "/v1/assets/{asset_id}/harnesses",
        "/v1/harnesses",
        "/v1/harnesses/{harness_id}",
        "/v1/harnesses/{harness_id}/assets",
        "/v1/org-units/{org_unit_id}/harnesses",
        "/v1/assets/{asset_id}/promote",
        "/v1/assets/{asset_id}/rollback",
        "/v1/resolve",
        "/v1/api-keys",
        "/v1/api-keys/{api_key_id}/rotate",
        "/v1/api-keys/deliver",
        "/v1/audit/batch",
        "/v1/org-units/{org_unit_id}/audit",
        "/v1/org-units/{org_unit_id}/audit/verify",
        "/v1/sessions",
        "/v1/sessions/{session_id}",
    }
    assert expected <= paths.keys()


def test_validation_errors_use_public_error_shape():
    app = create_app(pool=object())

    async def principal():
        from uuid import UUID

        from app.identity import Principal

        return Principal(UUID("00000000-0000-0000-0000-000000000001"))

    from app.api.deps import current_principal

    app.dependency_overrides[current_principal] = principal
    with TestClient(app) as client:
        response = client.post("/v1/personal-access-tokens", json={"name": ""})
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    assert response.json()["message"].endswith(".")


def test_list_keys_inherits_from_ancestors_and_tags_the_owner():
    """A team must be able to select a connector the org owns (docs/agents.md §12.6)."""
    org_id, team_id = uuid4(), uuid4()
    org_key = {
        "id": uuid4(),
        "name": "openai",
        "ref": "secret://acme/openai",
        "kind": "provider_api_key",
        "env_var": "OPENAI_API_KEY",
        "org_unit_id": org_id,
        "org_unit_path": "acme",
        "last4": "wxyz",
        "version": 1,
        "status": "active",
        "created_at": "2026-01-01T00:00:00+00:00",
    }

    class FakePool:
        """Answers the two queries `list_keys` reaches: `can_read`'s
        visibility check, then the ancestor walk in `visible_keys`."""

        async def fetchrow(self, query, *args):
            return None  # The caller holds no admin grant on the org.

        async def fetchval(self, query, *args):
            return True  # The org is an ancestor of the caller's own unit.

        async def fetch(self, query, *args):
            assert "with recursive chain" in query
            return [org_key]

    app = create_app(pool=FakePool())

    async def principal():
        return Principal(uuid4())

    async def user_unit():
        return {"id": team_id}

    app.dependency_overrides[current_principal] = principal
    app.dependency_overrides[current_user_unit] = user_unit
    with TestClient(app) as client:
        response = client.get(f"/v1/org-units/{org_id}/api-keys")

    assert response.status_code == 200
    (row,) = response.json()
    # Every field `list_keys` returned before inheritance stays exactly as it was.
    for field in ("name", "ref", "kind", "env_var", "last4", "version", "status", "created_at"):
        assert row[field] == org_key[field]
    assert row["id"] == str(org_key["id"])
    # The row is tagged with the unit that actually owns it, not the caller's own.
    assert row["org_unit_id"] == str(org_id)
    assert row["org_unit_path"] == "acme"


async def test_rotating_an_inherited_connector_still_requires_admin_at_its_owning_unit():
    """A team may use an org connector but never rotate it (docs/scoping.md §5.5)."""
    org_id, team_id, auth_user_id = uuid4(), uuid4(), uuid4()
    principal = Principal(auth_user_id)

    class FakeAdminConnection:
        """A grant exists at exactly one unit; `role_at` finds it or nothing."""

        def __init__(self, admin_at):
            self.admin_at = admin_at

        async def fetchrow(self, query, *args):
            _auth_user_id, org_unit_id = args
            return (
                {"level": "admin", "org_unit_id": self.admin_at}
                if org_unit_id == self.admin_at
                else None
            )

    # The team's own admin has no grant on the org that owns the key: 403.
    with pytest.raises(ApiError) as caught:
        await require_admin(FakeAdminConnection(team_id), principal, org_id)
    assert caught.value.code == "admin_required"

    # The org's own admin may rotate what it owns.
    await require_admin(FakeAdminConnection(org_id), principal, org_id)
