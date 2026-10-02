"""03 §12 tiers V3/V4: every `/v1/console/*` route against a scratch Postgres.

The world below is 05 R10's fixture organization — Acme, with Marketing and
Engineering, Jo (member), Rae (Marketing's admin), Dana (organization admin)
and Eve on the sibling team — seeded through `POST /v1/internal/index` so the
index rows are the ones `definitions` would have written, not hand-made rows.

Route functions are called in process for the reason `test_broker.py` gives: a
real HTTP client needs a second event loop, which the scratch connection does
not survive. `definitions` is a small local HTTP server, which is the only
network edge these tests mock (10 rule 17).
"""

import base64
import json
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from test_broker import SERVICE_TOKEN, _write_index
from test_resolve import ConnectionPool, _all_migrations, requires_postgres, scratch_db

from app.api import routes_console
from app.domain import console, seed
from app.domain.console_models import ModelProviderRow
from app.domain.sentences import SCALES
from app.errors import ApiError
from app.identity import Principal

ORG, MKT, ENG = "acme", "acme.marketing", "acme.eng"
ORG_REF, MKT_REF, ENG_REF = "refs/heads/org", f"refs/heads/teams/{MKT}", f"refs/heads/teams/{ENG}"
HARNESS = "11111111-1111-4111-8111-111111111111"
ASSET_ORG = "22222222-2222-4222-8222-222222222222"
ASSET_TEAM = "33333333-3333-4333-8333-333333333333"
CRM = "bundled:secret://acme/crm"
ICON = {"palette": ["#000000"], "rows": ["0" * 16] * 16}


def _edge(from_kind, from_id, rel, to_kind, to_id):
    return {"from_kind": from_kind, "from_id": from_id, "rel": rel,
            "to_kind": to_kind, "to_id": to_id}


def _policy_files():
    return {
        "groups.json": [
            {"name": "marketing", "sources": "vault", "entries": [
                {"alias": "crm", "secret": {"vault": "bundled", "ref": "secret://acme/crm"},
                 "upstream": "https://api.crm.example",
                 "attach": {"header": "Authorization", "prefix": "Bearer "}}]},
            {"name": "org-wide", "sources": "vault-or-local", "entries": [
                {"alias": "anthropic-key",
                 "secret": {"vault": "bundled", "ref": "secret://acme/anthropic"},
                 "upstream": "https://api.anthropic.com",
                 "attach": {"header": "x-api-key", "prefix": ""}}]},
        ],
        "grants.json": [
            {"id": "g-marketing", "scope": {"teams": [MKT], "harnesses": [HARNESS]},
             "group": "marketing", "by": "dana@acme.co"},
            {"id": "g-everyone", "scope": {"teams": "all"}, "group": "org-wide",
             "by": "dana@acme.co"},
            {"id": "g-reach", "scope": {"teams": [MKT]}, "reach": "outside-endpoints",
             "by": "dana@acme.co"},
        ],
        "boundaries.json": [
            {"id": "b-1", "scope": {"teams": "all"}, "kind": "endpoint",
             "value": "*.pastebin.com", "holds": "enforced", "reason": "exfiltration"}],
        "harness-providers.json": [
            # W6-D3: `name` is on the contract, so the console reads it rather
            # than holding a map of its own.
            {"id": "pi", "name": "Pi", "approval": "approved", "scope": {"teams": "all"},
             "pin": {"binary": "pi", "minVersion": "1.0.0"}, "speaks": ["anthropic-messages"]}],
        "model-providers.json": [
            {"id": "anthropic", "endpoints": {"anthropic-messages": "http://127.0.0.1:1"},
             "models": ["claude-sonnet-5"], "credential": {"alias": "anthropic-key"}}],
        "routing.json": {"defaultFor": {"teams": {MKT: "anthropic"}, "harnesses": {},
                                        "providers": {}},
                         "approvedFor": {"teams": {MKT: ["anthropic"]}, "harnesses": {},
                                         "providers": {}}},
        "kinds.json": ["skill"],
        "always-loaded.json": [ASSET_ORG],
        # D131: per node, like boundaries. The org reaches everything but one
        # host; marketing narrows that to a list of two.
        "reach.json": {"mode": "on", "hosts": ["competitor.example"]},
    }


_ORG_EDGES = [
    _edge("asset", ASSET_ORG, "placed_on", "node", ORG),
    _edge("group", "marketing", "entry", "alias", "crm"),
    _edge("group", "marketing", "entry_secret", "secret", CRM),
    _edge("group", "marketing", "entry_upstream", "origin", "https://api.crm.example"),
    _edge("group", "org-wide", "entry", "alias", "anthropic-key"),
    _edge("group", "org-wide", "entry_secret", "secret", "bundled:secret://acme/anthropic"),
    _edge("group", "org-wide", "entry_upstream", "origin", "https://api.anthropic.com"),
    _edge("grant", "g-marketing", "grants", "group", "marketing"),
    _edge("grant", "g-marketing", "scoped_to", "team", MKT),
    _edge("grant", "g-marketing", "only_for", "harness", HARNESS),
    _edge("grant", "g-everyone", "grants", "group", "org-wide"),
    _edge("grant", "g-everyone", "scoped_to", "team", "all"),
    _edge("grant", "g-reach", "reach", "reach", "outside-endpoints"),
    _edge("grant", "g-reach", "scoped_to", "team", MKT),
    _edge("boundary", "b-1", "scoped_to", "team", "all"),
    _edge("harness_provider", "pi", "scoped_to", "team", "all"),
    _edge("harness_provider", "pi", "speaks", "wire_format", "anthropic-messages"),
    _edge("model_provider", "anthropic", "credential", "alias", "anthropic-key"),
    _edge("model_provider", "anthropic", "exposes", "wire_format", "anthropic-messages"),
    _edge("model_provider", "anthropic", "default_for", "team", MKT),
    _edge("model_provider", "anthropic", "approved_for", "team", MKT),
]
_MKT_EDGES = [
    _edge("asset", ASSET_TEAM, "placed_on", "node", MKT),
    _edge("asset", ASSET_TEAM, "needs_alias", "alias", "crm"),
    _edge("harness", HARNESS, "includes", "asset", ASSET_TEAM),
    _edge("harness", HARNESS, "includes", "asset", ASSET_ORG),
]


def _sidecar(asset_id, kind, name, needs=()):
    return {"id": asset_id, "kind": kind, "name": name,
            "needs": [{"kind": "credential", "alias": alias} for alias in needs]}


async def _unit(connection, parent, role, name):
    return await connection.fetchval(
        "insert into org_units(parent_id,role,name) values ($1,$2,$3) returning id",
        parent, role, name)


async def _person(connection, team, name, *, admin_at=None):
    unit = await _unit(connection, team, "user", name)
    person = uuid.uuid4()
    await connection.execute("insert into auth.users(id,email) values ($1,$2)",
                             person, f"{name}@acme.co")
    await connection.execute(
        "insert into org_unit_members(auth_user_id,user_unit_id) values ($1,$2)", person, unit)
    if admin_at is not None:
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            person, admin_at)
    return person


async def world(connection):
    """Acme as 05 R10 names it, indexed through the real write endpoint."""
    org = await _unit(connection, None, "org", "acme")
    mkt = await _unit(connection, org, "team", "marketing")
    eng = await _unit(connection, org, "team", "eng")
    jo = await _person(connection, mkt, "jo")
    rae = await _person(connection, mkt, "rae", admin_at=mkt)
    dana = await _person(connection, mkt, "dana", admin_at=org)
    eve = await _person(connection, eng, "eve")
    await connection.execute(
        """insert into harnesses(id,org_unit_id,name,description,icon,created_by)
           values ($1,$2,'Support','the support desk',$3,$4)""",
        uuid.UUID(HARNESS), mkt, json.dumps(ICON), dana)
    await connection.execute(
        """insert into api_keys(org_unit_id,name,ref,kind,env_var,created_by)
           values ($1,'crm','secret://acme/crm','static_api_key','CRM_KEY',$2)""", org, dana)
    nodes = [
        {"path": ORG, "kind": "org", "ref": ORG_REF, "parent_path": None},
        {"path": MKT, "kind": "team", "ref": MKT_REF, "parent_path": ORG},
        {"path": ENG, "kind": "team", "ref": ENG_REF, "parent_path": ORG},
    ] + [{"path": f"{team}.{name}", "kind": "user", "ref": f"refs/heads/users/{person}",
          "parent_path": team}
         for team, name, person in ((MKT, "jo", jo), (MKT, "rae", rae), (MKT, "dana", dana),
                                    (ENG, "eve", eve))]
    await _write_index(connection, org, ORG_REF, "c-org", {
        "idx_nodes": nodes,
        "idx_policy": [{"node_path": ORG, "file": name, "body": body}
                       for name, body in _policy_files().items()],
        "idx_assets": [{"node_path": ORG, "id": ASSET_ORG, "kind": "skill", "name": "house-style",
                        "tree": "t-org", "sidecar": _sidecar(ASSET_ORG, "skill", "house-style")}],
        "idx_edges": _ORG_EDGES,
    })
    await _write_index(connection, org, MKT_REF, "c-team", {
        "idx_nodes": nodes,
        "idx_assets": [{"node_path": MKT, "id": ASSET_TEAM, "kind": "skill", "name": "triage",
                        "tree": "t-team",
                        "sidecar": _sidecar(ASSET_TEAM, "skill", "triage", ["crm"])}],
        "idx_harnesses": [{"node_path": MKT, "id": HARNESS, "name": "Support",
                           "def": {"id": HARNESS, "name": "Support",
                                   "description": "the support desk", "icon": ICON,
                                   "assets": [ASSET_ORG, ASSET_TEAM]}}],
        "idx_policy": [{"node_path": MKT, "file": "reach.json",
                        "body": {"mode": "allow", "hosts": ["pypi.org", "crates.io"]}}],
        "idx_edges": _MKT_EDGES,
        "idx_effective": [
            {"user_id": str(person), "asset_id": asset, "from_path": path, "shadows_path": None}
            for person in (jo, rae, dana)
            for asset, path in ((ASSET_ORG, ORG), (ASSET_TEAM, MKT))],
    })
    await _write_index(connection, org, ENG_REF, "c-eng", {"idx_nodes": nodes})
    for person in (jo, rae, dana, eve):
        await _write_index(connection, org, f"refs/heads/users/{person}", f"c-{person}",
                           {"idx_nodes": nodes})
    return {"org": org, "mkt": mkt, "eng": eng, "jo": jo, "rae": rae, "dana": dana, "eve": eve}


async def ctx_for(connection, person, scope=None, as_user=None, path="/v1/console/test"):
    return await console.context(ConnectionPool(connection), Principal(person, "x@acme.co"),
                                 scope, as_user, path)


async def _session(connection, world_, owner, *, commits, preflight=None, status="active",
                   workspace=None, hostname=None):
    session_id = uuid.uuid4()
    unit = await connection.fetchval(
        "select user_unit_id from org_unit_members where auth_user_id=$1", owner)
    await connection.execute(
        """insert into harness_sessions
             (id,org_unit_id,owner_auth_user_id,harness_id,provider_id,provider_version,
              model_provider,model,commits,slots,status,preflight,workspace,hostname)
           values ($1,$2,$3,$4,'pi','1.2.0','anthropic','claude-sonnet-5',$5,$6,$7,$8,$9,$10)""",
        session_id, unit, owner, uuid.UUID(HARNESS), json.dumps(commits),
        json.dumps({"crm": {"state": "satisfied", "evidence": "verified",
                            "resolvedFrom": {"source": "vault", "vault": "bundled",
                                             "group": "marketing", "grant": "g-marketing"},
                            "kind": "stored", "expires_at": None, "version": "1"}}),
        status, json.dumps(preflight) if preflight else None, workspace, hostname)
    return session_id


# --- the shell ---------------------------------------------------------------


@requires_postgres
async def test_me_carries_edition_staff_visibility_and_waiting():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            """insert into requests(org_unit_id,harness_id,author_auth_user_id,title,subject,
                                    subject_kind,base_commit)
               values ($1,$2,$3,'three files',$4,'promotion','c-team')""",
            people["mkt"], uuid.UUID(HARNESS), people["jo"],
            json.dumps({"kind": "promotion", "paths": ["assets/skill/triage"],
                        "commit": "c-jo"}))
        viewer = await routes_console.read_viewer(await ctx_for(connection, people["rae"]))
        assert viewer["edition"] == "enterprise" and viewer["staff"] is False
        assert viewer["role"] == {"level": "team-admin", "at": MKT}
        assert viewer["visibility"] == {"boundaries": True, "logs": True, "store": True}
        assert viewer["waiting"] == {"harnesses": 1}
        assert [team["path"] for team in viewer["teams"]] == [MKT]

        member = await routes_console.read_viewer(await ctx_for(connection, people["jo"]))
        assert member["role"]["level"] == "member" and member["waiting"] == {}


