"""04 §10, by name. T4 runs against a real Postgres in a scratch database; the
pure tiers run in process.

`scratch_db` and the single-connection pool adapter live in `test_resolve.py`
(the doc says `conftest.py`; it does not) — the route functions are called
in-process for the reason stated there: a real HTTP client would need a second
event loop, which asyncpg connections do not survive.
"""

import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from test_resolve import (
    _all_migrations,
    _request,
    requires_postgres,
    scratch_db,
)

from app.api import routes_internal, routes_sessions
from app.crypto import encrypt
from app.domain import audit, broker
from app.domain.resolvers.bundled import Bundled
from app.errors import ApiError
from app.identity import Principal

SERVICE_TOKEN = "service-token-for-tests"
os.environ["HARNESS_SERVICE_TOKEN"] = SERVICE_TOKEN
SECRET_VALUE = "sk-crm-9f3a-never-logged"
MASTER_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

ORG_PATH = "acme"
TEAM_PATH = "acme.marketing"
ORG_REF = "refs/heads/org"
TEAM_REF = "refs/heads/teams/acme.marketing"


# --- T1: the scoping primitive --------------------------------------------

CHAIN = [
    {"kind": "org", "path": "acme", "ref": ORG_REF, "commit": "c-org"},
    {"kind": "team", "path": TEAM_PATH, "ref": TEAM_REF, "commit": "c-team"},
    {"kind": "user", "path": "acme.marketing.dana", "ref": "refs/heads/users/u", "commit": "c-u"},
]
SCOPE_FIXTURES = Path(__file__).resolve().parents[2] / "engine" / "compose" / "fixtures" / "scope"


def test_covers_matches_ts_fixtures():
    """B7: the covering-grant rule is the same function as preflight's, proven
    by the shared fixtures. Each case is `{scope, chain, harnessId, expected}`."""
    if not SCOPE_FIXTURES.is_dir():
        pytest.skip(
            f"{SCOPE_FIXTURES} does not exist: `engine/compose` holds its scoping table "
            "inline in `test/scope.test.ts`, not as a fixture directory, so the two "
            "implementations are held together by `test_covers_matches_prd_scoping_table` "
            "below until 04 §10's directory is written."
        )
    cases = sorted(SCOPE_FIXTURES.glob("*.json"))
    assert cases, f"{SCOPE_FIXTURES} holds no cases"
    for case in cases:
        fixture = json.loads(case.read_text())
        assert (
            broker.covers(fixture["scope"], fixture["chain"], fixture.get("harnessId"))
            is fixture["expected"]
        ), case.name


def test_covers_matches_prd_scoping_table():
    """The Python half of `engine/compose/test/scope.test.ts`'s table, row for
    row (B7). Until the shared fixture directory exists, this is where the two
    implementations are held to the same answers."""
    assert broker.covers({"teams": "all"}, CHAIN, None) is True
    assert broker.covers({"teams": [TEAM_PATH]}, CHAIN, None) is True
    assert broker.covers({"teams": ["acme.eng"]}, CHAIN, None) is False
    # The org path is not a team node, so naming it reaches nobody.
    assert broker.covers({"teams": [ORG_PATH]}, CHAIN, None) is False
    # A user path is never a scope target.
    assert broker.covers({"teams": ["acme.marketing.dana"]}, CHAIN, None) is False
    assert broker.covers({"teams": "all", "harnesses": ["h1"]}, CHAIN, None) is False
    assert broker.covers({"teams": "all", "harnesses": ["h1"]}, CHAIN, "h1") is True
    assert broker.covers({"teams": "all", "harnesses": ["h1"]}, CHAIN, "h2") is False


def test_specificity_orders_broad_before_narrow():
    assert broker._specificity({"teams": "all"}, CHAIN) == (-1, 0)
    assert broker._specificity({"teams": "all", "harnesses": ["h1"]}, CHAIN) == (-1, 1)
    assert broker._specificity({"teams": [TEAM_PATH]}, CHAIN) == (1, 0)
    assert broker._specificity({"teams": ["acme.eng"]}, CHAIN) == (-1, 0)


def _group(name, alias="crm", ref="secret://acme/crm", vault="bundled", sources="vault"):
    return {
        "name": name,
        "entries": [
            {
                "alias": alias,
                "secret": {"vault": vault, "ref": ref},
                "upstream": "https://api.crm.example",
                "attach": {"header": "Authorization", "prefix": "Bearer "},
            }
        ],
        "sources": sources,
    }


def test_pick_grant_narrowest_wins():
    groups = {"wide": _group("wide"), "narrow": _group("narrow")}
    grants = [
        {"id": "g-org", "scope": {"teams": "all"}, "group": "wide", "by": "a"},
        {"id": "g-team", "scope": {"teams": [TEAM_PATH]}, "group": "narrow", "by": "a"},
    ]
    assert broker.pick_grant("crm", grants, groups, CHAIN, None)["id"] == "g-team"
    # Harness-narrowed beats team-wide at the same depth.
    grants.append(
        {
            "id": "g-harness",
            "scope": {"teams": [TEAM_PATH], "harnesses": ["h1"]},
            "group": "narrow",
            "by": "a",
        }
    )
    assert broker.pick_grant("crm", grants, groups, CHAIN, "h1")["id"] == "g-harness"


