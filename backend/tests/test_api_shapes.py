from fastapi.testclient import TestClient

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
        "/v1/personal-access-tokens",
        "/v1/me",
        "/v1/tree",
        "/v1/org-units",
        "/v1/org-units/{org_unit_id}/boundary",
        "/v1/org-units/{org_unit_id}/members",
        "/v1/assets",
        "/v1/assets/{asset_id}/versions",
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