@requires_postgres
async def test_admin_here_follows_the_scope():
    """01 §4.4: `adminHere` is a fact about the scope the answer was computed
    for, not about the person, so `/v1/console/me` must be asked with the
    scope the console is drawing. At `me` everyone administers their own."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)

        async def admin_here(person, scope=None):
            viewer = await routes_console.read_viewer(
                await ctx_for(connection, people[person], scope=scope))
            return viewer["adminHere"]

        assert await admin_here("dana", "org") is True
        assert await admin_here("rae", f"team:{MKT}") is True
        assert await admin_here("dana", f"team:{MKT}") is True
        # Jo is on Marketing and may read it; she does not administer it. (At
        # `org` she is refused the scope outright, so the team is where the
        # false answer lives.)
        assert await admin_here("jo", f"team:{MKT}") is False
        with pytest.raises(ApiError):
            await ctx_for(connection, people["jo"], scope="org")
        # Their own branch is always theirs.
        for person in ("jo", "rae", "dana"):
            assert await admin_here(person) is True


@requires_postgres
async def test_setup_facts_are_the_four_things_the_person_has_done():
    """W7-D5: the Account screen's *Getting started* list is derived, not
    stored — four facts about what has already happened. Eve is on Engineering,
    which holds no harness, and has done nothing; Jo's chain holds Support, so
    the harness step is closed for her and nothing else is."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)

        async def setup(person):
            viewer = await routes_console.read_viewer(await ctx_for(connection, people[person]))
            return viewer["setup"]

        assert await setup("eve") == {"installed": False, "loggedIn": False,
                                      "model": None, "harness": False}
        # The seed writes no harness (D30h writes policy files), so any row on
        # the chain is the person's own first one.
        assert (await setup("jo"))["harness"] is True

        # `installed` is *the CLI has run*: the console cannot see a machine
        # (D45), so a session is the only evidence there is.
        await _session(connection, people, people["eve"], commits=[])
        assert (await setup("eve"))["installed"] is True

        # `loggedIn` is what `harness login` leaves behind on the server.
        await connection.execute(
            """insert into personal_access_tokens(auth_user_id,token_hash,name)
               values ($1,'h-eve','Laptop')""", people["eve"])
        eve = await setup("eve")
        assert eve["loggedIn"] is True and eve["harness"] is False
        # `model` is W7-N's (W7-D2); this helper answers `None` until it lands.
        assert eve["model"] is None


@requires_postgres
async def test_how_is_served_by_api():
    """03 D36/P14: one source of the words, so the CLI can print the same."""
    answer = await routes_console.read_how()
    assert answer["scales"]["preflight"]["href"] == "/console/how#preflight"


@requires_postgres
async def test_search_is_a_prefix_match_in_scope():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        hits = await routes_console.read_search(await ctx_for(connection, people["jo"]), "Sup")
        assert {hit["kind"] for hit in hits["items"]} >= {"harness"}
        assert hits["items"][0]["label"] == "Support"


# --- scope and `?as` ---------------------------------------------------------


@requires_postgres
async def test_member_cannot_read_sibling_team():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        with pytest.raises(ApiError) as caught:
            await ctx_for(connection, people["jo"], scope=f"team:{ENG}")
        assert caught.value.status_code == 403
        assert caught.value.code == "console.scope_forbidden"
        assert "admins" in caught.value.message and caught.value.remedy
        # The organization admin may open it, and so may Engineering's own.
        assert (await ctx_for(connection, people["dana"], scope=f"team:{ENG}")).scope == "team"
        assert (await ctx_for(connection, people["eve"], scope=f"team:{ENG}")).scope == "team"


@requires_postgres
async def test_org_scope_requires_an_org_admin():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        with pytest.raises(ApiError) as caught:
            await ctx_for(connection, people["rae"], scope="org")
        assert caught.value.code == "console.scope_forbidden"
        assert (await ctx_for(connection, people["dana"], scope="org")).scope == "org"


@requires_postgres
async def test_as_requires_admin_over_member():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        with pytest.raises(ApiError) as caught:
            await ctx_for(connection, people["jo"], as_user=people["rae"])
        assert caught.value.code == "console.as_forbidden" and caught.value.status_code == 403
        # Rae administers Marketing, so Jo's branch is hers to read.
        ctx = await ctx_for(connection, people["rae"], as_user=people["jo"])
        assert ctx.viewer == people["jo"] and ctx.actor == people["rae"]
        # Eve is on the sibling team, so she is not.
        with pytest.raises(ApiError):
            await ctx_for(connection, people["rae"], as_user=people["eve"])
        # A uuid that is nobody is refused as a reading, not as a missing workspace.
        with pytest.raises(ApiError) as unknown:
            await ctx_for(connection, people["rae"], as_user=uuid.uuid4())
        assert unknown.value.code == "console.as_forbidden"


@requires_postgres
async def test_as_is_audited():
    """03 D33: reading a member's branch is recorded — the member is told."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await ctx_for(connection, people["rae"], as_user=people["jo"],
                      path="/v1/console/harnesses")
        row = await connection.fetchrow(
            "select actor_id, payload, org_unit_id from audit_log where action='console.read_as'")
        assert row is not None and row["actor_id"] == people["rae"]
        assert row["payload"] == {"as": str(people["jo"]), "endpoint": "/v1/console/harnesses"}
        assert row["org_unit_id"] == people["mkt"]


def test_as_refused_on_writes():
    """03 §8.5/§8.8: `as` is never accepted on a write, which holds here by
    there being no write — every console route is a `GET`."""
    for route in routes_console.router.routes:
        assert set(route.methods) == {"GET"}, route.path


@requires_postgres
async def test_hidden_view_says_so():
    """P10: a hidden view carries the note, never a shorter list."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            """insert into org_unit_boundaries(org_unit_id,policy)
               values ($1,$2)""", people["org"],
            json.dumps({"visibility": {"boundaries": False, "logs": False}}))
        ctx = await ctx_for(connection, people["jo"])
        answer = await routes_console.read_boundaries(ctx)
        assert answer["items"] == []
        assert answer["hidden"] == {
            "boundaries": "An organization admin has turned off your view of boundaries."}
        logs = await routes_console.read_logs(await ctx_for(connection, people["jo"]), "harness")
        assert logs["items"] == [] and "logs" in logs["hidden"]
        # An admin reading the team is not the person whose view was turned off.
        wide = await routes_console.read_boundaries(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"))
        assert wide.get("hidden") is None and wide["items"]


# --- staleness ---------------------------------------------------------------


@requires_postgres
async def test_stale_index_flags_not_refuses():
    """03 D38: only the broker fails closed; the console says the index is
    behind and answers anyway."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            """insert into idx_stale(org,ref,commit,error) values ($1,$2,'c','compose threw')""",
            people["org"], MKT_REF)
        answer = await routes_console.read_harnesses(await ctx_for(connection, people["jo"]))
        assert len(answer["items"]) == 1
        assert answer["stale"]["refs"] == [MKT_REF] and answer["stale"]["since"]


# --- harnesses, files, requests ---------------------------------------------


@requires_postgres
async def test_cards_count_only_what_resolves_and_sort_own_team_first():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        cards = await routes_console.read_harnesses(await ctx_for(connection, people["jo"]))
        assert [card["name"] for card in cards["items"]] == ["Support"]
        assert cards["items"][0]["fileCount"] == 2
        assert cards["items"][0]["team"] == {"path": MKT, "name": "marketing"}
        # P11: a card carries no status of any kind.
        assert not {"preflight", "status", "differs"} & set(cards["items"][0])
        # Off the chain, it does not exist for Eve.
        assert await routes_console.read_harnesses(
            await ctx_for(connection, people["eve"])) == {"items": [], "next": None, "stale": None}


@requires_postgres
async def test_cards_carry_runners_approved_and_routed():
    """W5-D13: one launch button per runtime that could actually start this
    harness — approved for the level, scoped to it, and speaking a format the
    routed model exposes. A runtime failing any clause is not a button."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        cards = await routes_console.read_harnesses(await ctx_for(connection, people["jo"]))
        assert cards["items"][0]["runners"] == [{"id": "pi", "name": "Pi"}]

        await connection.execute(
            """update idx_policy set body=$1
                where org=$2 and node_path=$3 and file='harness-providers.json'""",
            json.dumps(_policy_files()["harness-providers.json"] + [
                # Declined: the organization says no, so there is no button.
                {"id": "claude", "approval": "not-approved", "scope": {"teams": "all"},
                 "pin": {"binary": "claude", "minVersion": "0.0.0"},
                 "speaks": ["anthropic-messages"]},
                # Approved, but it speaks nothing the routed model exposes.
                {"id": "codex", "approval": "approved", "scope": {"teams": "all"},
                 "pin": {"binary": "codex", "minVersion": "0.0.0"},
                 "speaks": ["openai-completions"]},
                # Approved and routed, but scoped to a team off this chain.
                {"id": "beta-pi", "approval": "beta", "scope": {"teams": [ENG]},
                 "pin": {"binary": "pi", "minVersion": "1.0.0"},
                 "speaks": ["anthropic-messages"]},
            ]), people["org"], ORG)
        cards = await routes_console.read_harnesses(
            await ctx_for(connection, people["jo"]))
        assert [runner["id"] for runner in cards["items"][0]["runners"]] == ["pi"]
        # The Providers table reads the wire-format half alone (`canRun` is a
        # derivation, not a permission), so `claude` and `beta-pi` are there:
        # what the card dropped them for is approval and scope, nothing else.
        rows = await routes_console.read_harness_providers(
            await ctx_for(connection, people["jo"]))
        reached = {row["id"] for row in rows["items"]
                   if HARNESS in {item["id"] for item in row["canRun"]["items"]}}
        assert reached == {"pi", "claude", "beta-pi"}


@requires_postgres
async def test_harness_off_the_chain_is_not_found():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        with pytest.raises(ApiError) as caught:
            await routes_console.read_harness(await ctx_for(connection, people["eve"]),
                                              uuid.UUID(HARNESS))
        assert caught.value.code == "console.harness_not_found"


@requires_postgres
async def test_harness_cards_collapse_copies_to_the_nearest():
    """A person's version of a harness (same id, their node) is the one card,
    not a second one — the React key clash of 29 Sep."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        mine = {"id": HARNESS, "name": "Support", "description": "jo's", "icon": ICON,
                "assets": [ASSET_ORG]}
        await connection.execute(
            "insert into idx_harnesses(org, node_path, id, name, def)"
            " values ($1,$2,$3,$4,$5::jsonb)",
            people["org"], f"{MKT}.jo", uuid.UUID(HARNESS), "Support", json.dumps(mine))
        ctx = await ctx_for(connection, people["jo"])
        cards = await console.cards(ctx)
        assert [card["id"] for card in cards].count(HARNESS) == 1
        assert next(card for card in cards if card["id"] == HARNESS)["team"]["path"] == f"{MKT}.jo"


@requires_postgres
async def test_cards_name_the_other_copies_as_also_at():
    """W5-D9: the nearest copy is the card, and every other copy of the same
    id on the chain is an *also at* link — organization first, then the team,
    because that is the order the chain is walked in."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        definition = {"id": HARNESS, "name": "Support", "description": "jo's", "icon": ICON,
                      "assets": [ASSET_ORG]}
        for path in (ORG, f"{MKT}.jo"):
            await connection.execute(
                "insert into idx_harnesses(org, node_path, id, name, def)"
                " values ($1,$2,$3,$4,$5::jsonb)",
                people["org"], path, uuid.UUID(HARNESS), "Support", json.dumps(definition))
        card = next(card for card in await console.cards(await ctx_for(connection, people["jo"]))
                    if card["id"] == HARNESS)
        assert card["team"]["path"] == f"{MKT}.jo"          # the nearest is still the card
        assert card["alsoAt"] == [
            {"level": "org", "label": "acme", "href": f"/console/org/harnesses/{HARNESS}"},
            {"level": "team", "label": "marketing",
             "href": f"/console/{MKT}/harnesses/{HARNESS}"},
        ]
        # From Rae's seat the person's copy is not on her chain, so the team's
        # copy is the card and the organization's is the one other level.
        rae = next(card for card in await console.cards(await ctx_for(connection, people["rae"]))
                   if card["id"] == HARNESS)
        assert [also["level"] for also in rae["alsoAt"]] == ["org"]
        # At `org` the scope reads one node, so there is no other copy to name.
        at_org = await console.cards(await ctx_for(connection, people["dana"], scope="org"))
        assert next(card for card in at_org if card["id"] == HARNESS)["alsoAt"] == []


@requires_postgres
async def test_harness_of_reads_the_nearest_copy():
    """Engine 01 D3 extended to harnesses: the person's own copy of a harness
    (same id, their node) is what `mine` reads; `team` reads the nearest other."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        mine = {"id": HARNESS, "name": "Support", "description": "jo's", "icon": ICON,
                "assets": [ASSET_ORG]}
        await connection.execute(
            "insert into idx_harnesses(org, node_path, id, name, def)"
            " values ($1,$2,$3,$4,$5::jsonb)",
            people["org"], f"{MKT}.jo", uuid.UUID(HARNESS), "Support", json.dumps(mine))
        ctx = await ctx_for(connection, people["jo"])
        assert (await console.harness_of(ctx, uuid.UUID(HARNESS)))["node_path"] == f"{MKT}.jo"
        assert (await console.harness_of(ctx, uuid.UUID(HARNESS), "team"))["node_path"] == MKT


@requires_postgres
async def test_harness_view_reach_is_the_chain_narrowed_by_the_harness():
    """W5-D7, D131. The harness page says how far a session of it may reach:
    the chain's walk — acme is `on` except one host, marketing narrows that to
    an allow-list of two — and then the harness's own step, which may narrow
    again and never widen. It replaces `header.outsideEndpoints`, which read
    the grant W5-D1b retired and had become a constant."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["jo"])
        view = await routes_console.read_harness(ctx, uuid.UUID(HARNESS))
        assert "outsideEndpoints" not in view["header"]
        assert view["reach"] == {"mode": "allow",
                                 "hosts": ["pypi.org", "crates.io"], "setBy": MKT}

        # The harness's own step: `off` under an allow-list is a narrowing, and
        # `setBy` becomes the harness rather than a node.
        own = {"id": HARNESS, "name": "Support", "description": "the support desk",
               "icon": ICON, "assets": [ASSET_ORG, ASSET_TEAM],
               "reach": {"mode": "off", "hosts": []}}
        await connection.execute(
            "update idx_harnesses set def=$3::jsonb where org=$1 and id=$2",
            people["org"], uuid.UUID(HARNESS), json.dumps(own))
        narrowed = await routes_console.read_harness(
            await ctx_for(connection, people["jo"]), uuid.UUID(HARNESS))
        assert narrowed["reach"] == {"mode": "off", "hosts": [],
                                     "setBy": f"harness:{HARNESS}"}

        # A widening step is ignored, exactly as the composition ignores it:
        # the chain stands and the harness does not name itself.
        wider = {**own, "reach": {"mode": "on", "hosts": []}}
        await connection.execute(
            "update idx_harnesses set def=$3::jsonb where org=$1 and id=$2",
            people["org"], uuid.UUID(HARNESS), json.dumps(wider))
        stands = await routes_console.read_harness(
            await ctx_for(connection, people["jo"]), uuid.UUID(HARNESS))
        assert stands["reach"]["mode"] == "allow" and stands["reach"]["setBy"] == MKT