def test_pick_grant_ambiguous_refuses():
    groups = {"a": _group("a", ref="secret://acme/one"), "b": _group("b", ref="secret://acme/two")}
    grants = [
        {"id": "g-a", "scope": {"teams": [TEAM_PATH]}, "group": "a", "by": "x"},
        {"id": "g-b", "scope": {"teams": [TEAM_PATH]}, "group": "b", "by": "x"},
    ]
    with pytest.raises(broker.Refusal) as caught:
        broker.pick_grant("crm", grants, groups, CHAIN, None)
    assert caught.value.blocker["code"] == "broker.ambiguous_alias"
    assert "crm" in caught.value.blocker["message"]


def test_pick_grant_tie_to_the_same_secret_is_one_answer():
    groups = {"a": _group("a"), "b": _group("b")}
    grants = [
        {"id": "g-b", "scope": {"teams": [TEAM_PATH]}, "group": "b", "by": "x"},
        {"id": "g-a", "scope": {"teams": [TEAM_PATH]}, "group": "a", "by": "x"},
    ]
    assert broker.pick_grant("crm", grants, groups, CHAIN, None)["id"] == "g-a"


def test_narrowed_grant_only_kept_aliases():
    group = _group("marketing")
    group["entries"].append(
        {
            "alias": "email",
            "secret": {"vault": "bundled", "ref": "secret://acme/email"},
            "upstream": "https://api.sendgrid.com",
            "attach": {"header": "Authorization", "prefix": "Bearer "},
        }
    )
    grants = [
        {
            "id": "g-interns",
            "scope": {"teams": [TEAM_PATH]},
            "group": "marketing",
            "narrowedFrom": {"grant": "g-marketing", "aliases": ["crm"]},
            "by": "rae",
        }
    ]
    assert broker.pick_grant("crm", grants, {"marketing": group}, CHAIN, None)["id"] == "g-interns"
    with pytest.raises(broker.Refusal) as caught:
        broker.pick_grant("email", grants, {"marketing": group}, CHAIN, None)
    assert caught.value.blocker["code"] == "broker.no_grant_for_alias"


# --- T4 fixtures -----------------------------------------------------------


def _policy(
    *,
    approval="approved",
    reason=None,
    sources="vault",
    credential="crm",
    approved_for=("anthropic",),
    min_version="1.0.0",
    runtime="pi",
    model_id="anthropic",
    model_native=None,
):
    """W6-D6 retired the keyless model provider: a provider no security group
    holds a key for can serve nobody, so the broker refuses it at step 5 and the
    fixture's provider names the alias `marketing` holds in the bundled vault.
    A test that wants the refusal passes an alias nothing holds.

    W7-D2 narrowed that: a keyless provider the runtime signs in to *itself* is
    the person's own sign-in, not a refusal, so a test that wants the refusal
    also needs a (runtime, model provider) pair we ship no sign-in for —
    `model_id="openai"` is one, because Pi's own OAuth flow is `openai-codex`.
    """
    provider = {
        "id": runtime,
        "approval": approval,
        "scope": {"teams": "all"},
        "pin": {"binary": "pi", "minVersion": min_version},
        "speaks": ["anthropic-messages"],
    }
    if reason is not None:
        provider["reason"] = reason
    # W7-D2: `modelNative` is the presets' and never a branch's, so a test that
    # wants it reads the presets through `seed.preset_model_native` like the
    # broker does. This knob exists only to prove the stripping.
    if model_native is not None:
        provider["modelNative"] = model_native
    model = {
        "id": model_id,
        "endpoints": {"anthropic-messages": "https://api.anthropic.com"},
        "models": ["claude-sonnet-5"],
    }
    if credential is not None:
        model["credential"] = {"alias": credential}
    return {
        "groups.json": [_group("marketing", sources=sources)],
        "grants.json": [
            {"id": "g-marketing", "scope": {"teams": [TEAM_PATH]}, "group": "marketing", "by": "d"}
        ],
        "harness-providers.json": [provider],
        "model-providers.json": [model],
        "routing.json": {
            "defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
            "approvedFor": {
                "teams": {TEAM_PATH: list(approved_for)},
                "harnesses": {},
                "providers": {},
            },
        },
        "kinds.json": ["skill"],
        "always-loaded.json": [],
    }


def all_nodes(person):
    """The org's whole tree, as `indexer.ts` sends it on every write."""
    return [
        {"path": ORG_PATH, "kind": "org", "ref": ORG_REF, "parent_path": None},
        {"path": TEAM_PATH, "kind": "team", "ref": TEAM_REF, "parent_path": ORG_PATH},
        {
            "path": "acme.marketing.dana",
            "kind": "user",
            "ref": f"refs/heads/users/{person}",
            "parent_path": TEAM_PATH,
        },
    ]


async def _write_index(connection, org, ref, commit, rows):
    await routes_internal.write_index(
        routes_internal.IndexWrite(org=org, ref=ref, commit=commit, rows=rows),
        _request(connection),
        f"Bearer {SERVICE_TOKEN}",
    )


