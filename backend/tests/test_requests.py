"""The request primitive (00 §4.10): one endpoint, three subjects."""

import uuid

import pytest
from test_broker import TEAM_PATH, seed
from test_resolve import _all_migrations, _request, requires_postgres, scratch_db

from app.api import routes_requests
from app.errors import ApiError
from app.identity import Principal


def _open(**subject):
    return routes_requests.OpenRequest(
        title="Offer the triage skill", reasoning="It is ready.", subject=subject
    )


@requires_postgres
async def test_promotion_request_opens_against_the_authors_team():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        principal = Principal(world["person"], "dana@acme.co")
        body = await routes_requests.open_request(
            _open(kind="promotion", paths=["assets/skill/triage"], commit="abc123"),
            _request(connection),
            principal,
        )
        assert body["team"] == TEAM_PATH
        assert body["state"] == "open"
        row = await connection.fetchrow("select * from requests where id=$1", uuid.UUID(body["id"]))
        assert row["subject_kind"] == "promotion"
        assert row["subject"]["paths"] == ["assets/skill/triage"]
        assert row["org_unit_id"] == world["team"]
        assert row["base_commit"] == "c-team"  # the team ref's head at open
        assert (
            await connection.fetchval("select count(*) from audit_log where action='request.open'")
            == 1
        )


@requires_postgres
async def test_role_request_opens_against_the_team_asked_for():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        body = await routes_requests.open_request(
            _open(kind="role", level="team-admin", team=TEAM_PATH),
            _request(connection),
            Principal(world["person"], "dana@acme.co"),
        )
        row = await connection.fetchrow("select * from requests where id=$1", uuid.UUID(body["id"]))
        assert row["subject_kind"] == "role"
        assert row["subject"] == {"kind": "role", "level": "team-admin", "team": TEAM_PATH}
        assert row["harness_id"] is None


@requires_postgres
async def test_publish_request_cannot_be_created_by_a_non_staff_principal():
    """console 08 §6's definition of done for the reservation (D30g)."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        subject = _open(
            kind="publish",
            **{"from": {"repo": "platform", "ref": "refs/heads/main", "paths": ["assets/skill/x"]}},
            to={"org": str(world["org"]), "ref": "refs/heads/org"},
        )
        with pytest.raises(ApiError) as caught:
            await routes_requests.open_request(
                subject, _request(connection), Principal(world["person"], "dana@acme.co")
            )
        assert caught.value.status_code == 404
        assert caught.value.code == "platform.not_built"
        assert await connection.fetchval("select count(*) from requests") == 0

        await connection.execute(
            "insert into platform_staff(auth_user_id) values ($1)", world["person"]
        )
        body = await routes_requests.open_request(
            subject, _request(connection), Principal(world["person"], "dana@acme.co")
        )
        assert body["state"] == "open"


@requires_postgres
async def test_withdraw_is_author_only_and_open_only():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        principal = Principal(world["person"], "dana@acme.co")
        body = await routes_requests.open_request(
            _open(kind="promotion", paths=["assets/skill/triage"], commit="abc123"),
            _request(connection),
            principal,
        )
        request_id = uuid.UUID(body["id"])

        with pytest.raises(ApiError) as caught:
            await routes_requests.withdraw_request(
                request_id, _request(connection), Principal(uuid.uuid4(), "rae@acme.co")
            )
        assert caught.value.code == "request.not_author"
        assert caught.value.message == "Only the author can withdraw a request."

        await routes_requests.withdraw_request(request_id, _request(connection), principal)
        row = await connection.fetchrow("select * from requests where id=$1", request_id)
        assert (row["state"], row["decision"]) == ("closed", "withdrawn")
        assert (
            await connection.fetchval(
                "select count(*) from audit_log where action='request.withdraw'"
            )
            == 1
        )

        with pytest.raises(ApiError) as caught:
            await routes_requests.withdraw_request(request_id, _request(connection), principal)
        assert caught.value.status_code == 409
        assert caught.value.code == "request.not_open"