@requires_postgres
async def test_harness_view_preflight_derivation():
    """03 D31: a session counts only when its commits are the index's now."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["jo"])
        view = await routes_console.read_harness(ctx, uuid.UUID(HARNESS))
        # No session yet, so the three-clause dry check decides, and passes.
        assert view["header"]["preflight"]["value"] == "passing"
        assert view["header"]["preflight"]["provenance"] == "derived"
        assert view["header"]["modelProvider"]["value"] == "anthropic"
        assert view["header"]["groups"]["value"] == ["marketing", "org-wide"]
        assert view["header"]["fileCount"] == 2
        assert [row["owner"] for row in view["files"]] == ["org", "team"]
        assert {boundary["setBy"]["path"] for boundary in view["boundaries"]} == {ORG}
        assert [option["id"] for option in view["versions"]] == ["mine", "team"]

        # A session on the refs the index holds now decides instead of the check.
        current = {ORG_REF: "c-org", MKT_REF: "c-team",
                   f"refs/heads/users/{people['jo']}": f"c-{people['jo']}"}
        await _session(connection, people, people["jo"], commits=current,
                       preflight={"passing": False, "at": "2026-01-01T00:00:00Z"})
        again = await routes_console.read_harness(await ctx_for(connection, people["jo"]),
                                                  uuid.UUID(HARNESS))
        assert again["header"]["preflight"]["value"] == "failing"


@requires_postgres
async def test_preflight_rule_prefers_matching_commits():
    """A session on refs that have since moved proves nothing about now."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await _session(connection, people, people["jo"],
                       commits={ORG_REF: "older", MKT_REF: "older"},
                       preflight={"passing": False, "at": "2026-01-01T00:00:00Z"})
        view = await routes_console.read_harness(await ctx_for(connection, people["jo"]),
                                                 uuid.UUID(HARNESS))
        assert view["header"]["preflight"]["value"] == "passing"   # the dry check, not the session


@requires_postgres
async def test_team_admin_sees_member_versions():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        view = await routes_console.read_harness(await ctx_for(connection, people["rae"]),
                                                 uuid.UUID(HARNESS))
        assert f"member:{people['jo']}" in {option["id"] for option in view["versions"]}
        # `?as` narrows to that member's own two (PRD §18).
        narrowed = await routes_console.read_harness(
            await ctx_for(connection, people["rae"], as_user=people["jo"]), uuid.UUID(HARNESS))
        assert [option["id"] for option in narrowed["versions"]] == ["mine", "team"]


@requires_postgres
async def test_team_version_drops_the_persons_own_ref():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["jo"])
        row = await console.harness_of(ctx, uuid.UUID(HARNESS))
        mine = await console.file_rows(ctx, row["def"], "mine", with_editor=False)
        team = await console.file_rows(ctx, row["def"], "team", with_editor=False)
        assert len(mine) == 2 and len(team) == 2       # nothing of Jo's own is in this harness
        assert console.differs({r["assetId"]: r["tree"] for r in mine},
                               {r["assetId"]: r["tree"] for r in team}, None) == {}


@requires_postgres
async def test_requests_stale_when_team_moved():
    """PRD §17.3: the team's copy has since changed."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            """insert into requests(org_unit_id,harness_id,author_auth_user_id,title,reasoning,
                                    subject,subject_kind,base_commit)
               values ($1,$2,$3,'triage, tightened','',$4,'promotion','c-team')""",
            people["mkt"], uuid.UUID(HARNESS), people["jo"],
            json.dumps({"kind": "promotion", "paths": ["assets/skill/triage"], "commit": "c-jo"}))
        fresh = await routes_console.read_harness_requests(
            await ctx_for(connection, people["rae"]), uuid.UUID(HARNESS))
        assert fresh["items"][0]["files"][0]["stale"] is False
        assert fresh["items"][0]["verbs"] == ["accept", "decline", "comment"]

        await _write_index(connection, people["org"], MKT_REF, "c-team-2", {})
        moved = await routes_console.read_harness_requests(
            await ctx_for(connection, people["rae"]), uuid.UUID(HARNESS))
        assert moved["items"][0]["files"][0]["stale"] is True
        # A member may comment and not decide (P13's verbs come from the server).
        mine = await routes_console.read_harness_requests(
            await ctx_for(connection, people["jo"]), uuid.UUID(HARNESS))
        assert mine["items"][0]["verbs"] == ["withdraw", "comment"]


# --- sessions ----------------------------------------------------------------


@requires_postgres
async def test_sessions_scope_by_subtree():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await _session(connection, people, people["jo"], commits={})
        await _session(connection, people, people["eve"], commits={})
        mine = await routes_console.read_sessions(await ctx_for(connection, people["jo"]))
        assert [row["person"]["name"] for row in mine["items"]] == ["jo@acme.co"]
        team = await routes_console.read_sessions(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"))
        assert {row["person"]["name"] for row in team["items"]} == {"jo@acme.co"}
        # Being *on* the team is not administering it: a member at team scope
        # reads their own records and nobody else's (05 §4, `role`).
        await _session(connection, people, people["rae"], commits={})
        member = await routes_console.read_sessions(
            await ctx_for(connection, people["jo"], scope=f"team:{MKT}"))
        assert {row["person"]["name"] for row in member["items"]} == {"jo@acme.co"}
        every = await routes_console.read_sessions(
            await ctx_for(connection, people["dana"], scope="org"))
        assert {row["person"]["name"] for row in every["items"]} == {
            "jo@acme.co", "rae@acme.co", "eve@acme.co"}


@requires_postgres
async def test_a_session_shows_what_a_boundary_refused_and_nothing_else():
    """W6-D9. A command boundary is `intercepted`: the runtime refuses the
    call as it is made, so the proxy log never sees it and the endpoint tally
    never counts it. The spool line the runtime wrote is the whole record,
    and the session page is where it is read. The *other* tool calls are not
    shown — a session makes hundreds and none of the rest is a record of
    anything a person has to look up."""
    async with scratch_db(_all_migrations()) as connection:
        from app.domain.audit import append_event
        people = await world(connection)
        session_id = await _session(connection, people, people["jo"], commits={},
                                    preflight={"passing": True, "slots": [], "blockers": []})
        unit = await connection.fetchval(
            "select user_unit_id from org_unit_members where auth_user_id=$1",
            people["jo"])
        for payload in (
            {"tool": "bash", "plain_sentence": "I'll run a command to rm -rf /x.",
             "ok": False, "duration_ms": 0, "session": str(session_id),
             "refused": "boundary:acme/b-wipe"},
            {"tool": "bash", "plain_sentence": "I'll run a command to ls.",
             "ok": True, "duration_ms": 3, "session": str(session_id)},
            # Another session's refusal: never this session's row.
            {"tool": "bash", "plain_sentence": "I'll run a command to rm -rf /y.",
             "ok": False, "duration_ms": 0, "session": str(uuid.uuid4()),
             "refused": "boundary:acme/b-wipe"},
        ):
            await append_event(connection, org_unit_id=unit, actor_type="user",
                               actor_id=people["jo"], event_class="attested",
                               action="tool.call", payload=payload)
        view = await routes_console.read_session(
            await ctx_for(connection, people["jo"]), session_id)
        assert view["refusals"] == [{
            "tool": "bash",
            "said": "I'll run a command to rm -rf /x.",
            # The composed id, so the row can name the boundary and the level
            # that set it — and the person can go and read its reason.
            "boundary": "acme/b-wipe",
            "at": view["refusals"][0]["at"],
        }]
        # A session with nothing refused carries an empty list, not a key that
        # is sometimes missing.
        other = await _session(connection, people, people["jo"], commits={},
                               preflight={"passing": True, "slots": [], "blockers": []})
        assert (await routes_console.read_session(
            await ctx_for(connection, people["jo"]), other))["refusals"] == []


@requires_postgres
async def test_session_view_never_contains_values():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        session_id = await _session(connection, people, people["jo"], commits={ORG_REF: "c-org"},
                                    preflight={"passing": True, "slots": [], "blockers": []})
        view = await routes_console.read_session(await ctx_for(connection, people["jo"]),
                                                 session_id)
        assert view["slots"][0]["need"] == {"kind": "credential", "alias": "crm"}
        assert view["slots"][0]["evidence"] == "verified"
        assert view["preflight"]["passing"] is True
        assert view["commits"] == {ORG_REF: "c-org"}
        # B6: the record holds provenance only, so no value can reach the wire.
        text = json.dumps(view)
        assert "value" not in json.loads(text)["slots"][0]
        assert "sk-" not in text

        with pytest.raises(ApiError) as caught:
            await routes_console.read_session(await ctx_for(connection, people["eve"]), session_id)
        assert caught.value.code == "session.not_visible"


@requires_postgres
async def test_no_value_in_audit():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await ctx_for(connection, people["rae"], as_user=people["jo"])
        payloads = await connection.fetchval("select string_agg(payload::text,' ') from audit_log")
        assert "secret://" not in (payloads or "") and "sk-" not in (payloads or "")


# --- groups, grants, boundaries ---------------------------------------------


@requires_postgres
async def test_groups_related_all_teams_when_all():
    """P4: `all: true` renders *All teams*, never a repeated list."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        rows = await routes_console.read_groups(
            await ctx_for(connection, people["dana"], scope="org"))
        wide = next(row for row in rows["items"] if row["name"] == "org-wide")
        assert wide["teams"] == {"unit": "teams", "items": [], "all": True}
        assert wide["sources"] == "vault-or-local"
        narrow = next(row for row in rows["items"] if row["name"] == "marketing")
        assert [item["label"] for item in narrow["teams"]["items"]] == ["marketing"]


@requires_postgres
async def test_group_entries_are_the_policy_entries_verbatim():
    """04 §8 *Add an entry*: a `PATCH` replaces the whole list, so the row has
    to hand back what is held — vault, ref and attachment, and no value."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        rows = await routes_console.read_groups(
            await ctx_for(connection, people["dana"], scope="org"))
        entry = next(row for row in rows["items"] if row["name"] == "marketing")["entries"][0]
        assert entry == _policy_files()["groups.json"][0]["entries"][0]
        assert entry["secret"] == {"vault": "bundled", "ref": "secret://acme/crm"}
        assert entry["attach"] == {"header": "Authorization", "prefix": "Bearer "}
        assert "value" not in json.dumps(entry)


@requires_postgres
async def test_grants_table_mixes_group_and_reach_rows():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        rows = await routes_console.read_grants(
            await ctx_for(connection, people["dana"], scope="org"))
        gives = {row["id"]: row["gives"] for row in rows["items"]}
        assert gives == {"g-marketing": "entries", "g-everyone": "entries", "g-reach": "reach"}
        assert next(r for r in rows["items"] if r["id"] == "g-marketing")["entryCount"] == 1


@requires_postgres
async def test_boundaries_carry_the_node_that_set_them():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        rows = await routes_console.read_boundaries(await ctx_for(connection, people["jo"]))
        assert len(rows["items"]) == 1
        assert rows["items"][0]["setBy"] == {"kind": "org", "path": ORG, "name": "acme",
                                             "ref": ORG_REF, "commit": "c-org"}
        assert rows["items"][0]["value"] == "*.pastebin.com"
        # Nothing asked `definitions`, so the moment is unknown rather than now.
        assert rows["items"][0]["when"] is None


@requires_postgres
async def test_the_command_starter_set_is_offered_and_never_offered_twice():
    """W6-D10. `presets/command-boundaries.json` is `managed: suggested`, so it
    is never seeded: it is offered on Boundaries → Commands as one-click adds,
    and `present` is the one thing the file cannot say about itself."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        offered = await routes_console.read_suggested_commands(
            await ctx_for(connection, people["dana"], scope="org"))
        values = [one["value"] for one in offered["suggested"]]
        assert values == [one["value"] for one in seed.presets("command-boundaries.json")]
        assert "rm -rf /*" in values
        # Every one of them is intercepted, carries its reason, and is on offer
        # because nothing holds it yet.
        assert {one["holds"] for one in offered["suggested"]} == {"intercepted"}
        assert all(one["reason"] for one in offered["suggested"])
        assert not any(one["present"] for one in offered["suggested"])
        assert offered["canEdit"] is True

        # Nothing was seeded by asking: the organization's own list is still
        # the one endpoint boundary `world()` put there.
        rows = await routes_console.read_boundaries(
            await ctx_for(connection, people["dana"], scope="org"))
        assert [row["kind"] for row in rows["items"]] == ["endpoint"]

        # Once the organization holds one, it is said to be held rather than
        # offered again — and a team sees it the same way, because a boundary
        # above this level is one this level already has.
        await connection.execute(
            """update idx_policy set body = body || $1::jsonb
                 where org=$2 and node_path=$3 and file='boundaries.json'""",
            json.dumps([{"id": "b-wipe", "scope": {"teams": "all"}, "kind": "command",
                         "value": "rm -rf /*", "holds": "intercepted", "reason": "no."}]),
            people["org"], ORG)
        for who, scope in ((people["dana"], "org"), (people["rae"], f"team:{MKT}")):
            again = await routes_console.read_suggested_commands(
                await ctx_for(connection, who, scope=scope))
            held = {one["value"]: one["present"] for one in again["suggested"]}
            assert held["rm -rf /*"] is True
            assert held["git push --force*"] is False

        # A member administers nothing, so they are offered nothing to click.
        as_member = await routes_console.read_suggested_commands(
            await ctx_for(connection, people["jo"], scope=f"team:{MKT}"))
        assert as_member["canEdit"] is False
        assert [one["value"] for one in as_member["suggested"]] == values