async def seed(connection, *, policy=None, with_key=True):
    """An org, a team, a person in it, a bundled key, and the index written
    through `POST /v1/internal/index` so the endpoint is exercised too."""
    org = await connection.fetchval(
        "insert into org_units(parent_id,role,name) values (null,'org','acme') returning id"
    )
    team = await connection.fetchval(
        "insert into org_units(parent_id,role,name) values ($1,'team','marketing') returning id",
        org,
    )
    unit = await connection.fetchval(
        "insert into org_units(parent_id,role,name) values ($1,'user','dana') returning id", team
    )
    person = uuid.uuid4()
    await connection.execute("insert into auth.users(id,email) values ($1,'dana@acme.co')", person)
    await connection.execute(
        "insert into org_unit_members(auth_user_id,user_unit_id) values ($1,$2)", person, unit
    )
    key_id = None
    if with_key:
        key_id = await connection.fetchval(
            """insert into api_keys(org_unit_id,name,ref,kind,env_var,created_by)
               values ($1,'crm','secret://acme/crm','static_api_key','CRM_KEY',$2) returning id""",
            org,
            person,
        )
        await connection.execute(
            """insert into api_key_versions(api_key_id,version,ciphertext,last4,status)
               values ($1,1,$2,'alue','active')""",
            key_id,
            encrypt(SECRET_VALUE, key=MASTER_KEY),
        )
    files = policy if policy is not None else _policy()
    nodes = all_nodes(person)
    await _write_index(
        connection,
        org,
        ORG_REF,
        "c-org",
        {
            "idx_nodes": nodes,
            "idx_policy": [
                {"node_path": ORG_PATH, "file": name, "body": body}
                for name, body in files.items()
            ],
        },
    )
    await _write_index(connection, org, TEAM_REF, "c-team", {"idx_nodes": nodes})
    await _write_index(
        connection, org, f"refs/heads/users/{person}", "c-user", {"idx_nodes": nodes}
    )
    return {"org": org, "team": team, "unit": unit, "person": person, "key_id": key_id}


def _body(session_id=None, **overrides):
    values = {
        "id": session_id or uuid.uuid4(),
        "provider": "pi",
        "provider_version": "1.2.0",
        "harness": None,
        "model": ("anthropic", "claude-sonnet-5"),
        "aliases": ["crm"],
        "commits": {},
    }
    values.update(overrides)
    return routes_sessions.OpenSession(**values)


async def _open(connection, world, **overrides):
    return await routes_sessions.create_session(
        _body(**overrides),
        _request(connection),
        Principal(world["person"], "dana@acme.co"),
    )


# --- T4: the mint rules ----------------------------------------------------


@requires_postgres
async def test_open_writes_one_audit_event():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        result = await _open(connection, world, session_id=session_id)

        assert [c["alias"] for c in result["credentials"]] == ["crm"]
        assert result["credentials"][0]["value"] == SECRET_VALUE
        assert result["credentials"][0]["kind"] == "stored"
        assert result["slots"][0]["state"] == "satisfied"
        assert result["slots"][0]["resolvedFrom"] == {
            "source": "vault",
            "vault": "bundled",
            "group": "marketing",
            "grant": "g-marketing",
        }
        assert result["blockers"] == []
        assert (
            await connection.fetchval("select count(*) from audit_log where action='session.open'")
            == 1
        )
        assert (
            await connection.fetchval(
                "select count(*) from harness_sessions where id=$1", session_id
            )
            == 1
        )

        # A refusal writes exactly one `session.refuse` and no record.
        refused_id = uuid.uuid4()
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, session_id=refused_id, provider="cursor")
        assert caught.value.code == "broker.provider_unknown"
        assert (
            await connection.fetchval(
                "select count(*) from audit_log where action='session.refuse'"
            )
            == 1
        )
        assert (
            await connection.fetchval(
                "select count(*) from harness_sessions where id=$1", refused_id
            )
            == 0
        )


@requires_postgres
async def test_slots_never_contain_values():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        await _open(connection, world)
        slots = await connection.fetchval("select slots::text from harness_sessions")
        payloads = await connection.fetchval("select string_agg(payload::text, ' ') from audit_log")
        assert SECRET_VALUE not in slots
        assert SECRET_VALUE not in payloads
        assert "crm" in slots  # provenance is there; the value is not


@requires_postgres
async def test_vault_only_never_falls_through():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        # The vault cannot supply it: no active version behind the ref.
        await connection.execute("update api_key_versions set status='retired'")
        result = await _open(connection, world)
        assert result["credentials"] == []
        slot = result["slots"][0]
        assert slot["state"] == "unsatisfied"
        assert slot["evidence"] == "declared"
        assert slot["resolvedFrom"] is None
        assert slot["blocker"]["code"] == "broker.vault_unavailable"
        assert slot["via"] == {"grant": "g-marketing", "group": "marketing", "sources": "vault"}


@requires_postgres
async def test_vault_or_local_defers_with_via():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy(sources="vault-or-local"))
        await connection.execute("update api_key_versions set status='retired'")
        result = await _open(connection, world)
        slot = result["slots"][0]
        assert slot["state"] == "deferred"
        assert slot["via"]["sources"] == "vault-or-local"
        assert "blocker" not in slot
        assert result["credentials"] == []


@requires_postgres
async def test_beta_credential_only_to_admins():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy(approval="beta"))
        with pytest.raises(ApiError) as caught:
            await _open(connection, world)
        assert caught.value.code == "broker.provider_beta_admins_only"

        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            world["person"],
            world["team"],
        )
        result = await _open(connection, world)
        assert result["credentials"][0]["alias"] == "crm"


@requires_postgres
async def test_not_approved_refused_with_reason():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(
            connection, policy=_policy(approval="not-approved", reason="Legal has not cleared it")
        )
        with pytest.raises(ApiError) as caught:
            await _open(connection, world)
        assert caught.value.code == "broker.provider_not_approved"
        assert "Legal has not cleared it" in caught.value.message


@requires_postgres
async def test_model_not_approved_refused():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy(approved_for=()))
        with pytest.raises(ApiError) as caught:
            await _open(connection, world)
        assert caught.value.code == "broker.model_not_approved"


