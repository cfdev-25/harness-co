"""`GET /v1/me` in the shape 00 §4.10 names, and `/v1/internal/principal`."""

import uuid

import pytest
from test_broker import ORG_PATH, ORG_REF, SERVICE_TOKEN, TEAM_PATH, seed
from test_resolve import _all_migrations, _request, requires_postgres, scratch_db

from app.api import routes_internal, routes_me
from app.errors import ApiError
from app.identity import Principal


async def _member(connection, world, name="rae"):
    unit = await connection.fetchval(
        "insert into org_units(parent_id,role,name) values ($1,'user',$2) returning id",
        world["team"],
        name,
    )
    person = uuid.uuid4()
    await connection.execute(
        "insert into auth.users(id,email) values ($1,$2)", person, f"{name}@acme.co"
    )
    await connection.execute(
        "insert into org_unit_members(auth_user_id,user_unit_id) values ($1,$2)", person, unit
    )
    return person


@requires_postgres
async def test_me_returns_user_chain_and_role():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        body = await routes_me.read_me(
            _request(connection), Principal(world["person"], "dana@acme.co")
        )
        assert body["user"] == {"id": str(world["person"]), "email": "dana@acme.co"}
        assert [node["kind"] for node in body["chain"]] == ["org", "team", "user"]
        assert body["chain"][0] == {
            "kind": "org",
            "path": ORG_PATH,
            "ref": ORG_REF,
            "commit": "c-org",
        }
        assert body["chain"][-1]["ref"] == f"refs/heads/users/{world['person']}"
        # No grant is what "member" means.
        assert body["role"] == {"level": "member", "at": None}

        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            world["person"],
            world["team"],
        )
        body = await routes_me.read_me(
            _request(connection), Principal(world["person"], "dana@acme.co")
        )
        assert body["role"] == {"level": "team-admin", "at": TEAM_PATH}

        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'owner')",
            world["person"],
            world["org"],
        )
        body = await routes_me.read_me(
            _request(connection), Principal(world["person"], "dana@acme.co")
        )
        # Shallowest wins: an org grant is org-admin however it is levelled.
        assert body["role"] == {"level": "org-admin", "at": ORG_PATH}


@requires_postgres
async def test_me_as_a_member_needs_the_role_on_their_chain():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        member = await _member(connection, world)
        principal = Principal(world["person"], "dana@acme.co")

        with pytest.raises(ApiError) as caught:
            await routes_me.read_me(_request(connection), principal, as_user=member)
        assert caught.value.status_code == 403
        assert caught.value.code == "console.as_forbidden"

        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            world["person"],
            world["team"],
        )
        body = await routes_me.read_me(_request(connection), principal, as_user=member)
        assert body["chain"][-1]["ref"] == f"refs/heads/users/{member}"
        assert body["user"]["id"] == str(world["person"])  # the reader, not the read
        assert body["role"] == {"level": "team-admin", "at": TEAM_PATH}


@requires_postgres
async def test_internal_principal_resolves_a_token_and_lists_readable_refs():
    async with scratch_db(_all_migrations()) as connection:
        import hashlib
        import secrets

        world = await seed(connection)
        member = await _member(connection, world)
        raw = secrets.token_urlsafe(32)
        await connection.execute(
            "insert into personal_access_tokens(auth_user_id,token_hash,name) values ($1,$2,'git')",
            world["person"],
            hashlib.sha256(raw.encode()).hexdigest(),
        )
        body = await routes_internal.internal_principal(
            _request(connection), f"Bearer {SERVICE_TOKEN}", f"hpat_{raw}"
        )
        assert body["user_id"] == str(world["person"])
        assert body["org_id"] == str(world["org"])
        assert [node["path"] for node in body["chain"]][0] == ORG_PATH
        # A member sees no further refs than their own chain.
        assert body["readable"] == []

        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            world["person"],
            world["team"],
        )
        body = await routes_internal.internal_principal(
            _request(connection), f"Bearer {SERVICE_TOKEN}", f"hpat_{raw}"
        )
        assert body["readable"] == [f"refs/heads/users/{member}"]


@requires_postgres
async def test_internal_principal_needs_the_service_token():
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        with pytest.raises(ApiError) as caught:
            await routes_internal.internal_principal(_request(connection), "Bearer wrong", "x")
        assert caught.value.status_code == 401