# --- the edge walk -----------------------------------------------------------


@requires_postgres
async def test_edge_walk_is_directed_two_hops():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        walk = await routes_console.read_edges(ctx, "harness", HARNESS)
        rests = {(item["kind"], item["id"]): item["via"] for item in walk["restsOn"]}
        rested = {(item["kind"], item["id"]): item["via"] for item in walk["restedOnBy"]}
        assert rests[("asset", ASSET_TEAM)] == "includes"
        assert rests[("alias", "crm")] == "satisfied by"          # two hops, out
        assert rested[("grant", "g-marketing")] == "only for"
        # The two directions are never merged (PRD §14 principle 1).
        assert set(rests) & set(rested) == set()


@requires_postgres
async def test_edge_walk_two_hops_directed():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        walk = await routes_console.read_edges(ctx, "group", "marketing")
        assert ("secret", CRM) in {(item["kind"], item["id"]) for item in walk["restsOn"]}
        assert ("grant", "g-marketing") in {(item["kind"], item["id"])
                                            for item in walk["restedOnBy"]}


@requires_postgres
async def test_secret_walk_reaches_harnesses():
    """03 §5: *rotate this and these stop*."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        walk = await routes_console.read_edges(ctx, "secret", CRM)
        reached = {(item["kind"], item["id"]) for item in walk["restedOnBy"]}
        assert ("group", "marketing") in reached
        assert ("grant", "g-marketing") in reached
        assert ("harness", HARNESS) in reached
        assert ("team", MKT) in reached


# --- providers, routing, vaults, organization assets ------------------------


@requires_postgres
async def test_provider_rows_carry_scope_and_derived_can_run():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_harness_providers(ctx)
        assert rows["items"][0]["teams"]["all"] is True
        assert [item["id"] for item in rows["items"][0]["canRun"]["items"]] == [HARNESS]


@requires_postgres
async def test_model_status_is_held_then_probed():
    """W6-D6: *set up* is a held key **and** an answer. The fixture's endpoint is
    a dead port, so a provider whose key is held reads *unreachable* — which is
    a different problem from *needs a key* and says so."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_model_providers(ctx)
        row = rows["items"][0]
        assert row["status"] == "unreachable"
        assert row["credential"] == "anthropic-key"
        assert [item["label"] for item in row["groups"]["items"]] == ["org-wide"]
        assert row["defaultFor"]["teams"] == [MKT]
        # Nothing but the three values, and `providerStatus` registers them.
        assert row["status"] in {value["value"] for value in SCALES["providerStatus"]["values"]}


@requires_postgres
async def test_a_provider_needing_a_key_is_excluded_and_says_why():
    """W6-D6: no group entry holds its alias, so it is *needs-key*; it is not
    probed; `speaks_routed` is false for it, so the runtime that would run on it
    carries no `canRun` row and the card draws no button for it.

    W7-D2 kept this for the provider it is true of: `openai`, which Pi ships no
    sign-in for — its own OAuth flow is `openai-codex` — so there is no own
    login to fall back to and a key is still the only way anything routes."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        files = _policy_files()
        # The alias no group holds, and the default pointed at it.
        files["model-providers.json"] = [
            {"id": "openai", "endpoints": {"anthropic-messages": "https://api.openai.com"},
             "models": ["claude-sonnet-5"], "credential": {"alias": "nobody-holds-this"}}]
        files["routing.json"] = {
            "defaultFor": {"teams": {MKT: "openai"}, "harnesses": {}, "providers": {}},
            "approvedFor": {"teams": {MKT: ["openai"]}, "harnesses": {}, "providers": {}}}
        for file, body in files.items():
            await connection.execute(
                """update idx_policy set body=$1
                    where org=$2 and node_path=$3 and file=$4""",
                json.dumps(body), people["org"], ORG, file)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_model_providers(ctx)
        assert [row["status"] for row in rows["items"]] == ["needs-key"]
        providers = await routes_console.read_harness_providers(ctx)
        assert providers["items"][0]["canRun"]["items"] == []
        cards = await routes_console.read_harnesses(await ctx_for(connection, people["jo"]))
        assert cards["items"][0]["runners"] == []


@requires_postgres
async def test_a_keyless_provider_the_runtime_signs_in_to_reads_sign_in():
    """W7-D2, the console's half: the same keyless row, under a provider Pi has
    its own `/login` for, is *sign-in* rather than *needs-key* — and it is not
    excluded, because the broker allows that session. The runtime keeps its
    `canRun` row, the card keeps its launch button, and no probe runs: the
    endpoint a native session reaches is the provider's own, not ours.

    The viewer's `setup.model` reads the same fact for the Account list, so the
    checklist cannot say *add a model* about a model the person can already
    run."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        files = _policy_files()
        files["model-providers.json"] = [
            {"id": "anthropic", "endpoints": {"anthropic-messages": "https://api.anthropic.com"},
             "models": ["claude-sonnet-5"], "credential": {"alias": "nobody-holds-this"}}]
        for file, body in files.items():
            await connection.execute(
                """update idx_policy set body=$1
                    where org=$2 and node_path=$3 and file=$4""",
                json.dumps(body), people["org"], ORG, file)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_model_providers(ctx)
        assert [row["status"] for row in rows["items"]] == ["sign-in"]
        assert rows["items"][0]["status"] in {
            value["value"] for value in SCALES["providerStatus"]["values"]}
        providers = await routes_console.read_harness_providers(ctx)
        assert [item["id"] for item in providers["items"][0]["canRun"]["items"]] == [HARNESS]
        jo = await ctx_for(connection, people["jo"])
        cards = await routes_console.read_harnesses(jo)
        assert [one["id"] for one in cards["items"][0]["runners"]] == ["pi"]
        assert (await routes_console.read_viewer(jo))["setup"]["model"] == "sign-in"


@requires_postgres
async def test_a_not_approved_runtime_signs_nobody_in():
    """W7-D2: *sign-in* is a promise that a session can run here. A runtime
    nobody may run cannot keep it, so the row is back to *needs-key* and the
    person is sent to the key, which is the thing they can actually do."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        files = _policy_files()
        files["model-providers.json"] = [
            {"id": "anthropic", "endpoints": {"anthropic-messages": "https://api.anthropic.com"},
             "models": ["claude-sonnet-5"], "credential": {"alias": "nobody-holds-this"}}]
        files["harness-providers.json"] = [
            {**files["harness-providers.json"][0], "approval": "not-approved",
             "reason": "the security review is open"}]
        for file, body in files.items():
            await connection.execute(
                """update idx_policy set body=$1
                    where org=$2 and node_path=$3 and file=$4""",
                json.dumps(body), people["org"], ORG, file)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_model_providers(ctx)
        assert [row["status"] for row in rows["items"]] == ["needs-key"]
        assert (await routes_console.read_viewer(ctx))["setup"]["model"] is None


@requires_postgres
async def test_the_viewer_says_whether_the_default_model_has_a_key():
    """W7-D2's `setup.model`, the field W7-H's modal and W7-A's checklist read.
    The fixture holds `anthropic-key` in a group, so the person's default is
    *key* — the key half, not the sign-in half, and not a guess at either."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        viewer = await routes_console.read_viewer(
            await ctx_for(connection, people["jo"]))
        assert viewer["setup"]["model"] == "key"


@requires_postgres
async def test_routing_subjects_carry_a_word_never_an_id():
    """W6-D5: *Set default…* and *Approve for…* pick from these, and a harness
    id is a uuid (`node_label_only_on_paths`)."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        matrix = await routes_console.read_routing(ctx)
        subjects = matrix["subjects"]
        assert [subject["id"] for subject in subjects["teams"]] == [ORG, ENG, MKT]
        assert [subject["label"] for subject in subjects["teams"]] == ["acme", "eng", "marketing"]
        assert [subject["label"] for subject in subjects["harnesses"]] == ["Support"]
        assert subjects["providers"] == [{"id": "pi", "label": "Pi"}]


@requires_postgres
async def test_a_seeded_organization_reads_with_no_credential():
    """D30h's first draw: every preset is a row before any key exists, and a row
    without one carries `credential: null` rather than dropping the field —
    *Set up* is the verb the console shows on exactly that (04 §10)."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        seeded = seed.seed_policy("enterprise")
        for row in seeded["policy/model-providers.json"]:
            # The probe is observed at draw (P2); these tests do not reach the
            # network, so the origins are the same dead port the row above uses.
            row["endpoints"] = {fmt: "http://127.0.0.1:1" for fmt in row["endpoints"]}
        await _write_index(connection, people["org"], ORG_REF, "c-org", {
            "idx_policy": [{"node_path": ORG, "file": path.removeprefix("policy/"), "body": body}
                           for path, body in seeded.items()]})
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_model_providers(ctx)
        assert [row["id"] for row in rows["items"]] == ["openrouter", "anthropic", "openai"]
        assert all(row["credential"] is None for row in rows["items"])
        assert "credential" in ModelProviderRow(**rows["items"][0]).model_dump()
        assert all(row["approval"] == "not-approved"
                   for row in (await routes_console.read_harness_providers(ctx))["items"])


@requires_postgres
async def test_vault_reachable_is_observed_not_stored():
    """03 D34/P2: probed at draw, three seconds, and written nowhere."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_vaults(ctx)
        bundled = next(row for row in rows["items"] if row["id"] == "bundled")
        assert bundled["reachable"]["provenance"] == "observed"
        assert bundled["handsUs"] == "stored" and bundled["contents"] == "listable"
        # PRD §6.2: the person's machine is a row, so no row has a blank provider.
        assert "your machine" in {row["id"] for row in rows["items"]}
        # Nothing about reachability was stored.
        tables = await connection.fetch(
            "select table_name from information_schema.columns where column_name='reachable'")
        assert list(tables) == []


@requires_postgres
async def test_secret_rows_carry_the_two_findings():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_secrets(ctx, "bundled")
        by_ref = {row["ref"]: row for row in rows["items"]}
        # `crm` is both listed and named by a group: neither finding.
        assert by_ref["secret://acme/crm"]["uncovered"] is False
        assert by_ref["secret://acme/crm"]["dangling"] is False
        # `anthropic` is named by a group and not in the vault: a dangling pointer.
        assert by_ref["secret://acme/anthropic"]["dangling"] is True
        assert by_ref["secret://acme/crm"]["ready"]["provenance"] == "observed"


@requires_postgres
async def test_org_asset_rows_say_always_loaded_reaches_every_harness():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_assets(ctx)
        row = rows["items"][0]
        # W5-D10: `required` is the word `always` became.
        assert row["loads"] == {"scale": "loads", "value": "required"}
        assert row["harnesses"]["all"] is True        # PRD §15, rendered as one word
        assert [item["label"] for item in row["teams"]["items"]] == ["acme"]
        detail = await routes_console.read_asset(ctx, ASSET_ORG)
        assert detail["edges"]["restedOnBy"]


@requires_postgres
async def test_assets_are_the_levels_own_copies():
    """W5-D9: one screen at every level, each showing the copies that node
    holds — the person's own at `me`, the team's at a team, the
    organization's at `org` — and the organization's kind vocabulary beside
    them, so a kind with nothing in it is still a tab."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        mine = uuid.uuid4()
        await connection.execute(
            """insert into idx_assets(org, node_path, id, kind, name, tree, sidecar)
               values ($1,$2,$3,'prompt','stand-up','t-jo',$4::jsonb)""",
            people["org"], f"{MKT}.jo", mine,
            json.dumps(_sidecar(str(mine), "prompt", "stand-up")))

        async def names(person, scope=None):
            answer = await routes_console.read_assets(
                await ctx_for(connection, people[person], scope=scope))
            return [row["name"] for row in answer["items"]], answer["kinds"]

        own, kinds = await names("jo")
        assert own == ["stand-up"] and kinds == ["skill"]
        assert (await names("jo", f"team:{MKT}"))[0] == ["triage"]
        assert (await names("dana", "org"))[0] == ["house-style"]
        # Rae's own branch holds nothing; the screen is hers and empty, not
        # the organization's list borrowed (the bug W5-D9 names).
        assert (await names("rae"))[0] == []