@requires_postgres
async def test_model_credential_missing_refuses_the_session():
    """Step 6's one exception to D64. *Held* and *granted* are different things
    (W6-D6): the organization holds a key for `anthropic-key` — so step 5 lets
    it through — and no grant reaches this person with it, which is step 6's."""
    async with scratch_db(_all_migrations()) as connection:
        policy = _policy(credential="anthropic-key")
        policy["groups.json"] = [*policy["groups.json"],
                                 _group("locked", alias="anthropic-key",
                                        ref="secret://acme/anthropic")]
        world = await seed(connection, policy=policy)
        with pytest.raises(ApiError) as caught:
            await _open(connection, world)
        assert caught.value.code == "broker.model_credential_missing"
        assert "anthropic-key" in caught.value.message


@requires_postgres
async def test_a_model_provider_with_no_held_key_refuses_the_session():
    """W6-D6, the broker's half: the one place the model provider is picked
    refuses before approval is read, with the code the console's Status column
    and the routing write use. Nothing holds `openai-key` here.

    W7-D2 kept this exactly, for the organization it was written for: the
    provider is `openai`, which Pi ships no sign-in for (its OAuth flow is
    `openai-codex`), so there is no own-login to fall back to and a key is
    still the only way this session runs."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy(credential="openai-key",
                                                     model_id="openai", approved_for=()))
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, model=("openai", "claude-sonnet-5"))
        assert caught.value.code == "broker.provider_needs_key"
        assert caught.value.status_code == 403
        assert "Set up" in caught.value.detail["blockers"][0]["remedy"]

    # No alias at all is the same state: W6-D6 retired the keyless gateway row.
    async with scratch_db(_all_migrations()) as connection:
        policy = _policy(model_id="openai")
        policy["model-providers.json"][0].pop("credential")
        world = await seed(connection, policy=policy)
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, model=("openai", "claude-sonnet-5"))
        assert caught.value.code == "broker.provider_needs_key"

    # And a runtime we ship no sign-in list for at all signs in to nothing, so
    # even Anthropic needs a key under it (`signs_in` absent is False).
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy(credential="anthropic-key",
                                                     runtime="acme-runner"))
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, provider="acme-runner")
        assert caught.value.code == "broker.provider_needs_key"


@requires_postgres
async def test_a_keyless_provider_the_runtime_signs_in_to_opens_a_native_session():
    """W7-D2: no security group holds the alias and Pi has its own `/login` for
    Anthropic, so this is not a missing key — it is the person's own sign-in.
    Step 5 does not refuse, step 6 does not ask for the grant nobody gave, the
    session is marked `native` (not metered, C22) and the audit event says so.

    The two halves of W6-D6's rule are both still here: the key is not held
    (`needs_key` is true) and the session is allowed anyway, because the other
    half — `signs_in` — answers for it."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy(credential="anthropic-key"))
        answer = await _open(connection, world)
        assert answer["native"] is True
        # The model alias is not a slot at all: nothing was minted for it and
        # no blocker rode on it. `crm` is the body's own alias and is satisfied.
        assert [slot["need"]["alias"] for slot in answer["slots"]] == ["crm"]
        assert [one["alias"] for one in answer["credentials"]] == ["crm"]
        event = await connection.fetchrow(
            "select payload from audit_log where action='session.open'")
        assert event["payload"]["native"] is True


@requires_postgres
async def test_a_held_key_is_never_a_native_session():
    """W7-D2 is *no key reaches me*, not *the runtime could sign in*. The
    fixture's `crm` alias is held and granted, so the session is the
    organization's model, is metered, and step 6 still requires the grant."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy())
        answer = await _open(connection, world)
        assert answer["native"] is False
        assert [one["alias"] for one in answer["credentials"]] == ["crm"]


@requires_postgres
async def test_model_native_is_the_presets_and_never_a_branch():
    """W7-D2: `modelNative` is a fact about the runtime we ship, read through
    `seed.preset_model_native`. A branch that carries the key — a migrated
    organization, or an admin editing the file by hand — cannot grant itself a
    sign-in the adapter does not have, and cannot take one away either."""
    assert broker.signs_in({"id": "pi"}, "anthropic") is True
    assert broker.signs_in({"id": "pi"}, "openai") is False
    assert broker.signs_in({"id": "claude"}, "anthropic") is True
    assert broker.signs_in({"id": "claude"}, "openrouter") is False
    assert broker.signs_in({"id": "acme-runner"}, "anthropic") is False
    assert broker.signs_in({"id": "acme-runner", "modelNative": ["anthropic"]},
                           "anthropic") is False
    assert broker.signs_in(None, "anthropic") is False


@requires_postgres
async def test_missing_non_model_alias_is_a_slot_not_a_refusal():
    """D64."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        result = await _open(connection, world, aliases=["crm", "email"])
        states = {s["need"]["alias"]: s for s in result["slots"]}
        assert states["crm"]["state"] == "satisfied"
        assert states["email"]["state"] == "unsatisfied"
        assert states["email"]["blocker"]["code"] == "broker.no_grant_for_alias"


@requires_postgres
async def test_heartbeat_answers_with_validity():
    """08 §9 step 3 / D145: one request per tick — the heartbeat's answer is
    what `GET /v1/sessions/{id}` would say."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        await _open(connection, world, session_id=session_id)
        answer = await routes_sessions.update_session(
            session_id,
            routes_sessions.SessionUpdate(last_active_at=None),
            _request(connection),
            Principal(world["person"], "dana@acme.co"),
        )
        read = await routes_sessions.get_session(
            session_id, _request(connection), Principal(world["person"], "dana@acme.co")
        )
        assert answer == read
        assert answer["status"] == "active" and answer["retired"] == []


@requires_postgres
async def test_closed_session_never_mints():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        await _open(connection, world, session_id=session_id)
        await routes_sessions.update_session(
            session_id,
            routes_sessions.SessionUpdate(status="closed", endpoints=[]),
            _request(connection),
            Principal(world["person"], "dana@acme.co"),
        )
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, session_id=session_id)
        assert caught.value.code == "broker.session_not_active"
        assert caught.value.message == "This session is closed."
        # And no other path mints or records against it either.
        for call in (
            routes_sessions.post_endpoints(
                session_id,
                routes_sessions.EndpointBatch(events=[{"host": "x", "port": 443}]),
                _request(connection),
                Principal(world["person"], "dana@acme.co"),
            ),
            routes_sessions.revoke_session(
                session_id,
                routes_sessions.Revoke(reason="manual"),
                _request(connection),
                Principal(world["person"], "dana@acme.co"),
            ),
        ):
            with pytest.raises(ApiError) as caught:
                await call
            assert caught.value.code == "broker.session_not_active"


async def _member(connection, parent, name, *, admin_at=None):
    unit = await connection.fetchval(
        "insert into org_units(parent_id,role,name) values ($1,'user',$2) returning id",
        parent,
        name,
    )
    person = uuid.uuid4()
    await connection.execute(
        "insert into auth.users(id,email) values ($1,$2)", person, f"{name}@acme.co"
    )
    await connection.execute(
        "insert into org_unit_members(auth_user_id,user_unit_id) values ($1,$2)", person, unit
    )
    if admin_at is not None:
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            person,
            admin_at,
        )
    return person


@requires_postgres
async def test_admin_over_owner_can_revoke():
    """00 §4.10: the owner, *or an admin over the owner's chain*. The event
    names the admin, because the admin is who ended it."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        rae = await _member(connection, world["team"], "rae", admin_at=world["team"])
        session_id = uuid.uuid4()
        await _open(connection, world, session_id=session_id)
        result = await routes_sessions.revoke_session(
            session_id,
            routes_sessions.Revoke(reason="a key was rotated"),
            _request(connection),
            Principal(rae, "rae@acme.co"),
        )
        assert result == {"status": "revoked", "revoked_reason": "a key was rotated"}
        assert (
            await connection.fetchval(
                "select actor_id from audit_log where action='session.revoke'"
            )
            == rae
        )