# --- the store (W5-D15) ------------------------------------------------------

PRESET_SKILL = "0460b220-8379-5ddf-82ef-31bc0e8a99e1"      # skill/harness-authoring
PRESET_BRIEF = "7b1f5c94-2d0a-5e63-9c18-4a6d3f0b28c7"      # system_prompt/harness


@requires_postgres
async def test_browse_lists_the_chain_and_the_presets_the_org_lacks():
    """W5-D15: everything the viewer can use, each row naming the branch the
    copy would come from. One row per id — the winning copy — so a shadowed
    copy is not offered twice, and the bundled presets the organization does
    not hold follow, marked as presets."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        mine = uuid.uuid4()
        await connection.execute(
            """insert into idx_assets(org, node_path, id, kind, name, tree, sidecar)
               values ($1,$2,$3,'prompt','stand-up','t-jo',$4::jsonb)""",
            people["org"], f"{MKT}.jo", mine,
            json.dumps(_sidecar(str(mine), "prompt", "stand-up")))
        await connection.execute(
            """insert into idx_effective(org, user_id, asset_id, from_path)
               values ($1,$2,$3,$4)""", people["org"], people["jo"], mine, f"{MKT}.jo")

        answer = await routes_console.read_browse(await ctx_for(connection, people["jo"]))
        rows = {row["name"]: row for row in answer["items"]}
        assert rows["house-style"]["level"] == "org"
        assert rows["house-style"]["from"] == "acme"
        # The link carries the level that **holds** the copy, not the level
        # the viewer is on: the asset page is one node's own copies (W5-D9).
        assert rows["house-style"]["href"] == f"/console/org/assets/{ASSET_ORG}"
        assert rows["house-style"]["held"] is False
        assert rows["triage"]["level"] == "team" and rows["triage"]["from"] == "marketing"
        # Their own copy is the one marked held, and its page is at `me`.
        assert rows["stand-up"]["level"] == "me" and rows["stand-up"]["held"] is True
        assert rows["stand-up"]["href"] == f"/console/me/assets/{mine}"
        # The bundled assets this organization does not hold, as presets.
        assert rows["harness-authoring"]["preset"] is True
        assert rows["harness-authoring"]["level"] == "preset"
        assert rows["harness-authoring"]["href"] is None
        assert {row["id"] for row in answer["items"]} >= {PRESET_SKILL, PRESET_BRIEF}


@requires_postgres
async def test_browse_offers_a_preset_once_the_chain_already_answers_it():
    """A preset the organization has taken is not offered again: it is in the
    composed set, so it is one of the chain's rows and not a preset row."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            """insert into idx_assets(org, node_path, id, kind, name, tree, sidecar)
               values ($1,$2,$3,'skill','harness-authoring','t-p',$4::jsonb)""",
            people["org"], ORG, uuid.UUID(PRESET_SKILL),
            json.dumps({"id": PRESET_SKILL, "kind": "skill"}))
        await connection.execute(
            """insert into idx_effective(org, user_id, asset_id, from_path)
               values ($1,$2,$3,$4)""", people["org"], people["jo"],
            uuid.UUID(PRESET_SKILL), ORG)
        answer = await routes_console.read_browse(await ctx_for(connection, people["jo"]))
        rows = [row for row in answer["items"] if row["id"] == PRESET_SKILL]
        assert len(rows) == 1 and rows[0]["preset"] is False and rows[0]["level"] == "org"


@requires_postgres
async def test_browse_reads_the_environment_a_tool_needs():
    """W5-D15: the row carries the environment the sidecar names, so the
    screen can tick it with the tool and say that it did."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        tool = uuid.uuid4()
        await connection.execute(
            """insert into idx_assets(org, node_path, id, kind, name, tree, sidecar)
               values ($1,$2,$3,'tool','csv-summary','t-t',$4::jsonb)""",
            people["org"], f"{MKT}.jo", tool,
            json.dumps({"id": str(tool), "kind": "tool",
                        "needs": [{"kind": "environment", "name": "python-data"}]}))
        await connection.execute(
            """insert into idx_effective(org, user_id, asset_id, from_path)
               values ($1,$2,$3,$4)""", people["org"], people["jo"], tool, f"{MKT}.jo")
        answer = await routes_console.read_browse(await ctx_for(connection, people["jo"]))
        row = next(one for one in answer["items"] if one["name"] == "csv-summary")
        assert row["needsEnvironment"] == "python-data"


@requires_postgres
async def test_the_store_can_be_turned_off_for_a_person():
    """W5-D15, P10: `visibility.store: false` answers the note in place of the
    list, like boundaries and logs. What they already hold is untouched — the
    Assets screen itself still answers."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            "insert into org_unit_boundaries(org_unit_id,policy) values ($1,$2)",
            people["org"], json.dumps({"visibility": {"store": False}}))
        viewer = await routes_console.read_viewer(await ctx_for(connection, people["jo"]))
        assert viewer["visibility"] == {"boundaries": True, "logs": True, "store": False}
        answer = await routes_console.read_browse(await ctx_for(connection, people["jo"]))
        assert answer["items"] == []
        assert answer["hidden"] == {
            "store": "An organization admin has turned off browsing for more assets."}
        assert (await routes_console.read_assets(
            await ctx_for(connection, people["jo"]))).get("hidden") is None


@requires_postgres
async def test_a_search_hit_opens_the_level_that_holds_the_copy():
    """W5-D15 fix: at *You*, a hit on an organization asset used to link to
    `/console/me/assets/<id>`, which 404s — the asset screen is one node's own
    copies. The href carries the level of `from_path` instead."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        hits = await routes_console.read_search(await ctx_for(connection, people["jo"]), "house")
        asset = next(hit for hit in hits["items"] if hit["kind"] == "asset")
        assert asset["href"] == f"/console/org/assets/{ASSET_ORG}"
        team = await routes_console.read_search(await ctx_for(connection, people["jo"]), "triage")
        assert next(hit for hit in team["items"] if hit["kind"] == "asset")["href"] == \
            f"/console/{MKT}/assets/{ASSET_TEAM}"


@requires_postgres
async def test_routing_matrix_resolves_a_default_per_team():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        matrix = await routes_console.read_routing(
            await ctx_for(connection, people["dana"], scope="org"))
        assert matrix["defaultFor"]["teams"] == {MKT: "anthropic"}
        assert matrix["resolved"][MKT]["value"] == "anthropic"
        assert matrix["resolved"][ENG]["value"] is None


# --- logs, endpoints, people, teams ------------------------------------------


@requires_postgres
async def test_logs_are_categorised_and_spoken_in_plain_words():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        from app.domain.audit import append_event
        await append_event(connection, org_unit_id=people["mkt"], actor_type="user",
                           actor_id=people["dana"], event_class="authoritative",
                           action="grant.create",
                           payload={"group": "marketing", "teams": "Marketing"})
        await append_event(connection, org_unit_id=people["mkt"], actor_type="user",
                           actor_id=people["dana"], event_class="authoritative",
                           action="session.refuse",
                           payload={"provider": "pi", "harness": HARNESS,
                                    "blockers": ["broker.provider_unknown"]})
        ctx = await ctx_for(connection, people["rae"], scope=f"team:{MKT}")
        permission = await routes_console.read_logs(ctx, "permission")
        assert permission["items"][0]["sentence"] == \
            "dana@acme.co granted marketing to Marketing"
        harness = await routes_console.read_logs(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"), "harness")
        assert harness["items"][0]["sentence"].startswith(
            "dana@acme.co could not start Support: ")
        assert "not a harness provider" in harness["items"][0]["sentence"]
        assert harness["items"][0]["team"] == {"path": MKT, "name": "marketing"}
        # A member at team scope reads only the rows about themselves.
        assert await routes_console.read_logs(
            await ctx_for(connection, people["jo"], scope=f"team:{MKT}"),
            "permission") == {"items": [], "next": None, "stale": None}
        # A category holds only its own actions.
        assert await routes_console.read_logs(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"),
            "provider") == {"items": [], "next": None, "stale": None}


@requires_postgres
async def test_endpoints_group_by_host_outcome_and_reason():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        from app.domain.audit import append_event
        for status in (200, 200, "denied"):
            await append_event(connection, org_unit_id=people["mkt"], actor_type="user",
                               actor_id=people["jo"], event_class="authoritative",
                               action="session.endpoint",
                               payload={"host": "api.crm.example", "port": 443, "alias": "crm",
                                        "status": status, "session": str(uuid.uuid4())})
        rows = await routes_console.read_endpoints(
            await ctx_for(connection, people["dana"], scope="org"))
        # W5-D4: one row per (host, outcome, reason), so a host reached twice
        # and refused once is two rows — two different things to do about it.
        by_outcome = {row["outcome"]: row for row in rows["items"]}
        assert by_outcome["reached"]["count"] == 2 and by_outcome["reached"]["refused"] == 0
        assert by_outcome["refused"]["count"] == 1 and by_outcome["refused"]["refused"] == 1
        assert by_outcome["reached"]["sessions"] == 2


@requires_postgres
async def test_people_rows_and_removal_preview():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_people(ctx)
        by_email = {row["email"]: row for row in rows["items"]}
        assert by_email["rae@acme.co"]["role"] == {"scale": "role", "value": "team-admin"}
        assert by_email["dana@acme.co"]["role"]["value"] == "org-admin"
        assert by_email["jo@acme.co"]["role"]["value"] == "member"
        assert [item["label"] for item in by_email["eve@acme.co"]["teams"]["items"]] == ["eng"]
        await connection.execute(
            "update org_unit_members set deactivated_at=now() where auth_user_id=$1",
            people["eve"])
        again = await routes_console.read_people(await ctx_for(connection, people["dana"],
                                                               scope="org"))
        assert {row["email"]: row["state"] for row in again["items"]}["eve@acme.co"] \
            == "deactivated"
        preview = await routes_console.read_removal(
            await ctx_for(connection, people["dana"], scope="org"), people["jo"])
        assert {item["group"] for item in preview["loses"]} == {"org-wide"}
        assert preview["sharedKeysToRotate"][0]["ref"] == "secret://acme/anthropic"
        assert preview["person"]["email"] == "jo@acme.co"


@requires_postgres
async def test_person_row_names_direct_team_and_unit():
    """`teams` is the whole chain, so it cannot say which team a person is
    actually on. A removal needs the direct parent and a visibility change the
    person's own node — both are their own fields, for a person two levels down.
    """
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        backend = await _unit(connection, people["eng"], "team", "backend")
        await _person(connection, backend, "sam")
        rows = await routes_console.read_people(
            await ctx_for(connection, people["dana"], scope="org"))
        sam = next(row for row in rows["items"] if row["email"] == "sam@acme.co")
        assert sam["team"] == f"{ENG}.backend"
        assert sam["unit"] == f"{ENG}.backend.sam"
        assert {item["label"] for item in sam["teams"]["items"]} == {"eng", "backend"}
        # A personal account hangs off the organization, which is then its team.
        await _person(connection, people["org"], "kit")
        again = await routes_console.read_people(
            await ctx_for(connection, people["dana"], scope="org"))
        kit = next(row for row in again["items"] if row["email"] == "kit@acme.co")
        assert kit["team"] == ORG and kit["teams"]["items"] == []


@requires_postgres
async def test_invited_row_names_its_invite():
    """An invited row has no person to name, so withdrawing it needs the
    invite's own id — `DELETE /v1/invites/{id}` takes nothing else."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        invite = await connection.fetchval(
            """insert into org_invites(team_unit_id,email,invited_by)
               values ($1,'new@acme.co',$2) returning id""", people["mkt"], people["dana"])
        rows = await routes_console.read_people(
            await ctx_for(connection, people["dana"], scope="org"))
        by_email = {row["email"]: row for row in rows["items"]}
        assert by_email["new@acme.co"]["state"] == "invited"
        assert by_email["new@acme.co"]["id"] == ""
        assert by_email["new@acme.co"]["invite"] == str(invite)
        assert by_email["jo@acme.co"]["invite"] is None


@requires_postgres
async def test_person_detail_names_who_can_read_their_branch():
    """PRD §18's honesty line has its data from the server."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        detail = await routes_console.read_person(
            await ctx_for(connection, people["dana"], scope="org"), people["jo"])
        assert set(detail["readableBy"]["items"][0]) == {"id", "label", "href"}
        assert {item["label"] for item in detail["readableBy"]["items"]} == {
            "rae@acme.co", "dana@acme.co"}