@requires_postgres
async def test_unrelated_member_cannot_revoke():
    """A member of a sibling team administers nothing above the owner, so the
    session is the same 404 it is for anyone who cannot see it."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        eng = await connection.fetchval(
            "insert into org_units(parent_id,role,name) values ($1,'team','eng') returning id",
            world["org"],
        )
        eve = await _member(connection, eng, "eve")
        session_id = uuid.uuid4()
        await _open(connection, world, session_id=session_id)
        with pytest.raises(ApiError) as caught:
            await routes_sessions.revoke_session(
                session_id,
                routes_sessions.Revoke(reason="not mine to end"),
                _request(connection),
                Principal(eve, "eve@acme.co"),
            )
        assert caught.value.status_code == 404
        assert caught.value.code == "session_not_found"
        assert (
            await connection.fetchval(
                "select status from harness_sessions where id=$1", session_id
            )
            == "active"
        )


@requires_postgres
async def test_index_stale_refuses():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        await routes_internal.write_index(
            routes_internal.IndexWrite(
                org=world["org"], ref=ORG_REF, commit="c-org", stale={"error": "compose threw"}
            ),
            _request(connection),
            f"Bearer {SERVICE_TOKEN}",
        )
        with pytest.raises(ApiError) as caught:
            await _open(connection, world)
        assert caught.value.code == "broker.index_stale"
        assert await connection.fetchval("select count(*) from harness_sessions") == 0

        await connection.execute("delete from idx_stale")
        result = await _open(connection, world)
        assert result["credentials"][0]["alias"] == "crm"


@requires_postgres
async def test_index_behind_is_409():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, commits={ORG_REF: "a-newer-commit"})
        assert caught.value.status_code == 409
        assert caught.value.code == "broker.index_behind"
        assert await connection.fetchval("select count(*) from harness_sessions") == 0
        # D66: the same request on the indexed commit opens.
        result = await _open(connection, world, commits={ORG_REF: "c-org"})
        assert result["credentials"][0]["alias"] == "crm"


@requires_postgres
async def test_policy_change_revokes_sessions_on_that_ref():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        await _open(
            connection, world, session_id=session_id, commits={ORG_REF: "c-org", TEAM_REF: "c-team"}
        )
        untouched = uuid.uuid4()
        await _open(connection, world, session_id=untouched, commits={ORG_REF: "c-org"})

        await routes_internal.policy_changed(
            routes_internal.PolicyChanged(
                org=world["org"],
                refs=[
                    routes_internal.IndexRef(
                        ref=TEAM_REF, commit="c-team-2", paths=["grants.json"]
                    )
                ],
            ),
            _request(connection),
            f"Bearer {SERVICE_TOKEN}",
        )
        assert (
            await connection.fetchval("select status from harness_sessions where id=$1", session_id)
            == "revoked"
        )
        assert (
            await connection.fetchval(
                "select revoked_reason from harness_sessions where id=$1", session_id
            )
            == "policy_changed"
        )
        assert (
            await connection.fetchval("select status from harness_sessions where id=$1", untouched)
            == "active"
        )
        assert (
            await connection.fetchval(
                "select count(*) from audit_log where action='session.revoke'"
            )
            == 1
        )


@requires_postgres
async def test_rotation_retires_alias_not_session():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        await _open(connection, world, session_id=session_id)

        from app.domain.api_keys import rotate

        await rotate(connection, world["key_id"], "sk-crm-rotated", master_key=MASTER_KEY)
        retired = await broker.retire_for_key(connection, world["key_id"])

        assert retired == ["crm"]
        row = await connection.fetchrow(
            "select status, slots from harness_sessions where id=$1", session_id
        )
        assert row["status"] == "active"
        assert row["slots"]["crm"]["retired"] is True
        assert (
            await routes_sessions.get_session(
                session_id, _request(connection), Principal(world["person"], "dana@acme.co")
            )
        )["retired"] == ["crm"]


@requires_postgres
async def test_grace_expires_to_retired():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        from app.domain.api_keys import rotate

        await rotate(connection, world["key_id"], "sk-crm-rotated", master_key=MASTER_KEY)
        assert (
            await connection.fetchval("select grace_until from api_key_versions where version=1")
            is not None
        )
        assert await broker.expire_grace(connection) == 0  # still inside the window

        await connection.execute(
            "update api_key_versions set grace_until = now() - interval '1 hour' "
            "where status='grace'"
        )
        assert await broker.expire_grace(connection) == 1
        row = await connection.fetchrow(
            "select status, retired_at from api_key_versions where version=1"
        )
        assert row["status"] == "retired"
        assert row["retired_at"] is not None


@requires_postgres
async def test_audit_insert_survives_month_rollover():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        audit._PARTITIONED.clear()  # the cache is per-process; this database is new
        later = datetime.now(UTC).replace(day=1, hour=12) + (
            datetime(2027, 1, 1, tzinfo=UTC) - datetime(2026, 11, 1, tzinfo=UTC)
        )
        row = await audit.append_event(
            connection,
            org_unit_id=world["unit"],
            actor_type="system",
            actor_id=None,
            event_class="authoritative",
            action="session.open",
            payload={},
            created_at=later,
        )
        assert row["created_at"] == later


@requires_postgres
async def test_endpoint_events_are_authoritative_and_close_stores_the_tally():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        await _open(connection, world, session_id=session_id)
        principal = Principal(world["person"], "dana@acme.co")
        await routes_sessions.post_endpoints(
            session_id,
            routes_sessions.EndpointBatch(
                events=[
                    {
                        "at": "2026-09-25T10:00:00Z",
                        "mode": "inject",
                        "host": "api.crm.example",
                        "port": 443,
                        "alias": "crm",
                        "status": 200,
                        "bytesOut": 10,
                        "bytesIn": 20,
                    },
                    {
                        "at": "2026-09-25T10:00:01Z",
                        "mode": "refused",
                        "host": "evil.example",
                        "port": 443,
                        "status": "denied",
                        "bytesOut": 0,
                        "bytesIn": 0,
                    },
                ]
            ),
            _request(connection),
            principal,
        )
        rows = await connection.fetch(
            "select class, payload from audit_log where action='session.endpoint' order by id"
        )
        assert len(rows) == 2
        assert {row["class"] for row in rows} == {"authoritative"}
        assert rows[1]["payload"]["status"] == "denied"

        tally = [
            {
                "host": "api.crm.example",
                "port": 443,
                "alias": "crm",
                "count": 1,
                "refused": 0,
                "stripped": 0,
                "reasons": {},
                "firstAt": "2026-09-25T10:00:00Z",
                "lastAt": "2026-09-25T10:00:00Z",
            }
        ]
        closed = await routes_sessions.update_session(
            session_id,
            routes_sessions.SessionUpdate(
                status="closed", endpoints=[routes_sessions.EndpointTally(**tally[0])]
            ),
            _request(connection),
            principal,
        )
        assert closed == {"status": "closed", "minted_revoked": 0, "revoke_failed": []}
        stored = await connection.fetchval(
            "select endpoints_tally from harness_sessions where id=$1", session_id
        )
        assert stored == tally
        closed_event = await connection.fetchval(
            "select payload from audit_log where action='session.close'"
        )
        assert closed_event["endpoints_tally"] == tally


@requires_postgres
async def test_preflight_is_written_once():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        await _open(connection, world, session_id=session_id)
        principal = Principal(world["person"], "dana@acme.co")
        for passing in (True, False):
            await routes_sessions.update_session(
                session_id,
                routes_sessions.SessionUpdate(preflight={"passing": passing}),
                _request(connection),
                principal,
            )
        stored = await connection.fetchval(
            "select preflight from harness_sessions where id=$1", session_id
        )
        assert stored == {"passing": True}


# --- T3: the bundled resolver ---------------------------------------------


@requires_postgres
async def test_bundled_probe_and_resolve():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        bundled = Bundled(connection)
        context = {
            "person": "dana@acme.co",
            "session": str(uuid.uuid4()),
            "org": str(world["org"]),
            "group": "marketing",
            "grant": "g-marketing",
        }
        probe = await bundled.probe("secret://acme/crm")
        assert probe == {"ready": True, "evidence": "verified", "detail": "active version 1"}
        assert await bundled.probe("secret://acme/nothing") == {
            "ready": False,
            "evidence": "declared",
            "detail": "no active version",
        }
        minted = await bundled.resolve("secret://acme/crm", context, None)
        assert minted["value"] == SECRET_VALUE
        assert minted["kind"] == "stored"
        assert minted["expires_at"] is None
        assert minted["evidence"] == "verified"
        assert await bundled.revoke(minted) is None

        # Fails closed under a different master key.
        from app.config import get_settings

        get_settings.cache_clear()
        os.environ["HARNESS_MASTER_KEY"] = "H" * 42 + "w="
        try:
            with pytest.raises(ValueError):
                await bundled.resolve("secret://acme/crm", context, None)
        finally:
            os.environ["HARNESS_MASTER_KEY"] = MASTER_KEY
            get_settings.cache_clear()

        # 11 §11.3: two encrypts of one plaintext differ (bundled_nonce_never_reused).
        assert encrypt("same", key=MASTER_KEY) != encrypt("same", key=MASTER_KEY)


@requires_postgres
async def test_unknown_vault_is_a_slot_blocker():
    """The model's own key is held in the bundled vault (W6-D6, or step 5 would
    refuse the session); `crm` is the alias whose group names a vault `api` has
    not connected, and that is a blocker on its slot, not a refusal."""
    async with scratch_db(_all_migrations()) as connection:
        policy = _policy(credential="anthropic-key")
        policy["groups.json"] = [_group("marketing", vault="aws-prod"),
                                 _group("keys", alias="anthropic-key",
                                        ref="secret://acme/anthropic")]
        policy["grants.json"] = [*policy["grants.json"],
                                 {"id": "g-keys", "scope": {"teams": "all"},
                                  "group": "keys", "by": "d"}]
        world = await seed(connection, policy=policy)
        result = await _open(connection, world)
        assert result["slots"][0]["blocker"]["code"] == "broker.vault_unknown"
        assert "aws-prod" in result["slots"][0]["blocker"]["message"]


@requires_postgres
async def test_service_token_is_required_on_every_internal_endpoint():
    async with scratch_db(_all_migrations()) as connection:
        with pytest.raises(ApiError) as caught:
            await routes_internal.write_index(
                routes_internal.IndexWrite(org=uuid.uuid4(), ref=ORG_REF, commit="c"),
                _request(connection),
                None,
            )
        assert caught.value.status_code == 401


def test_every_failure_mode_message_is_formattable():
    """04 §9: every code exists and every placeholder is fed by a caller."""
    fields = {
        "provider": "pi",
        "reason": "r",
        "v": "1.0.0",
        "min": "2.0.0",
        "model": "m",
        "model_provider": "anthropic",
        "alias": "crm",
        "vault": "bundled",
        "status": "closed",
    }
    for code in broker.BLOCKERS:
        blocker = broker.Refusal(code, **fields).blocker
        assert blocker["message"].endswith((".", "!"))
        assert blocker["remedy"]


# --- T3: the AWS resolver, against recorded fixtures ----------------------
#
# 11 §5.10 runs `aws_probe_describe_only` against LocalStack; Docker is not
# available here, so these run against recordings of the two calls the
# resolver makes. The recording asserts the request parameters, which is the
# property 04 §10 names — the tags and the single-secret session policy.

ASSUMED = {
    "Credentials": {
        "AccessKeyId": "ASIAEXAMPLE",
        "SecretAccessKey": "not-a-real-secret",
        "SessionToken": "token",
        "Expiration": datetime(2026, 9, 25, 12, 0, tzinfo=UTC),
    }
}
DESCRIBED = {
    "Name": "marketing/crm-api-key",
    "LastChangedDate": "2026-09-01T00:00:00Z",
    "RotationEnabled": False,
    "VersionIdsToStages": {"v-current": ["AWSCURRENT"]},
}


class _RecordingSts:
    def __init__(self, error=None):
        self.calls = []
        self._error = error

    def assume_role(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return ASSUMED


class _RecordingSecrets:
    def __init__(self, described=DESCRIBED, error=None):
        self.calls = []
        self.credentials = None
        self._described, self._error = described, error

    def describe_secret(self, **kwargs):
        self.calls.append(("describe_secret", kwargs))
        if self._error:
            raise self._error
        return self._described

    def get_secret_value(self, **kwargs):
        self.calls.append(("get_secret_value", kwargs))
        return {"SecretString": SECRET_VALUE, "VersionId": "v-current"}


def _aws(sts=None, secrets=None):
    from app.domain.resolvers.aws import AwsSecretsManager

    secrets = secrets or _RecordingSecrets()

    def client_for(credentials):
        secrets.credentials = credentials
        return secrets

    return (
        AwsSecretsManager(
            "aws-prod",
            sts or _RecordingSts(),
            client_for,
            role_arn="arn:aws:iam::123456789012:role/harness-marketing",
            external_id="ext-abc",
            region="eu-west-1",
        ),
        secrets,
    )


async def test_aws_resolve_tags_and_scopes_session():
    sts = _RecordingSts()
    resolver, secrets = _aws(sts=sts)
    session = {
        "person": "dana@acme.co",
        "session": "3f1b2c4d",
        "org": "acme",
        "group": "marketing",
        "grant": "g-marketing",
    }
    minted = await resolver.resolve(
        "arn:aws:secretsmanager:eu-west-1:1:secret:marketing/crm",
        session,
        {"role_arn": "ignored", "duration_seconds": 900},
    )

    call = sts.calls[0]
    assert call["RoleArn"] == "arn:aws:iam::123456789012:role/harness-marketing"
    assert call["RoleSessionName"] == "harness-3f1b2c4d"
    assert len(call["RoleSessionName"]) <= 64
    assert call["DurationSeconds"] == 900
    assert call["Tags"] == [
        {"Key": "harness:person", "Value": "dana@acme.co"},
        {"Key": "harness:session", "Value": "3f1b2c4d"},
        {"Key": "harness:group", "Value": "marketing"},
    ]
    policy = json.loads(call["Policy"])
    assert policy["Statement"] == [
        {
            "Effect": "Allow",
            "Action": "secretsmanager:GetSecretValue",
            "Resource": "arn:aws:secretsmanager:eu-west-1:1:secret:marketing/crm",
        }
    ]
    assert len(call["Policy"]) <= 2048

    # D68/D120: the temporary keys are used server-side; what travels is the
    # secret's value as `stored`, under the earlier of the two expiries.
    assert secrets.credentials["AccessKeyId"] == "ASIAEXAMPLE"
    assert secrets.calls[0][0] == "get_secret_value"
    assert minted["value"] == SECRET_VALUE
    assert minted["kind"] == "stored"
    assert minted["version"] == "v-current"
    assert minted["expires_at"] == "2026-09-25T12:00:00+00:00"
    assert await resolver.revoke(minted) is None


async def test_aws_probe_describe_only():
    resolver, secrets = _aws()
    probe = await resolver.probe("arn:aws:secretsmanager:eu-west-1:1:secret:marketing/crm")
    assert probe["ready"] is True
    assert probe["evidence"] == "verified"
    assert "2026-09-01" in probe["detail"]
    assert "not proven until first use" in probe["detail"]
    # Describe only: the value was never fetched.
    assert [name for name, _ in secrets.calls] == ["describe_secret"]


async def test_aws_failures_are_reported_honestly():
    class Denied(Exception):
        code = "AccessDeniedException"

    _, _unused = _aws()
    resolver, _ = _aws(secrets=_RecordingSecrets(error=Denied()))
    probe = await resolver.probe("arn:aws:secretsmanager:eu-west-1:1:secret:marketing/crm")
    assert probe["ready"] is False
    assert probe["detail"] == (
        "`arn:aws:secretsmanager:eu-west-1:1:secret:marketing/crm` is named by a group "
        "but the role may not describe it."
    )

    resolver, _ = _aws(secrets=_RecordingSecrets(described={"DeletedDate": "2026-10-01"}))
    probe = await resolver.probe("arn:aws:secretsmanager:eu-west-1:1:secret:marketing/crm")
    assert probe["ready"] is False
    assert "scheduled for deletion" in probe["detail"]

    from app.domain.resolvers.aws import VaultFailure

    resolver, _ = _aws(sts=_RecordingSts(error=RuntimeError("no")))
    with pytest.raises(VaultFailure) as caught:
        await resolver.probe("arn:aws:secretsmanager:eu-west-1:1:secret:marketing/crm")
    assert caught.value.code == "vault.aws.assume_denied"


def test_we_never_write_to_a_customers_vault():
    """prd-v2 §6.2 / V2: no resolver has a create or rotate method, and the
    AWS one never names a write action."""
    from app.domain.resolvers.aws import AwsSecretsManager
    from app.domain.resolvers.bundled import Bundled

    source = Path(__file__).resolve().parents[1] / "app/domain/resolvers/aws.py"
    writes = ("PutSecretValue", "UpdateSecret", "RotateSecret", "CreateSecret", "DeleteSecret")
    for action in writes:
        assert action not in source.read_text()
    for resolver in (AwsSecretsManager, Bundled):
        assert not hasattr(resolver, "create")
        assert not hasattr(resolver, "rotate")


@requires_postgres
async def test_the_remaining_step_3_to_5_refusals():
    """10 rule 20: each of these is a refusal a person can hit, so each has a
    test that produces it."""
    async with scratch_db(_all_migrations()) as connection:
        # Approved, but scoped to a team the person is not on.
        scoped = _policy()
        scoped["harness-providers.json"][0]["scope"] = {"teams": ["acme.eng"]}
        world = await seed(connection, policy=scoped)
        with pytest.raises(ApiError) as caught:
            await _open(connection, world)
        assert caught.value.code == "broker.provider_not_in_scope"

    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection, policy=_policy(min_version="2.0.0"))
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, provider_version="1.2.0")
        assert caught.value.code == "broker.provider_below_pin"
        assert caught.value.message == (
            "Your `pi` is version 1.2.0; your organization requires 2.0.0."
        )

    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        with pytest.raises(ApiError) as caught:
            await _open(connection, world, harness=uuid.uuid4())
        assert caught.value.code == "broker.harness_not_found"

        with pytest.raises(ApiError) as caught:
            await _open(connection, world, model=("anthropic", "claude-opus-9"))
        assert caught.value.code == "broker.model_unknown"

        for _ in range(10):
            await _open(connection, world)
        with pytest.raises(ApiError) as caught:
            await _open(connection, world)
        assert caught.value.status_code == 429
        assert caught.value.code == "broker.rate_limited"


# --- W5-D14: the session remembers its workspace ---------------------------


@requires_postgres
async def test_open_stores_workspace_and_host_off_the_audit_trail():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        await _open(
            connection,
            world,
            session_id=session_id,
            workspace="/Users/dana/projects/newsletter",
            hostname="dana-mbp",
        )
        row = await connection.fetchrow(
            "select workspace, hostname from harness_sessions where id=$1", session_id
        )
        assert row["workspace"] == "/Users/dana/projects/newsletter"
        assert row["hostname"] == "dana-mbp"
        # A person's paths are theirs: the audit payload an admin reads never
        # carries them (W5-D14).
        payloads = await connection.fetchval(
            "select string_agg(payload::text, ' ') from audit_log where action='session.open'"
        )
        assert "newsletter" not in payloads and "dana-mbp" not in payloads


@requires_postgres
async def test_open_without_a_workspace_still_opens():
    """A CLI one version behind sends neither field (00 §4.10: both optional)."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        session_id = uuid.uuid4()
        result = await _open(connection, world, session_id=session_id)
        assert result["blockers"] == []
        row = await connection.fetchrow(
            "select workspace, hostname from harness_sessions where id=$1", session_id
        )
        assert row["workspace"] is None and row["hostname"] is None