@requires_postgres
async def test_person_detail_carries_the_persons_own_visibility():
    """04 §15's switch sets this person's visibility, so the detail carries
    theirs — the viewer's own would show an admin their own switch."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        unit = await connection.fetchval(
            "select user_unit_id from org_unit_members where auth_user_id=$1", people["jo"])
        await connection.execute(
            "insert into org_unit_boundaries(org_unit_id,policy) values ($1,$2)",
            unit, json.dumps({"visibility": {"boundaries": False}}))
        dana = await ctx_for(connection, people["dana"], scope="org")
        assert dana.visibility == {"boundaries": True, "logs": True, "store": True}
        detail = await routes_console.read_person(dana, people["jo"])
        assert detail["visibility"] == {"boundaries": False, "logs": True, "store": True}


@requires_postgres
async def test_teams_are_a_tree_with_counts():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        rows = await routes_console.read_teams(
            await ctx_for(connection, people["dana"], scope="org"))
        by_path = {row["path"]: row for row in rows["items"]}
        assert by_path[MKT]["parent"] == ORG and by_path[MKT]["people"] == 3
        assert [item["label"] for item in by_path[MKT]["admins"]["items"]] == ["rae@acme.co"]
        assert by_path[ENG]["people"] == 1


# --- `definitions`, at the one network edge ---------------------------------


class _Definitions(BaseHTTPRequestHandler):
    def do_GET(self):                                        # noqa: N802 (stdlib's name)
        if self.headers.get("Authorization") != f"Bearer {SERVICE_TOKEN}":
            self.send_response(401), self.end_headers()
            return
        if "/internal/tree/" in self.path and self.path.endswith("SKILL.md"):
            body = {"blob": base64.b64encode(b"triage, carefully.").decode()}
        elif "/internal/tree/" in self.path:
            body = {"entries": [{"name": "SKILL.md", "mode": "100644", "kind": "blob",
                                 "oid": "b1"},
                                {"name": "asset.json", "mode": "100644", "kind": "blob",
                                 "oid": "b2"}]}
        elif self.path.startswith("/internal/log"):
            body = {"commits": [{"commit": "c1", "author": {"name": "Rae Lindqvist",
                                                            "email": "rae@acme.co"},
                                 "at": "2026-02-01T10:00:00Z", "message": "tightened triage",
                                 "paths": ["assets/skill/triage/SKILL.md"]}]}
        else:
            body = {"diff": "@@ -1 +1 @@\n-old\n+new\n"}
        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        return


@pytest.fixture
def definitions_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Definitions)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    previous = os.environ.get("DEFINITIONS_URL")
    os.environ["DEFINITIONS_URL"] = f"http://127.0.0.1:{server.server_address[1]}"
    yield
    server.shutdown()
    if previous is None:
        os.environ.pop("DEFINITIONS_URL", None)
    else:
        os.environ["DEFINITIONS_URL"] = previous


@requires_postgres
async def test_file_view_and_last_editor_come_through_api(definitions_server):
    """00 D8: the browser never speaks git; `api` asks `definitions` and parses
    the unified text into `DiffHunk[]` itself."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["jo"])
        view = await routes_console.read_file(ctx, uuid.UUID(HARNESS), ASSET_TEAM)
        assert view["content"]["mine"] == "triage, carefully."
        assert view["diff"][0]["header"].startswith("@@")
        assert [line["kind"] for line in view["diff"][0]["lines"]] == ["del", "add"]
        assert {row["branch"] for row in view["history"]} == {"mine", "team"}
        assert view["row"]["lastEditor"]["name"] == "Rae Lindqvist"

        with pytest.raises(ApiError) as caught:
            await routes_console.read_file(await ctx_for(connection, people["jo"]),
                                           uuid.UUID(HARNESS), "no-such-asset")
        assert caught.value.code == "console.file_not_found"


@requires_postgres
async def test_harness_page_survives_definitions_being_down(monkeypatch):
    """03 D35: a lazily-filled cell degrades; the page is still current."""
    monkeypatch.delenv("DEFINITIONS_URL", raising=False)
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        view = await routes_console.read_harness(await ctx_for(connection, people["jo"]),
                                                 uuid.UUID(HARNESS))
        assert view["files"] and view["files"][0]["lastEditor"] is None


@requires_postgres
async def test_log_diff_is_fetched_for_git_backed_rows(definitions_server):
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        from app.domain.audit import append_event
        git_backed = await append_event(
            connection, org_unit_id=people["mkt"], actor_type="user", actor_id=people["dana"],
            event_class="authoritative", action="asset.promote",
            payload={"kind": "skill", "name": "triage", "team": "Marketing",
                     "ref": MKT_REF, "old": "c-team", "new": "c-team-2"})
        plain = await append_event(
            connection, org_unit_id=people["mkt"], actor_type="user", actor_id=people["dana"],
            event_class="authoritative", action="member.add",
            payload={"person": "jo@acme.co", "team": "Marketing"})
        ctx = await ctx_for(connection, people["dana"], scope="org")
        assert (await routes_console.read_log_diff(ctx, "harness", git_backed["id"]))[0]["lines"]
        assert await routes_console.read_log_diff(ctx, "people", plain["id"]) == []


# --- the contract ------------------------------------------------------------


def test_openapi_names_match_00():
    """03 §15: every endpoint in 00 §4.10 exists and every response model is
    named for its 00 §4 type, so the generated client carries the plan's names."""
    from app.main import create_app
    spec = create_app(pool=object()).openapi()
    paths = set(spec["paths"])
    for path in (
        "/v1/console/me", "/v1/console/harnesses", "/v1/console/harnesses/{harness_id}",
        "/v1/console/harnesses/{harness_id}/files/{asset_id}",
        "/v1/console/harnesses/{harness_id}/history",
        "/v1/console/harnesses/{harness_id}/requests", "/v1/console/requests/{request_id}",
        "/v1/console/sessions", "/v1/console/sessions/{session_id}", "/v1/console/groups",
        "/v1/console/groups/{name}", "/v1/console/grants", "/v1/console/boundaries",
        "/v1/console/providers/harness", "/v1/console/providers/model", "/v1/console/routing",
        "/v1/console/vaults", "/v1/console/vaults/{vault_id}/secrets", "/v1/console/assets",
        "/v1/console/assets/{asset_id}", "/v1/console/logs/{category}",
        "/v1/console/logs/{category}/{log_id}/diff", "/v1/console/endpoints",
        "/v1/console/people", "/v1/console/people/{person_id}",
        "/v1/console/people/{person_id}/removal", "/v1/console/teams", "/v1/console/edges",
        "/v1/console/how", "/v1/console/search",
    ):
        assert path in paths, path
    schemas = set(spec["components"]["schemas"])
    assert {
        "Viewer", "HarnessCard", "HarnessView", "HarnessFileRow", "FileView", "RequestView",
        "SessionRow", "SessionView", "ScaleTag", "Related", "BoundaryRow", "EdgeWalk", "LogRow",
        "EndpointRow", "PersonRow", "TeamRow", "RemovalPreview", "DiffHunk", "Fact", "GroupRow",
        "GrantRow", "HarnessProviderRow", "ModelProviderRow", "RoutingMatrix", "VaultRow",
        "SecretRow", "OrgAssetRow",
    } <= schemas


def test_error_envelope_carries_remedy():
    """03 D30: one component renders an API error and a `Blocker`."""
    from app.errors import api_error_handler
    error = console.fail("console.harness_not_found")
    body = json.loads(api_error_handler(None, error).body)
    assert body["code"] == "console.harness_not_found"
    assert body["remedy"] == "`harness switch` lists yours."
    assert json.loads(api_error_handler(None, ApiError(404, "x", "y")).body).get("remedy") is None


# --- wave 3: the read gaps the screens found --------------------------------


async def _jo_overrides_triage(connection, people):
    """Jo pushes her own copy of Marketing's `triage`: her ref wins the id and
    `idx_effective.shadows_path` records the copy it stands on."""
    jo, jo_path = people["jo"], f"{MKT}.jo"
    await _write_index(connection, people["org"], f"refs/heads/users/{jo}", f"c-{jo}", {
        "idx_assets": [{"node_path": jo_path, "id": ASSET_TEAM, "kind": "skill", "name": "triage",
                        "tree": "t-jo", "sidecar": _sidecar(ASSET_TEAM, "skill", "triage",
                                                            ["crm"])}],
        "idx_effective": [
            {"user_id": str(jo), "asset_id": ASSET_ORG, "from_path": ORG, "shadows_path": None},
            {"user_id": str(jo), "asset_id": ASSET_TEAM, "from_path": jo_path,
             "shadows_path": MKT}],
    })


@requires_postgres
async def test_team_version_falls_back_to_shadows():
    """03 §4.2.1: the team's copy of an override is the one it shadows. Without
    it Differences can only ever say *yours only*."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await _jo_overrides_triage(connection, people)
        ctx = await ctx_for(connection, people["jo"])
        row = await console.harness_of(ctx, uuid.UUID(HARNESS))
        mine = {r["assetId"]: r for r in
                await console.file_rows(ctx, row["def"], "mine", with_editor=False)}
        team = {r["assetId"]: r for r in
                await console.file_rows(ctx, row["def"], "team", with_editor=False)}
        assert mine[ASSET_TEAM]["owner"] == "you" and mine[ASSET_TEAM]["tree"] == "t-jo"
        # The team still holds triage: the row is Marketing's copy, not absent.
        assert set(team) == {ASSET_ORG, ASSET_TEAM}
        assert team[ASSET_TEAM]["owner"] == "team" and team[ASSET_TEAM]["tree"] == "t-team"
        differs = console.differs({k: r["tree"] for k, r in mine.items()},
                                  {k: r["tree"] for k, r in team.items()}, None)
        assert differs == {ASSET_TEAM: "both"}


@requires_postgres
async def test_assigned_but_unanswered_renders():
    """Engine C18: an assigned id nothing answers is a row with no owner and
    the sentence — never a shorter list, never a 404."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ghost = "44444444-4444-4444-8444-444444444444"
        await connection.execute(
            """update idx_harnesses set def = jsonb_set(def, '{assets}', $2::jsonb)
                where org=$1""", people["org"], json.dumps([ASSET_ORG, ASSET_TEAM, ghost]))
        view = await routes_console.read_harness(await ctx_for(connection, people["jo"]),
                                                 uuid.UUID(HARNESS))
        row = next(file for file in view["files"] if file["assetId"] == ghost)
        assert row["owner"] is None and row["lastEditor"] is None
        assert row["note"] == ("This id is assigned but nothing answers it on your chain.")
        # P11: the count is what the viewer would load, so the ghost is listed
        # and not counted.
        assert view["header"]["fileCount"] == 2 and len(view["files"]) == 3

        page = await routes_console.read_file(await ctx_for(connection, people["jo"]),
                                              uuid.UUID(HARNESS), ghost)
        assert page["content"] == {"mine": None, "team": None} and page["history"] == []
        assert page["row"]["note"] and page["row"]["owner"] is None


@requires_postgres
async def test_file_view_follows_the_selected_version(definitions_server):
    """04 §6: `?version` is the compare control, so `content.mine` is the
    selected version's copy."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await _jo_overrides_triage(connection, people)
        ctx = await ctx_for(connection, people["rae"])
        view = await routes_console.read_file(ctx, uuid.UUID(HARNESS), ASSET_TEAM,
                                              version=f"member:{people['jo']}")
        assert view["row"]["owner"] in ("you", "member:jo")
        assert view["content"]["team"] is not None
        team_only = await routes_console.read_file(
            await ctx_for(connection, people["jo"]), uuid.UUID(HARNESS), ASSET_TEAM,
            version="team")
        assert team_only["content"]["mine"] == team_only["content"]["team"]


@requires_postgres
async def test_slot_need_is_preserved():
    """The record is keyed by alias because the broker mints credentials only;
    the posted report carries the real needs, so a login slot stays a login."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        report = {"passing": True, "slots": [
            {"need": {"kind": "credential", "alias": "crm"}, "state": "satisfied"},
            {"need": {"kind": "login", "tool": "gh"}, "state": "satisfied",
             "evidence": "verified", "resolvedFrom": {"source": "local", "tool": "gh"}},
            {"need": {"kind": "asset", "id": ASSET_ORG}, "state": "unsatisfied"}]}
        session_id = await _session(connection, people, people["jo"], commits={},
                                    preflight=report)
        view = await routes_console.read_session(await ctx_for(connection, people["jo"]),
                                                 session_id)
        needs = {console._need_key(slot["need"]): slot["need"]["kind"] for slot in view["slots"]}
        assert needs == {"crm": "credential", "gh": "login", ASSET_ORG: "asset"}
        # The record still decides provenance for the alias the broker filled.
        crm = next(slot for slot in view["slots"] if slot["need"].get("alias") == "crm")
        assert crm["evidence"] == "verified" and crm["resolvedFrom"]["grant"] == "g-marketing"


@requires_postgres
async def test_session_hosts_and_deny_come_from_the_plan():
    """00 §4.5's `SpawnPlan`, posted with the report (03 §5.10)."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        plan = {"hosts": ["api.crm.example"], "deny": ["*.pastebin.com"], "connectors": {}}
        session_id = await _session(connection, people, people["jo"], commits={},
                                    preflight={"passing": True, "slots": [], "plan": plan})
        view = await routes_console.read_session(await ctx_for(connection, people["jo"]),
                                                 session_id)
        assert view["hosts"] == ["api.crm.example"] and view["deny"] == ["*.pastebin.com"]
        # A session from a CLI that posted no plan says nothing rather than *any*.
        bare = await _session(connection, people, people["jo"], commits={})
        assert (await routes_console.read_session(
            await ctx_for(connection, people["jo"]), bare))["hosts"] is None


@requires_postgres
async def test_closed_at_is_real():
    """0036 added the column `broker.close` sets; the row must carry it."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        session_id = await _session(connection, people, people["jo"], commits={},
                                    status="closed")
        await connection.execute(
            "update harness_sessions set closed_at = now() where id=$1", session_id)
        rows = await routes_console.read_sessions(await ctx_for(connection, people["jo"]))
        assert rows["items"][0]["closedAt"] is not None
        view = await routes_console.read_session(await ctx_for(connection, people["jo"]),
                                                 session_id)
        assert view["closedAt"] == rows["items"][0]["closedAt"]


@requires_postgres
async def test_history_from_definitions_log(definitions_server):
    """04 §5's History view had no source. It is `definitions:/internal/log`
    over the version's composition, filtered to this harness's own files."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        page = await routes_console.read_harness_history(
            await ctx_for(connection, people["jo"]), uuid.UUID(HARNESS))
        assert len(page["items"]) == 1                      # one commit, not once per ref
        row = page["items"][0]
        assert row["message"] == "tightened triage" and row["who"] == "Rae Lindqvist"
        assert row["paths"] == ["assets/skill/triage/SKILL.md"]
        assert row["branch"] in ("org", "team", "you")
        assert row["commit"] == "c1"


@requires_postgres
async def test_nulls_with_a_source_get_it(definitions_server):
    """03 §4.5: a grant's `at` and a boundary's `when` are the commit's, read
    once per policy file per request."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        grants = await routes_console.read_grants(ctx)
        row = next(item for item in grants["items"] if item["id"] == "g-marketing")
        assert row["at"] == "2026-02-01T10:00:00Z"
        assert row["by"] == "dana@acme.co"                  # the file's own author wins
        boundaries = await routes_console.read_boundaries(ctx)
        assert boundaries["items"][0]["when"] == "2026-02-01T10:00:00Z"
        assert boundaries["items"][0]["setBy"]["name"] == "acme"


@requires_postgres
async def test_related_hrefs_follow_d2():
    """00 D2: every server-built link is `/console/<scope>/…` with scope one
    segment — `org`, `me`, or the dotted team path. Never `/console/team/…`."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        source = (Path(console.__file__)).read_text()
        assert '"/console/team' not in source and "f\"/console/team" not in source
        for scope, segment in ((None, "me"), (f"team:{MKT}", MKT)):
            ctx = await ctx_for(connection, people["rae"], scope=scope)
            groups = await routes_console.read_groups(ctx)
            links = [item["href"] for row in groups["items"]
                     for item in row["harnesses"]["items"] + row["narrowed"]["items"]]
            # A group's entries are `policy/groups.json` verbatim and carry no
            # link, so the vault rows are what point back at them here.
            vaults = await routes_console.read_vaults(ctx)
            links += [item["href"] for row in vaults["items"] for item in row["groups"]["items"]]
            assert links and all(link.startswith(f"/console/{segment}/") for link in links), links
            # A team is its own scope, so its link is the segment itself.
            teams = [item["href"] for row in groups["items"] for item in row["teams"]["items"]]
            assert all(link == f"/console/{MKT}" for link in teams), teams


@requires_postgres
async def test_node_label_only_on_paths():
    """A dotted path renders as its last segment; an upstream renders as its
    host and a harness as its name, because neither is a path."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        walk = await routes_console.read_edges(ctx, "group", "marketing")
        labels = {item["id"]: item["label"] for item in walk["restsOn"] + walk["restedOnBy"]}
        assert labels["https://api.crm.example"] == "api.crm.example"
        assert labels[MKT] == "marketing"
        assert labels[CRM] == "secret://acme/crm"
        harness = await routes_console.read_edges(ctx, "asset", ASSET_TEAM)
        assert harness["restedOnBy"][0]["label"] == "Support"
        assert (await routes_console.read_edges(ctx, "harness", HARNESS))["from"]["label"] \
            == "Support"


@requires_postgres
async def test_endpoint_row_names_sessions_and_log():
    """PRD §19's join: the sessions behind the count and the row that explains
    where they came from."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        from app.domain.audit import append_event
        session_id = await _session(connection, people, people["jo"], commits={})
        opened = await append_event(
            connection, org_unit_id=people["mkt"], actor_type="user", actor_id=people["jo"],
            event_class="authoritative", action="session.open",
            payload={"provider": "pi", "harness": HARNESS, "model": ["anthropic", "x"]})
        for status in (200, "denied"):
            await append_event(
                connection, org_unit_id=people["mkt"], actor_type="user", actor_id=people["jo"],
                event_class="authoritative", action="session.endpoint",
                payload={"host": "api.crm.example", "port": 443, "alias": "crm",
                         "status": status, "session": str(session_id)})
        rows = await routes_console.read_endpoints(
            await ctx_for(connection, people["dana"], scope="org"))
        row = rows["items"][0]
        assert row["sessionIds"] == [str(session_id)] and row["sessions"] == 1
        assert row["logId"] == str(opened["id"])
        assert [item["label"] for item in row["harnesses"]["items"]] == ["Support"]


@requires_postgres
async def test_routing_keyed_by_team_path():
    """03 §4.6: the matrix is a row per team, and a default set at the
    organization is every team's default until something nearer says otherwise."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        files = _policy_files()
        files["routing.json"] = {
            "defaultFor": {"teams": {ORG: "anthropic"}, "harnesses": {}, "providers": {}},
            "approvedFor": {"teams": {ORG: ["anthropic"]}, "harnesses": {}, "providers": {}}}
        await _write_index(connection, people["org"], ORG_REF, "c-org", {
            "idx_policy": [{"node_path": ORG, "file": name, "body": body}
                           for name, body in files.items()]})
        matrix = await routes_console.read_routing(
            await ctx_for(connection, people["dana"], scope="org"))
        assert set(matrix["resolved"]) == {MKT, ENG}
        assert {key: fact["value"] for key, fact in matrix["resolved"].items()} == {
            MKT: "anthropic", ENG: "anthropic"}
        assert all(fact["provenance"] == "derived" for fact in matrix["resolved"].values())
        # And the harness header resolves the same way, or a personal account —
        # whose only routing key can be the organization — would read *failing*
        # on every page.
        view = await routes_console.read_harness(await ctx_for(connection, people["jo"]),
                                                 uuid.UUID(HARNESS))
        assert view["header"]["modelProvider"]["value"] == "anthropic"


@requires_postgres
async def test_people_and_teams_carry_names_and_ids():
    """A person's name is the address's local part, and a team row carries the
    `org_units` id the write routes take (00 §4.11)."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["dana"], scope="org")
        rows = await routes_console.read_people(ctx)
        by_email = {row["email"]: row for row in rows["items"]}
        assert by_email["jo@acme.co"]["name"] == "jo"
        teams = await routes_console.read_teams(ctx)
        by_path = {row["path"]: row for row in teams["items"]}
        assert by_path[MKT]["id"] == str(people["mkt"])
        viewer = await routes_console.read_viewer(await ctx_for(connection, people["rae"]))
        assert viewer["teams"][0]["id"] == str(people["mkt"])


# --- the personal edition (prd-v2 §12.1, engine D30f) ------------------------


@requires_postgres
async def test_personal_chain_is_org_and_user():
    """0038: a person may sit directly under the organization, and their chain
    is the two nodes prd-v2 §12.1 describes."""
    async with scratch_db(_all_migrations()) as connection:
        from app.domain import broker
        org = await _unit(connection, None, "org", "solo")
        # Raw SQL, so the trigger is what is being proven (0027's lesson).
        unit = await _unit(connection, org, "user", "sam")
        person = uuid.uuid4()
        await connection.execute("insert into auth.users(id,email) values ($1,$2)",
                                 person, "sam@solo.co")
        await connection.execute(
            "insert into org_unit_members(auth_user_id,user_unit_id) values ($1,$2)",
            person, unit)
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            person, org)
        chain = await broker.chain_for(ConnectionPool(connection), unit, person, org)
        assert [(node["kind"], node["path"]) for node in chain] == [
            ("org", "solo"), ("user", "solo.sam")]
        assert chain[0]["ref"] == "refs/heads/org"
        assert chain[1]["ref"] == f"refs/heads/users/{person}"
        # And the console reads it as the personal edition: no teams, no scope
        # but their own, and the org node is the "team" side of every compare.
        ctx = await console.context(ConnectionPool(connection),
                                    Principal(person, "sam@solo.co"))
        assert ctx.edition == "personal" and ctx.teams == []
        assert (await console.version_node(ctx, "team"))["path"] == "solo"
        viewer = await routes_console.read_viewer(ctx)
        assert viewer["edition"] == "personal" and viewer["teams"] == []
        assert viewer["role"] == {"level": "org-admin", "at": "solo"}


@requires_postgres
async def test_personal_assets_at_you_include_the_organizations_own():
    """07 §1 rule 3 and §3: on a personal account the organization **is** the
    person, so *You* lists the copies the seed wrote on the org branch — the
    authoring skill, the brief — beside the person's own, each row saying which
    node it is on. Without this the only assets a new personal account had sat
    on a branch no screen could reach: it has no organization scope."""
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "solo")
        unit = await _unit(connection, org, "user", "sam")
        person = uuid.uuid4()
        await connection.execute("insert into auth.users(id,email) values ($1,$2)",
                                 person, "sam@solo.co")
        await connection.execute(
            "insert into org_unit_members(auth_user_id,user_unit_id) values ($1,$2)",
            person, unit)
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'owner')",
            person, org)
        for node, kind, name in (("solo", "skill", "harness-authoring"),
                                 ("solo.sam", "prompt", "stand-up")):
            asset_id = uuid.uuid4()
            await connection.execute(
                """insert into idx_assets(org, node_path, id, kind, name, tree, sidecar)
                   values ($1,$2,$3,$4,$5,'t',$6::jsonb)""",
                org, node, asset_id, kind, name,
                json.dumps(_sidecar(str(asset_id), kind, name)))

        answer = await routes_console.read_assets(await ctx_for(connection, person))
        assert [(row["name"], row["level"]) for row in answer["items"]] == [
            ("stand-up", "me"), ("harness-authoring", "org")]
        # And an enterprise account is unchanged: one node, its own copies.
        assert console.scope_nodes(await ctx_for(connection, person)) == ["solo", "solo.sam"]


@requires_postgres
async def test_enterprise_assets_at_you_are_only_your_own():
    """The other half: at *You* on an enterprise account the organization's
    copies belong to the organization's screen, not to the person's."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        ctx = await ctx_for(connection, people["jo"])
        assert console.scope_nodes(ctx) == [f"{MKT}.jo"]
        assert (await routes_console.read_assets(ctx))["items"] == []


# --- the generated contract --------------------------------------------------


def test_generated_types_are_narrow():
    """03 §8.10: the browser is generated from this document (00 D3), so every
    shape 00 §4 defines is a named schema and not an open object. Engine types
    (`HarnessDef`, `Slot`, `PreflightReport`, `Routing`) stay open by rule — 00
    §4's preamble imports them by name rather than redeclaring them."""
    from app.main import create_app
    spec = create_app(pool=object()).openapi()
    schemas = spec["components"]["schemas"]

    def field(model: str, name: str) -> dict:
        return schemas[model]["properties"][name]

    def ref_of(prop: dict) -> str | None:
        target = prop.get("$ref") or next(
            (item.get("$ref") for item in prop.get("anyOf", []) if item.get("$ref")), None)
        return target.rsplit("/", 1)[-1] if target else None

    for model, name, expected in (
        ("HarnessView", "header", "HarnessHeader"),
        ("HarnessView", "team", "TeamRef"),
        ("HarnessHeader", "preflight", "PreflightFact"),
        ("HarnessView", "reach", "EffectiveReach"),
        ("HarnessFileRow", "lastEditor", "Editor"),
        ("FileView", "content", "FileContent"),
        ("SessionRow", "person", "PersonRef"),
        ("SessionRow", "endpoints", "EndpointCounts"),
        ("BoundaryRow", "setBy", "BoundarySetBy"),
        ("LogRow", "actor", "PersonRef"),
        ("EndpointRow", "harnesses", "Related"),
        ("PersonRow", "role", "ScaleTag"),
        ("GroupRow", "teams", "Related"),
        ("EdgeWalk", "from", "EdgeNode"),
        ("RemovalPreview", "person", "PersonRow"),
        ("Viewer", "role", "ViewerRole"),
        ("Viewer", "visibility", "Visibility"),
    ):
        assert ref_of(field(model, name)) == expected, f"{model}.{name}"
    # A list of a console shape is a list of that schema, never of `object`.
    for model, name, expected in (
        ("Related", "items", "RelatedItem"),
        ("HarnessView", "files", "HarnessFileRow"),
        ("HarnessView", "versions", "VersionOption"),
        ("DiffHunk", "lines", "DiffLine"),
        ("FileView", "history", "HistoryRow"),
        ("EdgeWalk", "restsOn", "EdgeLink"),
        ("Viewer", "teams", "ViewerTeam"),
        ("RequestView", "files", "RequestFile"),
    ):
        assert ref_of(field(model, name)["items"]) == expected, f"{model}.{name}[]"
    # `Fact<T>`'s value is the value, not an object, wherever 00 §4 names one.
    assert field("PreflightFact", "value")["enum"] == ["passing", "failing"]
    assert ref_of(field("RoutingMatrix", "resolved")["additionalProperties"]) == "TextFact"
    # The engine's own types are the exception, and deliberately open.
    assert "$ref" not in json.dumps(field("SessionView", "slots"))


@requires_postgres
async def test_index_truncate_removes_one_refs_rows():
    """02 §8.3's reindex needs a form that takes a ref's rows *out*: the write
    form only ever replaces what the new push holds."""
    async with scratch_db(_all_migrations()) as connection:
        from app.api import routes_internal
        people = await world(connection)
        assert await connection.fetchval(
            "select count(*) from idx_assets where org=$1 and node_path=$2",
            people["org"], MKT) == 1
        await routes_internal.write_index(
            routes_internal.IndexWrite(org=people["org"], ref=MKT_REF, truncate=True),
            _Request(ConnectionPool(connection)), f"Bearer {SERVICE_TOKEN}")
        for table, column, value in (("idx_assets", "node_path", MKT),
                                     ("idx_harnesses", "node_path", MKT),
                                     ("idx_policy", "node_path", MKT),
                                     ("idx_edges", "ref", MKT_REF),
                                     ("idx_refs", "ref", MKT_REF)):
            assert await connection.fetchval(
                f"select count(*) from {table} where org=$1 and {column}=$2",
                people["org"], value) == 0, table
        # The node tree belongs to no one ref, and the organization's rows stay.
        assert await connection.fetchval(
            "select count(*) from idx_nodes where org=$1", people["org"]) == 7
        assert await connection.fetchval(
            "select count(*) from idx_policy where org=$1 and node_path=$2",
            people["org"], ORG) == 9
        # A user ref takes that person's composition with it.
        await routes_internal.write_index(
            routes_internal.IndexWrite(org=people["org"],
                                       ref=f"refs/heads/users/{people['jo']}", truncate=True),
            _Request(ConnectionPool(connection)), f"Bearer {SERVICE_TOKEN}")
        assert await connection.fetchval(
            "select count(*) from idx_effective where org=$1 and user_id=$2",
            people["org"], people["jo"]) == 0


# --- reach (W5-D1, W5-D4, W5-D5) -------------------------------------------


@requires_postgres
async def test_reach_view_walks_the_chain_and_offers_the_starter_list():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        at_org = await routes_console.read_reach(
            await ctx_for(connection, people["dana"], scope="org"))
        # The organization is the top of the walk: its file *is* the start.
        assert at_org["effective"] == {"mode": "on", "hosts": ["competitor.example"],
                                       "setBy": ORG}
        assert [step["node"] for step in at_org["chain"]] == [ORG]
        assert "pypi.org" in at_org["suggested"]
        assert at_org["canEdit"] is True

        at_team = await routes_console.read_reach(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"))
        # D131: `on` → `allow` narrows, and `setBy` is the team a person asks.
        assert at_team["effective"] == {"mode": "allow", "hosts": ["pypi.org", "crates.io"],
                                        "setBy": MKT}
        assert [(step["node"], step["mode"]) for step in at_team["chain"]] == [
            (ORG, "on"), (MKT, "allow")]
        # A member reads it — knowing how far your own sessions reach is not a
        # privilege — but cannot write it.
        as_member = await routes_console.read_reach(
            await ctx_for(connection, people["jo"], scope=f"team:{MKT}"))
        assert as_member["effective"]["mode"] == "allow" and as_member["canEdit"] is False


@requires_postgres
async def test_a_team_that_widens_reach_is_ignored_and_the_parent_stands():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            """update idx_policy set body=$1 where org=$2 and node_path=$3 and file='reach.json'""",
            json.dumps({"mode": "on", "hosts": []}), people["org"], MKT)
        view = await routes_console.read_reach(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"))
        # The console reads the same rule `compose()` does, so the two never
        # disagree about what a session will actually get.
        assert view["effective"] == {"mode": "on", "hosts": ["competitor.example"], "setBy": ORG}


@requires_postgres
async def test_a_refused_endpoint_row_says_why_who_and_whether_you_may_allow_it():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        from app.domain.audit import append_event
        # On the person's own node, so the same rows answer an org admin at
        # `org` and the person themselves at `me` (03 §4's `own_records_only`).
        unit = await connection.fetchval(
            "select user_unit_id from org_unit_members where auth_user_id=$1", people["jo"])
        for host, status, reason, set_by in (
            ("pypi.org", 200, None, None),
            ("registry.npmjs.org", "no-route", "reach.not-listed", MKT),
            ("registry.npmjs.org", "no-route", "reach.not-listed", MKT),
            ("api.anthropic.com", "stripped", "stripped:web_search_20250305", ORG),
        ):
            await append_event(connection, org_unit_id=unit, actor_type="user",
                               actor_id=people["jo"], event_class="authoritative",
                               action="session.endpoint",
                               payload={"host": host, "port": 443, "status": status,
                                        **({"reason": reason} if reason else {}),
                                        **({"setBy": set_by} if set_by else {}),
                                        "session": str(uuid.uuid4())})
        rows = await routes_console.read_endpoints(
            await ctx_for(connection, people["dana"], scope="org"))
        by_host = {row["host"]: row for row in rows["items"]}
        refused = by_host["registry.npmjs.org"]
        assert refused["outcome"] == "refused" and refused["count"] == 2
        assert refused["reason"] == "reach.not-listed" and refused["setBy"] == MKT
        # W5-D4: the org admin administers marketing, so **Allow** is offered,
        # and it says the `?scope=` the write takes.
        assert refused["allow"] == {"can": True, "scope": f"team:{MKT}", "why": None}
        assert by_host["api.anthropic.com"]["outcome"] == "stripped"
        assert by_host["api.anthropic.com"]["allow"] is None
        assert by_host["pypi.org"]["outcome"] == "reached"

        # A member of marketing administers nothing, so the row says who does.
        mine = await routes_console.read_endpoints(
            await ctx_for(connection, people["jo"]))
        theirs = {row["host"]: row for row in mine["items"]}["registry.npmjs.org"]
        assert theirs["allow"] == {"can": False,
                                   "why": "marketing's admins decide what it can reach."}


@requires_postgres
async def test_allow_goes_once_the_host_is_on_the_list_it_was_refused_against():
    """W5 cleanup: the refusal is a session that started before the list
    changed. Offering **Allow** again would only earn `409 reach.host_present`,
    so the row says the host is already allowed instead."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        from app.domain.audit import append_event
        # marketing is `allow` with pypi.org and crates.io; the org is `on`
        # with competitor.example on its deny-list.
        for host, set_by, unit in (("pypi.org", MKT, people["mkt"]),
                                   ("search.example", ORG, people["org"])):
            await append_event(connection, org_unit_id=unit, actor_type="user",
                               actor_id=people["jo"], event_class="authoritative",
                               action="session.endpoint",
                               payload={"host": host, "port": 443, "status": "no-route",
                                        "reason": "reach.not-listed", "setBy": set_by,
                                        "session": str(uuid.uuid4())})
        rows = await routes_console.read_endpoints(
            await ctx_for(connection, people["dana"], scope="org"))
        by_host = {row["host"]: row for row in rows["items"]}
        already = {"can": False, "why": "Already allowed; the next session can reach it."}
        # On marketing's allow-list already.
        assert by_host["pypi.org"]["allow"] == already
        # Off the organization's deny-list already — the same wish, the other mode.
        assert by_host["search.example"]["allow"] == already
        # A host that is on neither still offers the button.
        await append_event(connection, org_unit_id=people["org"], actor_type="user",
                           actor_id=people["jo"], event_class="authoritative",
                           action="session.endpoint",
                           payload={"host": "competitor.example", "port": 443,
                                    "status": "no-route", "reason": "reach.denied",
                                    "setBy": ORG, "session": str(uuid.uuid4())})
        rows = await routes_console.read_endpoints(
            await ctx_for(connection, people["dana"], scope="org"))
        denied = {row["host"]: row for row in rows["items"]}["competitor.example"]
        assert denied["allow"] == {"can": True, "scope": "org", "why": None}


@requires_postgres
async def test_a_row_from_before_set_by_offers_the_org_to_an_org_admin():
    """W5 cleanup: rows written before `setBy` rode on the event name no node.
    The organization is the only node that could have refused them then, so an
    org admin is offered the organization's list and nobody else is."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        from app.domain.audit import append_event
        await append_event(connection, org_unit_id=people["mkt"], actor_type="user",
                           actor_id=people["jo"], event_class="authoritative",
                           action="session.endpoint",
                           payload={"host": "competitor.example", "port": 443,
                                    "status": "no-route",
                                    "session": str(uuid.uuid4())})
        rows = await routes_console.read_endpoints(
            await ctx_for(connection, people["dana"], scope="org"))
        row = rows["items"][0]
        assert row["setBy"] is None
        assert row["allow"] == {"can": True, "scope": "org", "why": None}

        # A team admin is not an org admin, so the row only says whose it is.
        theirs = await routes_console.read_endpoints(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"))
        assert theirs["items"][0]["allow"] == {
            "can": False, "why": "acme's admins decide what it can reach."}


@requires_postgres
async def test_allow_is_disabled_when_reach_is_off_at_the_node_that_refused():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        await connection.execute(
            "update idx_policy set body=$1 where org=$2 and node_path=$3 and file='reach.json'",
            json.dumps({"mode": "off", "hosts": []}), people["org"], ORG)
        from app.domain.audit import append_event
        await append_event(connection, org_unit_id=people["mkt"], actor_type="user",
                           actor_id=people["jo"], event_class="authoritative",
                           action="session.endpoint",
                           payload={"host": "registry.npmjs.org", "port": 443,
                                    "status": "no-route", "reason": "reach.off", "setBy": ORG,
                                    "session": str(uuid.uuid4())})
        rows = await routes_console.read_endpoints(
            await ctx_for(connection, people["dana"], scope="org"))
        assert rows["items"][0]["allow"] == {
            "can": False,
            "why": "Reach is off for acme; turn it on under Boundaries → Reach."}


class _Request:
    """`get_pool(request)` is the only thing the route asks of it."""

    def __init__(self, pool):
        self.app = type("App", (), {"state": type("State", (), {"pool": pool})()})()


# --- W5-D14: the workspace on the card and on the session --------------------


@requires_postgres
async def test_cards_carry_the_viewers_own_last_workspace():
    """W5-D14: the card says where *you* last ran this harness and on which
    machine. Only your own sessions, only the most recent one that recorded a
    folder, and nothing at all under `?as`."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        older = await _session(connection, people, people["jo"], commits={},
                               workspace="/Users/jo/projects/old", hostname="jo-mbp")
        newer = await _session(connection, people, people["jo"], commits={},
                               workspace="/Users/jo/projects/newsletter", hostname="jo-mbp")
        # `now()` is the transaction's clock, so the order is set by hand.
        await connection.execute(
            "update harness_sessions set created_at = now() - interval '1 day' where id=$1", older)
        await connection.execute(
            "update harness_sessions set created_at = now() where id=$1", newer)
        # Rae ran the same harness somewhere else; it is not jo's card's answer.
        await _session(connection, people, people["rae"], commits={},
                       workspace="/Users/rae/work", hostname="rae-mbp")

        card = next(card for card in await console.cards(await ctx_for(connection, people["jo"]))
                    if card["id"] == HARNESS)
        assert card["lastWorkspace"] == "/Users/jo/projects/newsletter"
        assert card["lastHost"] == "jo-mbp"

        # The same card from Rae's seat answers with Rae's own folder, and
        # never with Jo's.
        rae = next(card for card in await console.cards(await ctx_for(connection, people["rae"]))
                   if card["id"] == HARNESS)
        assert rae["lastWorkspace"] == "/Users/rae/work" and rae["lastHost"] == "rae-mbp"

        # `?as`: Rae reads Jo's console and gets Jo's harnesses, never Jo's paths.
        impersonated = next(
            card for card in await console.cards(
                await ctx_for(connection, people["rae"], as_user=people["jo"]))
            if card["id"] == HARNESS)
        assert impersonated["lastWorkspace"] is None and impersonated["lastHost"] is None


@requires_postgres
async def test_session_view_shows_the_workspace_to_the_owner_only():
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        session_id = await _session(connection, people, people["jo"], commits={},
                                    workspace="/Users/jo/projects/newsletter", hostname="jo-mbp")
        mine = await routes_console.read_session(await ctx_for(connection, people["jo"]),
                                                 session_id)
        assert mine["workspace"] == "/Users/jo/projects/newsletter"
        assert mine["host"] == "jo-mbp"
        # Rae administers Marketing and may read the session; the path is still
        # not hers to read, as an admin or under `?as`.
        theirs = await routes_console.read_session(
            await ctx_for(connection, people["rae"], scope=f"team:{MKT}"), session_id)
        assert theirs["workspace"] is None and theirs["host"] is None
        impersonated = await routes_console.read_session(
            await ctx_for(connection, people["rae"], as_user=people["jo"]), session_id)
        assert impersonated["workspace"] is None and impersonated["host"] is None


def test_allow_is_not_offered_where_a_list_cannot_help():
    """A refusal reach did not make, or a private address, has no Allow."""
    from types import SimpleNamespace

    from app.domain import console as c
    ctx = SimpleNamespace(org_path="acme", role={"level": "org-admin", "at": "acme"})
    reach = {"acme": {"mode": "allow", "hosts": ["pypi.org"]}}
    for host, reason in (("127.0.0.1", "reach.not-listed"), ("10.0.0.5", None),
                         ("localhost", None), ("github.com", "bad-secret"),
                         ("github.com", "port")):
        answer = c._allow_action(ctx, host, "refused", "acme", reach, reason)
        assert answer["allow"]["can"] is False, (host, reason)
    allowed = c._allow_action(ctx, "github.com", "refused", "acme", reach, "reach.not-listed")
    assert allowed["allow"]["can"] is True


@requires_postgres
async def test_an_org_admin_sees_every_team_a_member_only_their_own():
    """The switcher's teams: an organization admin administers every team —
    including one just created from a personal account, which sits on no
    chain — so they list them all; a member lists the chain's."""
    async with scratch_db(_all_migrations()) as connection:
        people = await world(connection)
        admin = await routes_console.read_viewer(await ctx_for(connection, people["rae"]))
        member = await routes_console.read_viewer(await ctx_for(connection, people["jo"]))
        admin_paths = [team["path"] for team in admin["teams"]]
        assert admin_paths == sorted(admin_paths)
        assert {team["path"] for team in member["teams"]} <= set(admin_paths)
        assert all(team["admin"] for team in admin["teams"])
