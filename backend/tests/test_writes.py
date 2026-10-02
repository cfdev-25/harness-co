"""The writes of console 00 §4.11, against a real Postgres and a fake
`definitions` (10 rule 17's one permitted mock, at the network edge).

Two things every test here is really asserting:

* **one commit and one event** — the `CommitRequest` bodies are checked field
  for field against engine 02 §5.3, and the audit chain is counted, because
  00 D9 exists to stop a write being two of either;
* **the refusal names who decides** — every 403 carries a sentence from 04's
  *Verbs by role* tables (P13, 03 §8.4).

The route functions are called in process for the reason `test_resolve.py`
gives: a real HTTP client needs a second event loop, which the scratch
connection would not survive. `test_unknown_route_returns_envelope` is the
exception — an unrouted request never reaches a route function, so it needs
the app.
"""

import base64
import json
import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi.testclient import TestClient
from test_resolve import (  # type: ignore[import-not-found]
    _all_migrations,
    _request,
    requires_postgres,
    scratch_db,
)

from app.api import routes_internal, routes_requests, routes_writes
from app.domain import audit, broker, console_index, definitions_client
from app.errors import ApiError
from app.identity import Principal
from app.main import create_app

SERVICE_TOKEN = "service-token-for-tests"
DEFINITIONS_URL = "http://definitions.test"
os.environ["HARNESS_SERVICE_TOKEN"] = SERVICE_TOKEN
os.environ["DEFINITIONS_URL"] = DEFINITIONS_URL

ORG = "acme"
TEAM = "acme.marketing"
INTERNS = "acme.marketing.interns"
ORG_REF = "refs/heads/org"
TEAM_REF = f"refs/heads/teams/{TEAM}"
INTERNS_REF = f"refs/heads/teams/{INTERNS}"

# The bundled vault's refs are `secret://…` (`api_keys.key_ref`), which is the
# first pattern `definitions` refuses in a tree — see the report. Policy here
# uses the scheme-less form engine 01 §4.2 writes.
GROUP = {
    "name": "marketing",
    "entries": [
        {"alias": "crm", "secret": {"vault": "bundled", "ref": "marketing/crm"},
         "upstream": "https://api.crm.example",
         "attach": {"header": "Authorization", "prefix": "Bearer "}},
        {"alias": "email", "secret": {"vault": "aws-prod", "ref": "marketing/sendgrid"},
         "upstream": "https://api.sendgrid.com",
         "attach": {"header": "Authorization", "prefix": "Bearer "}},
    ],
    "sources": "vault",
}
ORG_POLICY = {
    "groups.json": [GROUP],
    "grants.json": [
        {"id": "g-marketing", "scope": {"teams": [TEAM]}, "group": "marketing", "by": "ana@acme.co"}
    ],
    "boundaries.json": [
        {"id": "b-org", "scope": {"teams": "all"}, "kind": "endpoint",
         "value": "*.pastebin.com", "holds": "enforced", "reason": "Data policy."}
    ],
    "harness-providers.json": [
        {"id": "pi", "approval": "approved", "scope": {"teams": "all"},
         "pin": {"binary": "pi", "minVersion": "1.0.0"}, "speaks": ["anthropic-messages"]}
    ],
    "model-providers.json": [
        {"id": "anthropic", "endpoints": {"anthropic-messages": "https://api.anthropic.com"},
         "models": ["claude-sonnet-5"]}
    ],
    "routing.json": {
        "defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
        "approvedFor": {"teams": {TEAM: ["anthropic"]}, "harnesses": {}, "providers": {}},
    },
    "kinds.json": ["skill", "memory"],
}
TEAM_POLICY = {
    "boundaries.json": [
        {"id": "b-team", "scope": {"teams": "all"}, "kind": "endpoint",
         "value": "competitor.example", "holds": "enforced", "reason": "Contract 4.2."}
    ],
}


class FakeDefinitions:
    """`POST /internal/commit` and `GET /internal/tree/…`, and nothing else.

    The store is keyed by the revision it was read at, exactly as the service
    is; a commit writes back under the same key because nothing here moves
    `idx_refs` (the real service moves it from its post-receive, which a fake
    cannot do without calling back into `api` mid-transaction).
    """

    def __init__(self, files: dict[tuple[str, str], object], probe=None) -> None:
        self.files = dict(files)
        self.commits: list[dict] = []
        self.branches: list[dict] = []
        self.reads: list[str] = []
        self.next_commit = 0
        # Run on the caller's own connection while its transaction is suspended
        # on this request — the only moment cutover.md §5.6's ordering shows.
        self.probe = probe
        self.probed: list = []

    async def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {SERVICE_TOKEN}"
        path = request.url.path
        if request.method == "GET" and path.startswith("/internal/tree/"):
            _, _, _, _org, rev, *rest = path.split("/")
            key = (rev, "/".join(rest))
            self.reads.append(key[1])
            if key not in self.files:
                # What `gitOut` does for a path that is not there: it throws.
                return httpx.Response(500, json={"code": "definitions.read_failed"})
            blob = json.dumps(self.files[key]).encode()
            return httpx.Response(200, json={"blob": base64.b64encode(blob).decode()})
        if request.method == "POST" and path == "/internal/branches":
            self.branches.append(body := json.loads(request.content))
            return httpx.Response(201, json={"commit": f"c-{body['node_path']}"})
        if request.method == "POST" and path == "/internal/commit":
            body = json.loads(request.content)
            if self.probe is not None:
                self.probed.append(await self.probe())
            self.commits.append(body)
            for change in body["changes"]:
                if change.get("delete"):
                    self.files.pop((body["expectedHead"], change["path"]), None)
                elif "blob" in change:
                    raw = base64.b64decode(change["blob"])
                    try:
                        self.files[(body["expectedHead"], change["path"])] = json.loads(raw)
                    except ValueError:
                        # Not every file on a branch is JSON: W5-D15 copies a
                        # preset asset's directory verbatim, `SKILL.md` and all.
                        self.files[(body["expectedHead"], change["path"])] = raw
            self.next_commit += 1
            return httpx.Response(200, json={"commit": f"c-new-{self.next_commit}"})
        return httpx.Response(404, json={})

    def changed(self, index: int = 0) -> object:
        """The whole file the commit at `index` wrote, parsed."""
        change = self.commits[index]["changes"][0]
        return json.loads(base64.b64decode(change["blob"]))


@asynccontextmanager
async def fake_definitions(files: dict[tuple[str, str], object], probe=None):
    fake = FakeDefinitions(files, probe)
    definitions_client.transport = httpx.MockTransport(fake.handle)
    try:
        yield fake
    finally:
        definitions_client.transport = None


async def _write_index(connection, org, ref, commit, rows) -> None:
    await routes_internal.write_index(
        routes_internal.IndexWrite(org=org, ref=ref, commit=commit, rows=rows),
        _request(connection),
        f"Bearer {SERVICE_TOKEN}",
    )


async def _unit(connection, parent, role, name):
    return await connection.fetchval(
        "insert into org_units(parent_id,role,name) values ($1,$2,$3) returning id",
        parent,
        role,
        name,
    )


async def _person(connection, team, name, email):
    unit = await _unit(connection, team, "user", name)
    person = uuid.uuid4()
    await connection.execute("insert into auth.users(id,email) values ($1,$2)", person, email)
    await connection.execute(
        "insert into org_unit_members(auth_user_id,user_unit_id) values ($1,$2)", person, unit
    )
    return person, unit


@asynccontextmanager
async def world():
    """One organisation, two teams, three people — an organisation admin, a
    team admin of `marketing`, and a member — with the index `definitions`
    would have written for them."""
    async with scratch_db(_all_migrations()) as connection:
        audit._PARTITIONED.clear()
        org = await _unit(connection, None, "org", "acme")
        team = await _unit(connection, org, "team", "marketing")
        interns = await _unit(connection, team, "team", "interns")
        ana, _ = await _person(connection, team, "ana", "ana@acme.co")
        rae, _ = await _person(connection, team, "rae", "rae@acme.co")
        dana, dana_unit = await _person(connection, team, "dana", "dana@acme.co")
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'owner')",
            ana,
            org,
        )
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            rae,
            team,
        )
        nodes = [
            {"path": ORG, "kind": "org", "ref": ORG_REF, "parent_path": None},
            {"path": TEAM, "kind": "team", "ref": TEAM_REF, "parent_path": ORG},
            {"path": INTERNS, "kind": "team", "ref": INTERNS_REF, "parent_path": TEAM},
            *(
                {"path": f"{TEAM}.{name}", "kind": "user",
                 "ref": f"refs/heads/users/{who}", "parent_path": TEAM}
                for name, who in (("ana", ana), ("rae", rae), ("dana", dana))
            ),
        ]
        asset_id = str(uuid.uuid4())
        harness_id = str(uuid.uuid4())
        team_harness_id = str(uuid.uuid4())
        await _write_index(
            connection,
            org,
            ORG_REF,
            "c-org",
            {
                "idx_nodes": nodes,
                "idx_policy": [{"node_path": ORG, "file": name, "body": body}
                               for name, body in ORG_POLICY.items()],
                "idx_assets": [{"node_path": ORG, "id": asset_id, "kind": "skill",
                                "name": "triage", "tree": "t1", "sidecar": {"id": asset_id}}],
                # What compose gives each person: the organisation's copy wins
                # for all three. The store reads this set (W5-D15).
                "idx_effective": [
                    {"user_id": str(who), "asset_id": asset_id, "from_path": ORG,
                     "shadows_path": None}
                    for who in (ana, rae, dana)
                ],
            },
        )
        await _write_index(
            connection,
            org,
            TEAM_REF,
            "c-team",
            {
                "idx_nodes": nodes,
                "idx_policy": [{"node_path": TEAM, "file": name, "body": body}
                               for name, body in TEAM_POLICY.items()],
                "idx_harnesses": [{"node_path": TEAM, "id": team_harness_id,
                                   "name": "Campaigns", "def": {"id": team_harness_id,
                                                                "name": "Campaigns",
                                                                "assets": []}}],
            },
        )
        await _write_index(connection, org, INTERNS_REF, "c-interns", {"idx_nodes": nodes})
        for name, who in (("ana", ana), ("rae", rae)):
            await _write_index(
                connection, org, f"refs/heads/users/{who}", f"c-{name}", {"idx_nodes": nodes}
            )
        await _write_index(
            connection,
            org,
            f"refs/heads/users/{dana}",
            "c-dana",
            {
                "idx_nodes": nodes,
                "idx_harnesses": [{"node_path": f"{TEAM}.dana", "id": harness_id,
                                   "name": "Mine", "def": {"id": harness_id, "name": "Mine",
                                                           "assets": []}}],
            },
        )
        yield {
            "connection": connection,
            "org": org,
            "team": team,
            "interns": interns,
            "ana": Principal(ana, "ana@acme.co"),
            "rae": Principal(rae, "rae@acme.co"),
            "dana": Principal(dana, "dana@acme.co"),
            "dana_unit": dana_unit,
            "asset": asset_id,
            "harness": harness_id,
            "team_harness": team_harness_id,
        }


@asynccontextmanager
async def personal_world():
    """prd-v2 §12.1: one organisation, one person, **no team node** — which is
    what makes the edition personal (`console._facts` derives it the same way).
    Small on purpose: W7-D3 is about what one write does here, and a second
    team would make it an enterprise."""
    async with scratch_db(_all_migrations()) as connection:
        audit._PARTITIONED.clear()
        org = await _unit(connection, None, "org", "kit")
        kit, kit_unit = await _person(connection, org, "kit", "kit@example.com")
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'owner')",
            kit, org,
        )
        nodes = [
            {"path": "kit", "kind": "org", "ref": ORG_REF, "parent_path": None},
            {"path": "kit.kit", "kind": "user", "ref": f"refs/heads/users/{kit}",
             "parent_path": "kit"},
        ]
        await _write_index(connection, org, ORG_REF, "c-org", {
            "idx_nodes": nodes,
            "idx_policy": [{"node_path": "kit", "file": name, "body": body}
                           for name, body in ORG_POLICY.items()]})
        await _write_index(connection, org, f"refs/heads/users/{kit}", "c-kit",
                           {"idx_nodes": nodes})
        yield {"connection": connection, "org": org, "org_path": "kit",
               "kit": Principal(kit, "kit@example.com"), "kit_unit": kit_unit}


# W6-D6: a model provider nothing holds a key for can be routed nowhere, so a
# routing test runs against the state `POST …/setup` leaves behind — a
# `model-keys` entry in the bundled vault, and the provider naming its alias.
MODEL_KEYS = {
    "name": "model-keys",
    "entries": [
        {"alias": "anthropic", "secret": {"vault": "bundled", "ref": "model-keys/anthropic"},
         "upstream": "https://api.anthropic.com",
         "attach": {"header": "x-api-key", "prefix": ""}},
    ],
    "sources": "vault",
}
HELD = {
    "groups.json": [GROUP, MODEL_KEYS],
    "model-providers.json": [
        {"id": "anthropic", "endpoints": {"anthropic-messages": "https://api.anthropic.com"},
         "models": ["claude-sonnet-5"], "credential": {"alias": "anthropic"}},
        # The keyless row W6-D6 keeps out of every default and approval. W7-D2
        # kept it keyless *and* out: Pi ships no sign-in for the bare `openai`
        # id — its own OAuth flow is `openai-codex` — so nothing can run here
        # without a key. A provider Pi does sign in to is `openrouter`, below.
        {"id": "openai", "endpoints": {"openai-completions": "https://api.openai.com/v1"},
         "models": []},
        {"id": "openrouter", "endpoints": {"openai-completions": "https://openrouter.ai/api/v1"},
         "models": []},
    ],
}


def _files_with_a_held_key() -> dict[tuple[str, str], object]:
    return _files() | {("c-org", f"policy/{name}"): body for name, body in HELD.items()}


def _files() -> dict[tuple[str, str], object]:
    return {
        **{("c-org", f"policy/{name}"): body for name, body in ORG_POLICY.items()},
        **{("c-team", f"policy/{name}"): body for name, body in TEAM_POLICY.items()},
    }


async def _actions(connection) -> list[str]:
    return [row["action"] for row in
            await connection.fetch("select action from audit_log order by id")]


# --- D9: one commit, one event ----------------------------------------------


@requires_postgres
async def test_every_write_is_one_commit_and_one_event():
    """00 D9 and engine 02 §5.3, field for field: the body `definitions` gets."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        result = await routes_writes.add_boundary(
            routes_writes.BoundaryIn(
                scope={"teams": "all"}, kind="endpoint", value="*.paste.example",
                holds="enforced", reason="Data policy.", id="b-new",
            ),
            _request(connection),
            w["ana"],
        )
        assert result == {"commit": "c-new-1", "ref": ORG_REF}
        assert len(fake.commits) == 1
        body = fake.commits[0]
        assert body["org_id"] == str(w["org"])
        assert body["ref"] == ORG_REF
        assert body["expectedHead"] == "c-org"
        assert body["author"] == {"userId": str(w["ana"].auth_user_id), "name": "ana",
                                  "email": "ana@acme.co"}
        assert body["reason"] == {"kind": "admin-edit"}
        assert [change["path"] for change in body["changes"]] == ["policy/boundaries.json"]
        # The whole file goes back, the existing boundary included.
        assert [entry["id"] for entry in fake.changed()] == ["b-org", "b-new"]
        rows = await connection.fetch(
            "select action, org_unit_id, payload from audit_log order by id"
        )
        assert [row["action"] for row in rows] == ["boundary.set"]
        assert rows[0]["org_unit_id"] == w["org"]
        assert rows[0]["payload"]["commit"] == "c-new-1"


@requires_postgres
async def test_a_refused_commit_writes_no_event():
    """The event is appended after `definitions` answers, so a refusal leaves
    the audit chain untouched — and never deadlocks against the service's own
    call back into `/v1/internal/audit`."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]

        async def refuse(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/internal/commit":
                return httpx.Response(
                    403, json={"code": "definitions.policy_invalid", "message": "no"}
                )
            return await fake.handle(request)

        definitions_client.transport = httpx.MockTransport(refuse)
        with pytest.raises(ApiError) as caught:
            await routes_writes.add_boundary(
                routes_writes.BoundaryIn(scope={"teams": "all"}, kind="endpoint",
                                         value="x.example", reason="because"),
                _request(connection),
                w["ana"],
            )
        assert caught.value.code == "definitions.policy_invalid"
        assert await _actions(connection) == []


@requires_postgres
async def test_a_read_that_fails_never_blanks_the_file():
    """The index says the org holds `policy/grants.json`; if `definitions`
    will not give it to us, the write is refused rather than rewritten empty."""
    async with world() as w:
        connection = w["connection"]
        async with fake_definitions({}):  # the store knows nothing
            with pytest.raises(ApiError) as caught:
                await routes_writes.create_grant(
                    routes_writes.GrantIn(group="marketing", scope={"teams": ["acme.eng"]}),
                    _request(connection),
                    w["ana"],
                )
        assert caught.value.status_code == 503
        assert caught.value.code == "definitions_unreadable"


# --- grants ------------------------------------------------------------------


@requires_postgres
async def test_narrow_is_subset_or_refused():
    """engine 01 §6 step 9, clauses (c) and (d): a team hands down less."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        narrow = routes_writes.GrantIn(
            group="marketing",
            scope={"teams": [INTERNS]},
            narrowedFrom="g-marketing",
            aliases=["crm"],
            id="g-interns-crm",
        )
        result = await routes_writes.create_grant(narrow, _request(connection), w["rae"])
        assert result["ref"] == TEAM_REF
        assert fake.changed() == [
            {"id": "g-interns-crm", "scope": {"teams": [INTERNS]}, "group": "marketing",
             "narrowedFrom": {"grant": "g-marketing", "aliases": ["crm"]}, "by": "rae@acme.co"}
        ]
        assert await _actions(connection) == ["grant.narrow"]

        # (d) an alias the group does not hold.
        with pytest.raises(ApiError) as caught:
            await routes_writes.create_grant(
                routes_writes.GrantIn(group="marketing", scope={"teams": [INTERNS]},
                                      narrowedFrom="g-marketing", aliases=["sms"]),
                _request(connection),
                w["rae"],
            )
        assert (caught.value.code, caught.value.detail["clause"]) == ("grant.not_subset", "d")

        # (c) a team outside the narrowing node's subtree.
        with pytest.raises(ApiError) as caught:
            await routes_writes.create_grant(
                routes_writes.GrantIn(group="marketing", scope={"teams": ["acme.eng"]},
                                      narrowedFrom="g-marketing", aliases=["crm"], at=TEAM),
                _request(connection),
                w["rae"],
            )
        assert (caught.value.code, caught.value.detail["clause"]) == ("grant.not_subset", "c")

        # (e) a different group than the one it came from.
        with pytest.raises(ApiError) as caught:
            await routes_writes.create_grant(
                routes_writes.GrantIn(group="other", scope={"teams": [INTERNS]},
                                      narrowedFrom="g-marketing", aliases=["crm"]),
                _request(connection),
                w["rae"],
            )
        assert caught.value.detail["clause"] == "e"
        assert len(fake.commits) == 1


@requires_postgres
async def test_a_grant_is_the_organisations_and_a_narrowed_one_is_the_teams():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        await routes_writes.create_grant(
            routes_writes.GrantIn(group="marketing", scope={"teams": [INTERNS]}, id="g-2"),
            _request(connection),
            w["ana"],
        )
        assert fake.commits[0]["ref"] == ORG_REF
        assert await _actions(connection) == ["grant.create"]
        # A team admin may take back what the team narrowed, and no more.
        await routes_writes.create_grant(
            routes_writes.GrantIn(group="marketing", scope={"teams": [INTERNS]},
                                  narrowedFrom="g-marketing", aliases=["crm"], id="g-n"),
            _request(connection),
            w["rae"],
        )
        await _write_index(
            connection, w["org"], TEAM_REF, "c-team",
            {"idx_policy": [
                {"node_path": TEAM, "file": "grants.json",
                 "body": [{"id": "g-n", "scope": {"teams": [INTERNS]}, "group": "marketing",
                           "narrowedFrom": {"grant": "g-marketing", "aliases": ["crm"]},
                           "by": "rae@acme.co"}]},
                *[{"node_path": TEAM, "file": name, "body": body}
                  for name, body in TEAM_POLICY.items()],
            ]},
        )
        fake.files[("c-team", "policy/grants.json")] = [
            {"id": "g-n", "scope": {"teams": [INTERNS]}, "group": "marketing",
             "narrowedFrom": {"grant": "g-marketing", "aliases": ["crm"]}, "by": "rae@acme.co"}
        ]
        with pytest.raises(ApiError) as caught:
            await routes_writes.remove_grant("g-marketing", _request(connection), w["rae"])
        assert caught.value.status_code == 403
        assert "organisation admin" in caught.value.message
        await routes_writes.remove_grant("g-n", _request(connection), w["rae"])
        assert fake.changed(2) == []
        assert await _actions(connection) == ["grant.create", "grant.narrow", "grant.remove"]


# --- boundaries ---------------------------------------------------------------


@requires_postgres
async def test_boundary_cannot_be_lifted_below_where_set():
    """04 §9 and engine 01 §6 step 7: union is the only operation, so nothing
    below the organisation can take an organisation boundary away."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as caught:
            await routes_writes.remove_boundary(f"{ORG}/b-org", _request(connection), w["rae"])
        assert caught.value.status_code == 403
        assert caught.value.message == (
            "Lifting an organisation boundary is nobody's decision below the organisation. "
            "Boundaries only ever tighten on the way down."
        )
        assert fake.commits == []

        # Nor one a team above it set: a boundary is lifted where it was set.
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'admin')",
            w["dana"].auth_user_id,
            w["interns"],
        )
        with pytest.raises(ApiError) as caught:
            await routes_writes.remove_boundary(f"{TEAM}/b-team", _request(connection), w["dana"])
        assert caught.value.message.startswith(
            "A boundary is lifted where it was set, so marketing's admins decide this one."
        )
        # Its own team's, it may lift.
        await routes_writes.remove_boundary(f"{TEAM}/b-team", _request(connection), w["rae"])
        assert fake.commits[0]["ref"] == TEAM_REF
        assert fake.changed() == []
        # And the organisation admin may lift the organisation's.
        await routes_writes.remove_boundary(f"{ORG}/b-org", _request(connection), w["ana"])
        assert await _actions(connection) == ["boundary.remove", "boundary.remove"]


@requires_postgres
async def test_a_team_may_add_a_command_boundary_and_not_lift_the_orgs():
    """W6-D150. A boundary of kind `command` is an ordinary boundary under
    C32's direction: a team admin adds one for their own subtree, and the
    organisation's stays where it was set. The new part is `holds` — a command
    is refused by the runtime, never by the fence, so `intercepted` is the only
    word for it and `enforced` is a claim the product cannot keep."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        result = await routes_writes.add_boundary(
            routes_writes.BoundaryIn(
                scope={"teams": [TEAM]}, kind="command", value="rm -rf /*",
                holds="intercepted", reason="A wipe of the system root is never a step.",
                at=TEAM, id="b-wipe",
            ),
            _request(connection),
            w["rae"],
        )
        assert result["ref"] == TEAM_REF
        assert [entry["id"] for entry in fake.changed()] == ["b-team", "b-wipe"]
        assert fake.changed()[-1] == {
            "id": "b-wipe", "scope": {"teams": [TEAM]}, "kind": "command",
            "value": "rm -rf /*", "holds": "intercepted",
            "reason": "A wipe of the system root is never a step.",
        }
        assert await _actions(connection) == ["boundary.set"]

        # And the organisation's command boundary is still nobody's to lift
        # from a team: the kind changes nothing about where a boundary is set.
        with pytest.raises(ApiError) as caught:
            await routes_writes.remove_boundary(f"{ORG}/b-org", _request(connection), w["rae"])
        assert caught.value.status_code == 403
        assert caught.value.code == "boundary.not_yours"


@requires_postgres
async def test_a_command_boundary_is_intercepted_and_says_something():
    """The two refusals the kind brings with it. `enforced` is refused because
    nothing outside the runtime can hold a command, and a pattern of `*` alone
    is refused because it denies every command there is — the same sentence
    `commandPatternProblem` gives the add form before the write is attempted
    (engine 07 §8)."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as caught:
            await routes_writes.add_boundary(
                routes_writes.BoundaryIn(scope={"teams": "all"}, kind="command",
                                         value="rm -rf /*", holds="enforced",
                                         reason="because"),
                _request(connection),
                w["ana"],
            )
        assert caught.value.status_code == 422
        assert caught.value.message.startswith("A command boundary is intercepted")

        with pytest.raises(ApiError) as caught:
            await routes_writes.add_boundary(
                routes_writes.BoundaryIn(scope={"teams": "all"}, kind="command",
                                         value=" * ", holds="intercepted",
                                         reason="because"),
                _request(connection),
                w["ana"],
            )
        assert caught.value.status_code == 422
        assert caught.value.message == (
            "A pattern of only * denies every command there is. Name the command you mean."
        )
        # Neither reached `definitions`: a shape refusal is ours to make.
        assert fake.commits == []
        assert await _actions(connection) == []


@requires_postgres
async def test_a_head_that_moved_under_a_write_is_a_conflict_not_a_refusal():
    """409 from `definitions` is `head_moved` only when it says so: `id_conflict`
    and `duplicate_id` are 409s too, and each names its own remedy (02 §7.1)."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]

        async def moved(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/internal/commit":
                return httpx.Response(409, json={"code": "definitions.head_moved",
                                                 "head": "c-later"})
            return await fake.handle(request)

        definitions_client.transport = httpx.MockTransport(moved)
        with pytest.raises(ApiError) as caught:
            await routes_writes.add_boundary(
                routes_writes.BoundaryIn(scope={"teams": "all"}, kind="endpoint",
                                         value="x.example", reason="because"),
                _request(connection),
                w["ana"],
            )
        assert caught.value.code == "definitions.head_moved"
        assert caught.value.detail["head"] == "c-later"

        async def conflict(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/internal/commit":
                return httpx.Response(409, json={"code": "definitions.id_conflict",
                                                 "message": "two ids claim that path"})
            return await fake.handle(request)

        definitions_client.transport = httpx.MockTransport(conflict)
        with pytest.raises(ApiError) as caught:
            await routes_writes.add_boundary(
                routes_writes.BoundaryIn(scope={"teams": "all"}, kind="endpoint",
                                         value="x.example", reason="because"),
                _request(connection),
                w["ana"],
            )
        assert caught.value.code == "definitions.id_conflict"
        assert caught.value.message == "two ids claim that path"
        assert await _actions(connection) == []


@requires_postgres
async def test_the_file_is_committed_against_the_head_it_was_read_at():
    """Read at A, commit against A: re-reading `idx_refs` between the two would
    let another commit's change be written away without anything refusing it."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        original = fake.handle

        async def moves_the_ref(request: httpx.Request) -> httpx.Response:
            answer = await original(request)
            if request.method == "GET":
                # As if `definitions` indexed a push the moment after the read.
                await _write_index(connection, w["org"], ORG_REF, "c-later", {})
            return answer

        definitions_client.transport = httpx.MockTransport(moves_the_ref)
        await routes_writes.add_boundary(
            routes_writes.BoundaryIn(scope={"teams": "all"}, kind="endpoint",
                                     value="x.example", reason="because"),
            _request(connection),
            w["ana"],
        )
        assert fake.commits[0]["expectedHead"] == "c-org"


@requires_postgres
async def test_a_boundary_reaches_its_own_subtree_only():
    async with world() as w, fake_definitions(_files()):
        with pytest.raises(ApiError) as caught:
            await routes_writes.add_boundary(
                routes_writes.BoundaryIn(scope={"teams": ["acme.eng"]}, kind="endpoint",
                                         value="x.example", reason="because", at=TEAM),
                _request(w["connection"]),
                w["rae"],
            )
        assert caught.value.code == "boundary.outside_subtree"


# --- providers and routing -----------------------------------------------------


@requires_postgres
async def test_beta_approval_records_reason():
    """04 §11: beta and not-approved carry a reason, because the log row and
    the provider page are where the person it stops reads it."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as caught:
            await routes_writes.put_harness_provider(
                "claude",
                routes_writes.HarnessProviderIn(
                    approval="beta", pin={"binary": "claude", "minVersion": "2.1.275"},
                    speaks=["anthropic-messages"], scope={"teams": [TEAM]},
                ),
                _request(connection),
                w["ana"],
            )
        assert caught.value.status_code == 422
        assert caught.value.detail["errors"][0]["field"] == "reason"

        await routes_writes.put_harness_provider(
            "claude",
            routes_writes.HarnessProviderIn(
                approval="beta", pin={"binary": "claude", "minVersion": "2.1.275"},
                speaks=["anthropic-messages"], scope={"teams": [TEAM]},
                reason="Reviewing 2.1.x permission changes.",
            ),
            _request(connection),
            w["ana"],
        )
        written = {row["id"]: row for row in fake.changed()}
        assert written["claude"]["reason"] == "Reviewing 2.1.x permission changes."
        assert written["pi"]["approval"] == "approved"  # untouched, still in the file
        row = await connection.fetchrow("select action, payload from audit_log order by id")
        assert row["action"] == "provider.beta"
        assert row["payload"]["reason"] == "Reviewing 2.1.x permission changes."


@requires_postgres
async def test_a_provider_that_needs_a_key_cannot_become_a_default_or_an_approval():
    """W6-D6: the write refuses `provider.needs_key` naming the Set-up link, and
    only for what this write *adds* — a cell already naming a keyless provider is
    a state to be mended, not a reason to refuse the cell next to it."""
    async with world() as w, fake_definitions(_files_with_a_held_key()) as fake:
        connection = w["connection"]
        for side in ("defaultFor", "approvedFor"):
            routing = {
                "defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
                "approvedFor": {"teams": {}, "harnesses": {}, "providers": {}},
            }
            routing[side]["teams"][ORG] = "openai" if side == "defaultFor" else ["openai"]
            with pytest.raises(ApiError) as caught:
                await routes_writes.put_routing(
                    routes_writes.RoutingIn(**routing), _request(connection), w["ana"]
                )
            assert caught.value.code == "provider.needs_key"
            assert caught.value.status_code == 409
            assert "openai" in caught.value.message
            assert "Set up" in (caught.value.remedy or "")
        assert fake.commits == []
        # The held provider goes through, in the same cell.
        await routes_writes.put_routing(
            routes_writes.RoutingIn(
                defaultFor={"teams": {ORG: "anthropic"}, "harnesses": {}, "providers": {}},
                approvedFor={"teams": {ORG: ["anthropic"]}, "harnesses": {}, "providers": {}},
            ),
            _request(connection),
            w["ana"],
        )
        assert _wrote(fake, -1, "policy/routing.json")["defaultFor"]["teams"] == {
            ORG: "anthropic"}


@requires_postgres
async def test_a_provider_the_runtime_signs_in_to_may_be_a_default():
    """W7-D2: the routing write reads the same rule as the broker and the Status
    column, so a provider the broker now allows is a provider routing now
    accepts. `openrouter` holds no key here and Pi signs in to it itself."""
    async with world() as w, fake_definitions(_files_with_a_held_key()) as fake:
        connection = w["connection"]
        await routes_writes.put_routing(
            routes_writes.RoutingIn(
                defaultFor={"teams": {ORG: "openrouter"}, "harnesses": {}, "providers": {}},
                approvedFor={"teams": {ORG: ["openrouter"]}, "harnesses": {}, "providers": {}},
            ),
            _request(connection),
            w["ana"],
        )
        assert _wrote(fake, -1, "policy/routing.json")["defaultFor"]["teams"] == {
            ORG: "openrouter"}


@requires_postgres
async def test_delete_model_provider_refuses_while_anything_points_at_it():
    """W6-D5: `model-providers` is `recommended`, so it has a delete verb. It is
    refused while a routing cell or a security group entry still names it, and
    the refusal names them — the console deletes nothing on an admin's behalf."""
    async with world() as w, fake_definitions(_files_with_a_held_key()) as fake:
        connection = w["connection"]
        await routes_writes.put_routing(
            routes_writes.RoutingIn(
                defaultFor={"teams": {ORG: "anthropic"}, "harnesses": {}, "providers": {}},
                approvedFor={"teams": {ORG: ["anthropic"]}, "harnesses": {}, "providers": {}},
            ),
            _request(connection),
            w["ana"],
        )
        with pytest.raises(ApiError) as caught:
            await routes_writes.delete_model_provider(
                "anthropic", _request(connection), w["ana"], scope="org")
        assert caught.value.code == "provider.in_use"
        assert caught.value.status_code == 409
        assert caught.value.detail["routing"] == [f"approvedFor.teams.{ORG}",
                                                 f"defaultFor.teams.{ORG}"]
        assert caught.value.detail["groups"] == ["model-keys"]
        # One subject, once, even though it is two cells.
        assert caught.value.message.count(ORG) == 1 and "model-keys" in caught.value.message

        # The keyless row nothing points at goes, and the rest of the file stays.
        before = len(fake.commits)
        result = await routes_writes.delete_model_provider(
            "openrouter", _request(connection), w["ana"], scope="org")
        assert result["ref"] == ORG_REF
        assert len(fake.commits) == before + 1
        assert [row["id"] for row in _wrote(fake, -1, "policy/model-providers.json")] == [
            "anthropic", "openai"]
        row = await connection.fetchrow(
            "select action, payload from audit_log order by id desc limit 1")
        assert (row["action"], row["payload"]["provider"]) == ("provider.delete", "openrouter")

        with pytest.raises(ApiError) as caught:
            await routes_writes.delete_model_provider(
                "openrouter", _request(connection), w["ana"], scope="org")
        assert caught.value.code == "model_provider_unknown"


@requires_postgres
async def test_a_runtime_keeps_its_name_through_an_approval():
    """W6-D3: `name` is on the contract and this is a whole-row write, so the
    row that comes back carries the word a person reads for the runtime."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        await routes_writes.put_harness_provider(
            "claude",
            routes_writes.HarnessProviderIn(
                approval="approved", pin={"binary": "claude", "minVersion": "2.1.275"},
                speaks=["anthropic-messages"], scope={"teams": "all"}, name="Claude Code",
            ),
            _request(connection),
            w["ana"],
        )
        written = {row["id"]: row for row in fake.changed()}
        assert written["claude"]["name"] == "Claude Code"


@requires_postgres
async def test_routing_default_is_the_teams_only_within_approved_for():
    async with world() as w, fake_definitions(_files_with_a_held_key()) as fake:
        connection = w["connection"]
        routing = {
            "defaultFor": {"teams": {TEAM: "anthropic"}, "harnesses": {}, "providers": {}},
            "approvedFor": {"teams": {TEAM: ["anthropic"]}, "harnesses": {}, "providers": {}},
        }
        await routes_writes.put_routing(
            routes_writes.RoutingIn(**routing), _request(connection), w["rae"]
        )
        assert fake.changed() == routing
        row = await connection.fetchrow("select action, payload from audit_log order by id")
        assert (row["action"], row["payload"]["model_provider"]) == ("routing.change", "anthropic")

        unapproved = {
            "defaultFor": {"teams": {TEAM: "openrouter"}, "harnesses": {}, "providers": {}},
            "approvedFor": {"teams": {TEAM: ["anthropic"]}, "harnesses": {}, "providers": {}},
        }
        with pytest.raises(ApiError) as caught:
            await routes_writes.put_routing(
                routes_writes.RoutingIn(**unapproved), _request(connection), w["rae"]
            )
        assert caught.value.code == "routing.not_approved"
        # The organisation's own cell is not a team admin's, even though the
        # org path is on their chain.
        with pytest.raises(ApiError) as caught:
            await routes_writes.put_routing(
                routes_writes.RoutingIn(
                    defaultFor={"teams": {ORG: "anthropic"}, "harnesses": {}, "providers": {}},
                    approvedFor={"teams": {TEAM: ["anthropic"]}, "harnesses": {},
                                 "providers": {}},
                ),
                _request(connection),
                w["rae"],
            )
        assert caught.value.code == "routing.not_yours"
        # Another team's cell is not a team admin's to set.
        with pytest.raises(ApiError) as caught:
            await routes_writes.put_routing(
                routes_writes.RoutingIn(
                    defaultFor={"teams": {"acme.eng": "anthropic"}, "harnesses": {},
                                "providers": {}},
                    approvedFor={"teams": {TEAM: ["anthropic"]}, "harnesses": {},
                                 "providers": {}},
                ),
                _request(connection),
                w["rae"],
            )
        assert caught.value.code == "routing.not_yours"


# --- groups, vaults, secrets and how an asset loads ----------------------------


@requires_postgres
async def test_group_create_and_edit_keep_one_file_and_refuse_a_value():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        await routes_writes.create_group(
            routes_writes.GroupIn(
                name="support",
                entries=[{"alias": "zendesk",
                          "secret": {"vault": "aws-prod", "ref": "support/zendesk"},
                          "upstream": "https://api.zendesk.com",
                          "attach": {"header": "Authorization", "prefix": "Bearer "}}],
            ),
            _request(connection),
            w["ana"],
        )
        assert [group["name"] for group in fake.changed()] == ["marketing", "support"]
        await routes_writes.edit_group(
            "support",
            routes_writes.GroupPatch(sources="vault-or-local"),
            _request(connection),
            w["ana"],
        )
        assert fake.changed(1)[1]["sources"] == "vault-or-local"
        # engine 02 §7 step 8, mirrored here so the refusal is legible.
        with pytest.raises(ApiError) as caught:
            await routes_writes.create_group(
                routes_writes.GroupIn(
                    name="leaky",
                    entries=[{"alias": "x", "secret": {"vault": "bundled", "ref": "x"},
                              "upstream": "https://x.example",
                              "attach": {"header": "Authorization",
                                         "prefix": "Bearer sk-abcdefghijklmnopqrstuvwxyz"}}],
                ),
                _request(connection),
                w["ana"],
            )
        assert caught.value.code == "policy.secret_in_tree"


@requires_postgres
async def test_group_may_be_created_empty():
    """04 §8 *Create a group*: a group is a named set, and the console adds its
    first entry afterwards, so an empty `entries` is a group and not a refusal.
    """
    async with world() as w, fake_definitions(_files()) as fake:
        await routes_writes.create_group(
            routes_writes.GroupIn(name="support", entries=[]),
            _request(w["connection"]),
            w["ana"],
        )
        written = next(group for group in fake.changed() if group["name"] == "support")
        assert written["entries"] == [] and written["sources"] == "vault"


@requires_postgres
async def test_vault_connects_then_refuses_to_disconnect_while_a_group_names_it():
    async with world() as w, fake_definitions(_files()):
        connection = w["connection"]
        await routes_writes.connect_vault(
            routes_writes.VaultIn(id="aws-prod", provider="aws"), _request(connection), w["ana"]
        )
        listed = await routes_writes.list_vaults(_request(connection), w["ana"])
        assert [row["id"] for row in listed["items"]] == ["aws-prod"]
        with pytest.raises(ApiError) as caught:
            await routes_writes.disconnect_vault("aws-prod", _request(connection), w["ana"])
        assert caught.value.status_code == 409
        assert caught.value.detail["groups"] == ["marketing"]
        # A vault nothing names disconnects.
        await routes_writes.connect_vault(
            routes_writes.VaultIn(id="spare", provider="aws"), _request(connection), w["ana"]
        )
        await routes_writes.disconnect_vault("spare", _request(connection), w["ana"])
        assert await _actions(connection) == ["vault.connect", "vault.connect", "vault.connect"]


@requires_postgres
async def test_paste_and_rotate_are_the_bundled_vaults_only():
    async with world() as w, fake_definitions(_files()):
        connection = w["connection"]
        pasted = await routes_writes.paste_secret(
            "bundled",
            routes_writes.SecretIn(name="crm", value="a-value-nobody-logs", env_var="CRM_KEY"),
            _request(connection),
            w["ana"],
        )
        assert pasted["ref"] == "secret://acme/crm"
        rotated = await routes_writes.rotate_secret(
            "bundled",
            pasted["ref"],
            routes_writes.RotateIn(value="the-next-one"),
            _request(connection),
            w["ana"],
        )
        assert rotated["version"] == 2
        with pytest.raises(ApiError) as caught:
            await routes_writes.paste_secret(
                "aws-prod",
                routes_writes.SecretIn(name="x", value="y"),
                _request(connection),
                w["ana"],
            )
        assert caught.value.code == "vault.not_writable"
        assert "never write to a customer's vault" in caught.value.message
        assert await _actions(connection) == ["api_key.create", "api_key.rotate"]


@requires_postgres
async def test_always_loaded_is_the_org_nodes_assets_only():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        # W5-D10: `always` and `chosen` are last release's words, still accepted
        # and written as the state they mean.
        await routes_writes.set_asset_loads(
            uuid.UUID(w["asset"]),
            routes_writes.LoadsIn(loads="always"),
            _request(connection),
            w["ana"],
        )
        assert fake.changed() == {"required": [w["asset"]], "recommended": []}
        assert fake.commits[0]["changes"][0]["path"] == "policy/always-loaded.json"
        await routes_writes.set_asset_loads(
            uuid.UUID(w["asset"]),
            routes_writes.LoadsIn(loads="chosen"),
            _request(connection),
            w["ana"],
        )
        assert fake.changed(1) == {"required": [], "recommended": []}
        assert await _actions(connection) == ["asset.status", "asset.status"]


@requires_postgres
async def test_recommended_is_its_own_list_and_never_required():
    """W5-D10. The three states are one file: moving an id to `recommended`
    takes it off `required`, and moving it back takes it off `recommended`."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        for state, expected in (
            ("recommended", {"required": [], "recommended": [w["asset"]]}),
            ("required", {"required": [w["asset"]], "recommended": []}),
            ("on-request", {"required": [], "recommended": []}),
        ):
            await routes_writes.set_asset_loads(
                uuid.UUID(w["asset"]),
                routes_writes.LoadsIn(loads=state),
                _request(connection),
                w["ana"],
            )
            assert fake.changed(len(fake.commits) - 1) == expected


# --- editing and deleting an asset's own copy (WS3a) ------------------------


@requires_postgres
async def test_delete_asset_removes_path_and_harness_membership_in_one_commit():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        org_harness = uuid.uuid4()
        await connection.execute(
            "insert into idx_harnesses(org, node_path, id, name, def)"
            " values ($1,$2,$3,$4,$5::jsonb)",
            w["org"],
            ORG,
            org_harness,
            "Org tools",
            json.dumps({"id": str(org_harness), "name": "Org tools", "assets": [w["asset"]]}),
        )
        await routes_writes.delete_asset(
            uuid.UUID(w["asset"]), _request(connection), w["ana"], scope="org"
        )
        assert fake.commits[0]["expectedHead"] == "c-org"
        paths = {change["path"] for change in fake.commits[0]["changes"]}
        assert paths == {"assets/skill/triage", f"harnesses/{org_harness}.json"}
        harness_change = next(
            change
            for change in fake.commits[0]["changes"]
            if change["path"].startswith("harnesses/")
        )
        assert json.loads(base64.b64decode(harness_change["blob"]))["assets"] == []
        assert await _actions(connection) == ["asset.delete"]


@requires_postgres
async def test_delete_asset_refuses_a_required_id():
    async with world() as w:
        files = {**_files(), ("c-org", "policy/always-loaded.json"): [w["asset"]]}
        async with fake_definitions(files) as fake:
            connection = w["connection"]
            with pytest.raises(ApiError) as caught:
                await routes_writes.delete_asset(
                    uuid.UUID(w["asset"]), _request(connection), w["ana"], scope="org"
                )
            assert caught.value.code == "asset.required"
            assert fake.commits == []


@requires_postgres
async def test_delete_asset_by_team_admin_on_org_node_is_refused():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as caught:
            await routes_writes.delete_asset(
                uuid.UUID(w["asset"]), _request(connection), w["rae"], scope="org"
            )
        assert caught.value.code == "asset.not_yours"
        assert fake.commits == []


@requires_postgres
async def test_member_deletes_their_own_copy():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        mine = uuid.uuid4()
        await connection.execute(
            "insert into idx_assets(org, node_path, id, kind, name, tree, sidecar) "
            "values ($1,$2,$3,$4,$5,$6,$7::jsonb)",
            w["org"],
            f"{TEAM}.dana",
            mine,
            "skill",
            "scratch",
            "t2",
            json.dumps({"id": str(mine)}),
        )
        await routes_writes.delete_asset(mine, _request(connection), w["dana"])
        assert fake.commits[0]["expectedHead"] == "c-dana"
        assert fake.commits[0]["changes"] == [{"path": "assets/skill/scratch", "delete": True}]
        assert await _actions(connection) == ["asset.delete"]


@requires_postgres
async def test_edit_asset_description_rewrites_the_sidecar():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        row = await routes_writes.edit_asset(
            uuid.UUID(w["asset"]),
            routes_writes.AssetPatchIn(description="Handles urgent triage."),
            _request(connection),
            w["ana"],
            scope="org",
        )
        assert fake.commits[0]["changes"] == [
            {
                "path": "assets/skill/triage/asset.json",
                "blob": fake.commits[0]["changes"][0]["blob"],
            }
        ]
        written = json.loads(base64.b64decode(fake.commits[0]["changes"][0]["blob"]))
        assert written == {"id": w["asset"], "description": "Handles urgent triage."}
        assert row["sidecar"]["description"] == "Handles urgent triage."
        assert row["name"] == "triage"
        assert await _actions(connection) == ["asset.edit"]


@requires_postgres
async def test_edit_asset_rename_moves_the_directory_and_refuses_a_taken_name():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        await connection.execute(
            "insert into idx_assets(org, node_path, id, kind, name, tree, sidecar) "
            "values ($1,$2,$3,$4,$5,$6,$7::jsonb)",
            w["org"],
            ORG,
            uuid.uuid4(),
            "skill",
            "urgent",
            "t3",
            json.dumps({"id": str(uuid.uuid4())}),
        )
        with pytest.raises(ApiError) as caught:
            await routes_writes.edit_asset(
                uuid.UUID(w["asset"]),
                routes_writes.AssetPatchIn(name="urgent"),
                _request(connection),
                w["ana"],
                scope="org",
            )
        assert caught.value.code == "asset.name_taken"
        assert fake.commits == []

        with pytest.raises(ApiError) as caught:
            await routes_writes.edit_asset(
                uuid.UUID(w["asset"]),
                routes_writes.AssetPatchIn(name="../../policy/kinds"),
                _request(connection),
                w["ana"],
                scope="org",
            )
        assert caught.value.code == "invalid_request"
        assert fake.commits == []

        row = await routes_writes.edit_asset(
            uuid.UUID(w["asset"]),
            routes_writes.AssetPatchIn(name="triage-2"),
            _request(connection),
            w["ana"],
            scope="org",
        )
        changes = fake.commits[0]["changes"]
        assert {"path": "assets/skill/triage", "delete": True} in changes
        move = next(
            change
            for change in changes
            if change.get("path") == "assets/skill/triage-2" and "from" in change
        )
        assert move["from"] == {"commit": "c-org", "path": "assets/skill/triage"}
        assert row["name"] == "triage-2"
        assert await _actions(connection) == ["asset.edit"]


# --- harnesses -----------------------------------------------------------------


@requires_postgres
async def test_harness_create_commits_on_own_ref():
    """00 §4.11: `harnesses/<id>.json` on the caller's ref — never the legacy
    table. Creating at `me` is never refused (PRD §17.4)."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        result = await routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(name="Drafts", description="Weekly copy."),
            _request(connection),
            w["dana"],
        )
        assert result["ref"] == f"refs/heads/users/{w['dana'].auth_user_id}"
        assert fake.commits[0]["expectedHead"] == "c-dana"
        written = fake.changed()
        assert fake.commits[0]["changes"][0]["path"] == f"harnesses/{written['id']}.json"
        assert (written["name"], written["assets"]) == ("Drafts", [])
        assert await _actions(connection) == ["harness.create"]
        assert await connection.fetchval("select count(*) from harnesses") == 0

        # A copy starts from another harness's assets.
        copy = await routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(name="Copy", **{"from": uuid.UUID(w["harness"])}),
            _request(connection),
            w["dana"],
        )
        assert copy["ref"].endswith(str(w["dana"].auth_user_id))


@requires_postgres
async def test_a_new_harness_starts_with_the_recommended_ids():
    """W5-D10: `recommended` is copied into a harness at creation and is an
    ordinary entry of it from then on. An id the org branch does not hold is
    not copied — compose would drop it and the row would answer nothing."""
    async with world() as w, fake_definitions({
        **_files(),
        ("c-org", "policy/always-loaded.json"): {
            "required": [], "recommended": [w["asset"], str(uuid.uuid4())],
        },
    }) as fake:
        await routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(name="Drafts"),
            _request(w["connection"]),
            w["dana"],
        )
        assert fake.changed()["assets"] == [w["asset"]]


# --- the first-harness modal's two questions (W7-D4) -------------------------


@requires_postgres
async def test_the_first_harness_modal_writes_reach_on_the_harness_and_one_grant():
    """W7-D4: *Web access* is `HarnessDef.reach` on the harness's own file, and
    *Outside keys* is one grant of that group reaching this harness and nothing
    else. Two commits, on two refs, because `policy/` is refused on a user
    branch (01 §4.2) — and one audit event each (D9)."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        result = await routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(
                name="Drafts",
                reach={"mode": "off", "hosts": ["pypi.org"]},
                grant={"group": "marketing"},
            ),
            _request(connection),
            w["ana"],
        )
        # The harness, on ana's own branch, carrying its last narrowing step.
        # `off` ignores a host list, so the file does not carry one (D131).
        assert result["ref"] == f"refs/heads/users/{w['ana'].auth_user_id}"
        written = fake.changed(0)
        assert written["reach"] == {"mode": "off", "hosts": []}
        harness_id = written["id"]
        assert result["id"] == harness_id

        # The grant, on the org branch — appended, never replacing what is
        # there — and scoped to this harness alone, which is the whole of what
        # the modal added to the organisation.
        assert fake.commits[1]["ref"] == ORG_REF
        assert fake.commits[1]["changes"][0]["path"] == "policy/grants.json"
        grants = fake.changed(1)
        assert [one["id"] for one in grants[:-1]] == ["g-marketing"]
        assert grants[-1]["scope"] == {"teams": "all", "harnesses": [harness_id]}
        assert grants[-1]["group"] == "marketing"
        assert result["grant"] == grants[-1]["id"]
        assert await _actions(connection) == ["harness.create", "grant.create"]


@requires_postgres
async def test_a_harness_grant_is_refused_where_a_grant_is_refused():
    """W7-D4 writes a permission, so it is refused exactly where
    `POST /v1/grants` refuses one — and refused *before* the harness commit,
    so a refusal never leaves half the modal behind."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as refusal:
            await routes_writes.create_harness_on_ref(
                routes_writes.HarnessIn(name="Drafts", grant={"group": "marketing"}),
                _request(connection),
                w["dana"],
            )
        assert refusal.value.code == "grant.org_admin_required"
        assert fake.commits == []

        with pytest.raises(ApiError) as unknown:
            await routes_writes.create_harness_on_ref(
                routes_writes.HarnessIn(name="Drafts", grant={"group": "nobody"}),
                _request(connection),
                w["ana"],
            )
        assert (unknown.value.status_code, unknown.value.code) == (422, "invalid_request")
        assert fake.commits == []
        assert await _actions(connection) == []


@requires_postgres
async def test_a_harness_reach_is_checked_before_anything_is_written():
    """`validate_reach` is D131's one shape check, and a bad one is a 422 with
    no commit — not a harness holding a `reach` nothing can read."""
    async with world() as w, fake_definitions(_files()) as fake:
        with pytest.raises(ApiError) as refusal:
            await routes_writes.create_harness_on_ref(
                routes_writes.HarnessIn(name="Drafts", reach={"mode": "sometimes"}),
                _request(w["connection"]),
                w["dana"],
            )
        assert refusal.value.status_code == 422
        assert fake.commits == []


def test_a_harness_off_under_an_org_on_composes_to_off():
    """W7-D4's arithmetic, and the reason the personal reach default became
    `on`: the harness's step is the last one of D131's walk, and `off` is
    narrower than everything, so the switch always lands. `setBy` names the
    harness, which is where the person turns it back on."""
    org = console_index.start_reach({"mode": "on", "hosts": []}, "acme")
    assert org == {"mode": "on", "hosts": [], "setBy": "acme"}
    off = console_index.narrow_reach(org, {"mode": "off", "hosts": []}, "harness:h1")
    assert off == {"mode": "off", "hosts": [], "setBy": "harness:h1"}
    # And the other way round is the widening the default was changed to
    # avoid: under the old `allow` default an `on` harness kept the parent.
    allowed = console_index.start_reach({"mode": "allow", "hosts": ["pypi.org"]}, "acme")
    assert console_index.narrow_reach(allowed, {"mode": "on", "hosts": []}, "harness:h1") == allowed


# --- the store: *Add to harness* and *New harness from selection* (W5-D15) ---
#
# The preset ids are the bundled catalogue's own, read from
# `engine/compose/presets/assets` exactly as the seed reads it — a list here
# would be a second copy of the thing D30j says has one.

PRESET_SKILL = "0460b220-8379-5ddf-82ef-31bc0e8a99e1"      # skill/harness-authoring
PRESET_BRIEF = "7b1f5c94-2d0a-5e63-9c18-4a6d3f0b28c7"      # system_prompt/harness
TOOL = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
ENVIRONMENT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"


def _mine(w, assets=()) -> dict:
    """dana's own version of her harness, as her branch holds it."""
    return {"id": w["harness"], "name": "Mine", "description": "",
            "icon": {"palette": [], "rows": []}, "assets": list(assets)}


async def _dana_holds_a_tool_that_needs_an_environment(w) -> None:
    """A tool and the environment its sidecar names, both on dana's own branch
    and both in her composed set — W5-D15's *brings its environment along*."""
    await _write_index(
        w["connection"], w["org"], f"refs/heads/users/{w['dana'].auth_user_id}", "c-dana",
        {
            "idx_harnesses": [{"node_path": f"{TEAM}.dana", "id": w["harness"], "name": "Mine",
                               "def": _mine(w)}],
            "idx_assets": [
                {"node_path": f"{TEAM}.dana", "id": TOOL, "kind": "tool", "name": "csv-summary",
                 "tree": "t-tool",
                 "sidecar": {"id": TOOL, "kind": "tool",
                             "needs": [{"kind": "environment", "name": "python-data"}]}},
                {"node_path": f"{TEAM}.dana", "id": ENVIRONMENT, "kind": "environment",
                 "name": "python-data", "tree": "t-env",
                 "sidecar": {"id": ENVIRONMENT, "kind": "environment"}},
            ],
            "idx_effective": [
                {"user_id": str(w["dana"].auth_user_id), "asset_id": one,
                 "from_path": path, "shadows_path": None}
                for one, path in ((w["asset"], ORG), (TOOL, f"{TEAM}.dana"),
                                  (ENVIRONMENT, f"{TEAM}.dana"))
            ],
        },
    )


@requires_postgres
async def test_add_to_harness_writes_the_persons_own_version():
    """W5-D15, engine 08 §10.0 step 5a: the ids land in `harnesses/<id>.json`
    on the person's own branch, the id kept, `assets` extended — the file the
    CLI's `joinHarness` writes, written the same way."""
    async with world() as w, fake_definitions({
        **_files(),
        ("c-dana", f"harnesses/{w['harness']}.json"): _mine(w),
    }) as fake:
        result = await routes_writes.add_assets_to_harness(
            uuid.UUID(w["harness"]),
            routes_writes.AssetsIn(ids=[w["asset"]]),
            _request(w["connection"]),
            w["dana"],
            scope="me",
        )
        assert result["ref"] == f"refs/heads/users/{w['dana'].auth_user_id}"
        assert len(fake.commits) == 1
        [change] = fake.commits[0]["changes"]
        assert change["path"] == f"harnesses/{w['harness']}.json"
        assert json.loads(base64.b64decode(change["blob"])) == _mine(w, [w["asset"]])
        assert await _actions(w["connection"]) == ["harness.add_assets"]


@requires_postgres
async def test_add_to_harness_copies_a_preset_in_the_same_commit():
    """A bundled asset the organisation does not hold is copied onto the
    person's branch *in the same commit* as the harness file: a harness naming
    an id nothing answers is an unanswered row."""
    async with world() as w, fake_definitions({
        **_files(),
        ("c-dana", f"harnesses/{w['harness']}.json"): _mine(w),
    }) as fake:
        await routes_writes.add_assets_to_harness(
            uuid.UUID(w["harness"]),
            routes_writes.AssetsIn(ids=[PRESET_SKILL]),
            _request(w["connection"]),
            w["dana"],
            scope="me",
        )
        paths = [change["path"] for change in fake.commits[0]["changes"]]
        assert "assets/skill/harness-authoring/asset.json" in paths
        assert "assets/skill/harness-authoring/SKILL.md" in paths
        # One commit, the harness file last, and nothing on anybody else's ref.
        assert len(fake.commits) == 1
        assert paths[-1] == f"harnesses/{w['harness']}.json"
        assert _wrote(fake, 0, f"harnesses/{w['harness']}.json")["assets"] == [PRESET_SKILL]


@requires_postgres
async def test_add_to_harness_skips_what_is_already_listed():
    """Adding what is there is nothing to do, not a refusal — and nothing to
    do is not a commit either (`joinHarness` pushes nothing)."""
    async with world() as w, fake_definitions({
        **_files(),
        ("c-dana", f"harnesses/{w['harness']}.json"): _mine(w, [w["asset"]]),
    }) as fake:
        result = await routes_writes.add_assets_to_harness(
            uuid.UUID(w["harness"]),
            routes_writes.AssetsIn(ids=[w["asset"]]),
            _request(w["connection"]),
            w["dana"],
            scope="me",
        )
        assert fake.commits == [] and result["commit"] == "c-dana" and result["added"] == []
        assert await _actions(w["connection"]) == []


@requires_postgres
async def test_add_to_harness_refuses_an_id_the_person_cannot_use():
    """`asset.unknown`: not on their chain and not bundled. Refused before the
    harness file is read, so nothing is written."""
    async with world() as w, fake_definitions({
        **_files(),
        ("c-dana", f"harnesses/{w['harness']}.json"): _mine(w),
    }) as fake:
        with pytest.raises(ApiError) as caught:
            await routes_writes.add_assets_to_harness(
                uuid.UUID(w["harness"]),
                routes_writes.AssetsIn(ids=[str(uuid.uuid4())]),
                _request(w["connection"]),
                w["dana"],
                scope="me",
            )
        assert caught.value.code == "asset.unknown" and caught.value.status_code == 404
        assert fake.commits == []


@requires_postgres
async def test_a_tool_brings_the_environment_its_sidecar_names():
    """W5-D15. `needs: [{ kind: "environment", name }]` on a tool adds the
    environment of that name from the same set, once, and the console says so
    before the write."""
    async with world() as w, fake_definitions({
        **_files(),
        ("c-dana", f"harnesses/{w['harness']}.json"): _mine(w),
    }) as fake:
        await _dana_holds_a_tool_that_needs_an_environment(w)
        result = await routes_writes.add_assets_to_harness(
            uuid.UUID(w["harness"]),
            routes_writes.AssetsIn(ids=[TOOL]),
            _request(w["connection"]),
            w["dana"],
            scope="me",
        )
        assert result["added"] == [TOOL, ENVIRONMENT]
        assert _wrote(fake, 0, f"harnesses/{w['harness']}.json")["assets"] == [TOOL, ENVIRONMENT]


@requires_postgres
async def test_a_new_harness_from_a_preset_copies_it_too():
    """*New harness from selection* takes the same path: `POST /v1/harnesses`
    with a preset id copies the directory onto the branch in the create
    commit, through the one helper."""
    async with world() as w, fake_definitions(_files()) as fake:
        result = await routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(name="From the store", assets=[PRESET_BRIEF]),
            _request(w["connection"]),
            w["dana"],
        )
        paths = [change["path"] for change in fake.commits[0]["changes"]]
        assert "assets/system_prompt/harness/asset.json" in paths
        assert "assets/system_prompt/harness/system_prompt.md" in paths
        assert len(fake.commits) == 1
        written = _wrote(fake, 0, f"harnesses/{result['id']}.json")
        assert written["assets"] == [PRESET_BRIEF]


@requires_postgres
async def test_a_team_harness_is_the_team_admins():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as caught:
            await routes_writes.edit_harness_on_ref(
                uuid.UUID(w["team_harness"]),
                routes_writes.HarnessPatch(name="Renamed"),
                _request(connection),
                w["dana"],
            )
        assert caught.value.message == "Changing a team harness is a team admin's decision."
        fake.files[("c-team", f"harnesses/{w['team_harness']}.json")] = {
            "id": w["team_harness"], "name": "Campaigns", "description": "", "assets": []
        }
        await routes_writes.edit_harness_on_ref(
            uuid.UUID(w["team_harness"]),
            routes_writes.HarnessPatch(name="Renamed"),
            _request(connection),
            w["rae"],
        )
        assert fake.changed()["name"] == "Renamed"
        await routes_writes.delete_harness_on_ref(
            uuid.UUID(w["team_harness"]), _request(connection), w["rae"]
        )
        assert fake.commits[1]["changes"] == [
            {"path": f"harnesses/{w['team_harness']}.json", "delete": True}
        ]
        assert await _actions(connection) == ["harness.update", "harness.delete"]


# --- requests ------------------------------------------------------------------


async def _offer(w, paths=("assets/skill/triage",)) -> uuid.UUID:
    body = await routes_requests.open_request(
        routes_requests.OpenRequest(
            title="Offer the triage skill",
            reasoning="It is ready.",
            subject={"kind": "promotion", "paths": list(paths), "commit": "c-dana"},
        ),
        _request(w["connection"]),
        w["dana"],
    )
    return uuid.UUID(body["id"])


@requires_postgres
async def test_accept_promotes_from_author_ref():
    """00 §4.11: the files are taken `from` the author's commit onto the team
    ref in one commit (engine 02 §5.3), and the request closes."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        request_id = await _offer(w, ("assets/skill/triage", "assets/memory/tone"))
        result = await routes_requests.accept_request(
            request_id, routes_requests.Decision(), _request(connection), w["rae"]
        )
        assert result["decision"] == "accepted"
        body = fake.commits[0]
        assert body["ref"] == TEAM_REF
        assert body["expectedHead"] == "c-team"
        assert body["reason"] == {"kind": "accept", "request": str(request_id)}
        assert body["changes"] == [
            {"path": "assets/skill/triage",
             "from": {"commit": "c-dana", "path": "assets/skill/triage"}},
            {"path": "assets/memory/tone",
             "from": {"commit": "c-dana", "path": "assets/memory/tone"}},
        ]
        row = await connection.fetchrow("select * from requests where id=$1", request_id)
        assert (row["state"], row["decision"]) == ("closed", "accepted")
        assert await _actions(connection) == ["request.open", "request.accept"]
        payload = await connection.fetchval(
            "select payload from audit_log where action='request.accept'"
        )
        assert (payload["author"], payload["n"]) == ("dana@acme.co", 2)

        with pytest.raises(ApiError) as caught:
            await routes_requests.accept_request(
                request_id, routes_requests.Decision(), _request(connection), w["rae"]
            )
        assert caught.value.code == "request.not_open"


@requires_postgres
async def test_member_accept_refused_names_admin():
    """04 §7's `PermissionNotCleared` sentence, from the API (P13)."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        request_id = await _offer(w)
        with pytest.raises(ApiError) as caught:
            await routes_requests.accept_request(
                request_id, routes_requests.Decision(), _request(connection), w["dana"]
            )
        assert caught.value.status_code == 403
        assert caught.value.message == (
            "Accepting a request publishes it to everyone on marketing, "
            "so a team admin decides it."
        )
        assert fake.commits == []
        assert await connection.fetchval("select state from requests where id=$1", request_id) == (
            "open"
        )


@requires_postgres
async def test_decline_records_reason():
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        request_id = await _offer(w)
        with pytest.raises(ApiError) as caught:
            await routes_requests.decline_request(
                request_id, routes_requests.Decision(reason="  "), _request(connection), w["rae"]
            )
        assert caught.value.detail["errors"][0]["field"] == "reason"

        await routes_requests.decline_request(
            request_id,
            routes_requests.Decision(reason="The tone file is the team's already."),
            _request(connection),
            w["rae"],
        )
        row = await connection.fetchrow("select * from requests where id=$1", request_id)
        assert (row["state"], row["decision"]) == ("closed", "declined")
        assert row["reason"] == "The tone file is the team's already."
        payload = await connection.fetchval(
            "select payload from audit_log where action='request.decline'"
        )
        assert payload["reason"] == "The tone file is the team's already."
        # Declining touches records only: no commit, and the ref is untouched.
        assert fake.commits == []


@requires_postgres
async def test_comments_are_the_teams_and_the_authors():
    async with world() as w, fake_definitions(_files()):
        connection = w["connection"]
        request_id = await _offer(w)
        comment = await routes_requests.comment_on_request(
            request_id,
            routes_requests.Comment(text="Can the tone file wait?"),
            _request(connection),
            w["rae"],
        )
        assert comment["text"] == "Can the tone file wait?"
        assert await connection.fetchval("select count(*) from request_comments") == 1


@requires_postgres
async def test_role_requests_listable():
    """04 §15's *Waiting on*: `?subject=role&state=open`, and D43's accept."""
    async with world() as w, fake_definitions(_files()):
        connection = w["connection"]
        opened = await routes_requests.open_request(
            routes_requests.OpenRequest(
                title="Ask to be a marketing admin",
                subject={"kind": "role", "level": "team-admin", "team": TEAM},
            ),
            _request(connection),
            w["dana"],
        )
        await _offer(w)
        waiting = await routes_writes.list_requests(
            _request(connection), w["ana"], subject="role", state="open"
        )
        assert [item["id"] for item in waiting["items"]] == [opened["id"]]
        assert waiting["items"][0]["author"] == "dana@acme.co"
        assert waiting["next"] is None
        # The author sees their own; both are theirs here.
        mine = await routes_writes.list_requests(_request(connection), w["dana"])
        assert len(mine["items"]) == 2

        # D43: appointing is the organisation's decision, even for the team's
        # own admin.
        with pytest.raises(ApiError) as caught:
            await routes_requests.accept_request(
                uuid.UUID(opened["id"]), routes_requests.Decision(),
                _request(connection), w["rae"],
            )
        assert caught.value.message.startswith("Appointing a team admin is an organisation")
        await routes_requests.accept_request(
            uuid.UUID(opened["id"]), routes_requests.Decision(), _request(connection), w["ana"]
        )
        assert await connection.fetchval(
            "select level from org_unit_admins where auth_user_id=$1 and org_unit_id=$2",
            w["dana"].auth_user_id,
            w["team"],
        ) == "admin"
        assert await routes_writes.list_requests(
            _request(connection), w["ana"], subject="role", state="open"
        ) == {"items": [], "next": None}


# --- people, teams and roles ----------------------------------------------------


@requires_postgres
async def test_org_unit_by_path_resolves():
    """The console's reads give paths (`Viewer.chain`), the records give ids;
    an org-unit route takes either."""
    async with world() as w, fake_definitions(_files()):
        connection = w["connection"]
        by_path = await routes_writes.set_visibility(
            TEAM, routes_writes.VisibilityIn(logs=False), _request(connection), w["ana"]
        )
        assert by_path == {"unit": TEAM, "visibility": {"logs": False}}
        by_id = await routes_writes.set_visibility(
            str(w["team"]), routes_writes.VisibilityIn(boundaries=False),
            _request(connection), w["ana"],
        )
        assert by_id["visibility"] == {"logs": False, "boundaries": False}
        with pytest.raises(ApiError) as caught:
            await routes_writes.set_visibility(
                "acme.nowhere", routes_writes.VisibilityIn(logs=True),
                _request(connection), w["ana"],
            )
        assert caught.value.code == "org_unit_not_found"


@requires_postgres
async def test_people_roles_and_membership_are_records():
    async with world() as w, fake_definitions(_files()):
        connection = w["connection"]
        await routes_writes.appoint_admin(
            TEAM, w["dana"].auth_user_id, routes_writes.RoleIn(),
            _request(connection), w["ana"],
        )
        assert await connection.fetchval(
            "select level from org_unit_admins where auth_user_id=$1", w["dana"].auth_user_id
        ) == "admin"
        await routes_writes.revoke_admin(
            TEAM, w["dana"].auth_user_id, _request(connection), w["ana"]
        )
        await routes_writes.set_person_state(
            w["dana"].auth_user_id, routes_writes.PersonIn(state="deactivated"),
            _request(connection), w["ana"],
        )
        assert await connection.fetchval(
            "select deactivated_at from org_unit_members where auth_user_id=$1",
            w["dana"].auth_user_id,
        ) is not None
        await routes_writes.set_person_state(
            w["dana"].auth_user_id, routes_writes.PersonIn(state="active"),
            _request(connection), w["ana"],
        )
        assert await connection.fetchval(
            "select deactivated_at from org_unit_members where auth_user_id=$1",
            w["dana"].auth_user_id,
        ) is None
        await routes_writes.remove_member(
            TEAM, w["dana"].auth_user_id, _request(connection), w["rae"]
        )
        assert await connection.fetchval(
            "select count(*) from org_unit_members where auth_user_id=$1", w["dana"].auth_user_id
        ) == 0
        assert await _actions(connection) == [
            "member.role", "member.role", "member.remove", "member.add", "member.remove"
        ]


# --- authorisation, endpoint by endpoint, role by role --------------------------


def _cases(w):
    """One refusal per endpoint per role that does not hold the verb (00 §4.11's
    role column, 04's sentences). Each is `(name, role, coroutine factory)`."""
    connection = w["connection"]
    request = _request(connection)
    grant = routes_writes.GrantIn(group="marketing", scope={"teams": [INTERNS]})
    boundary = routes_writes.BoundaryIn(scope={"teams": "all"}, kind="endpoint",
                                        value="x.example", reason="because")
    provider = routes_writes.HarnessProviderIn(
        approval="approved", pin={"binary": "pi", "minVersion": "1.0"},
        speaks=["anthropic-messages"])
    model = routes_writes.ModelProviderIn(endpoints={"anthropic-messages": "https://x"},
                                          models=["m"])
    routing = routes_writes.RoutingIn()
    group = routes_writes.GroupIn(name="new", entries=GROUP["entries"])
    for role in ("member", "team-admin"):
        who = w["dana"] if role == "member" else w["rae"]
        yield f"POST /v1/grants ({role})", (
            lambda who=who: routes_writes.create_grant(grant, request, who))
        yield f"POST /v1/groups ({role})", (
            lambda who=who: routes_writes.create_group(group, request, who))
        yield f"PATCH /v1/groups/name ({role})", (
            lambda who=who: routes_writes.edit_group(
                "marketing", routes_writes.GroupPatch(sources="vault"), request, who))
        yield f"PUT /v1/providers/harness ({role})", (
            lambda who=who: routes_writes.put_harness_provider("pi", provider, request, who))
        yield f"PUT /v1/providers/model ({role})", (
            lambda who=who: routes_writes.put_model_provider("anthropic", model, request, who))
        yield f"POST /v1/providers/model/id/setup ({role})", (
            lambda who=who: routes_writes.set_up_model_provider(
                "anthropic", routes_writes.SetupIn(key="a-key-that-is-long"), request, who))
        yield f"POST /v1/vaults ({role})", (
            lambda who=who: routes_writes.connect_vault(
                routes_writes.VaultIn(id="v", provider="aws"), request, who))
        yield f"DELETE /v1/vaults/id ({role})", (
            lambda who=who: routes_writes.disconnect_vault("bundled", request, who))
        yield f"POST /v1/vaults/id/secrets ({role})", (
            lambda who=who: routes_writes.paste_secret(
                "bundled", routes_writes.SecretIn(name="k", value="v"), request, who))
        yield f"POST /v1/vaults/id/secrets/ref/rotate ({role})", (
            lambda who=who: routes_writes.rotate_secret(
                "bundled", "secret://acme/crm", routes_writes.RotateIn(value="v"), request, who))
        yield f"PUT /v1/assets/id/loads ({role})", (
            lambda who=who: routes_writes.set_asset_loads(
                uuid.UUID(w["asset"]), routes_writes.LoadsIn(loads="always"), request, who))
        yield f"PUT /v1/org-units/id/admins/person ({role})", (
            lambda who=who: routes_writes.appoint_admin(
                TEAM, w["dana"].auth_user_id, routes_writes.RoleIn(), request, who))
        yield f"DELETE /v1/org-units/id/admins/person ({role})", (
            lambda who=who: routes_writes.revoke_admin(
                TEAM, w["dana"].auth_user_id, request, who))
        yield f"PATCH /v1/org-units/id/visibility ({role})", (
            lambda who=who: routes_writes.set_visibility(
                TEAM, routes_writes.VisibilityIn(logs=False), request, who))
        yield f"PATCH /v1/people/id ({role})", (
            lambda who=who: routes_writes.set_person_state(
                w["rae"].auth_user_id, routes_writes.PersonIn(state="deactivated"), request, who))
    # Member-only refusals: a team admin holds these at their own team.
    yield "POST /v1/boundaries (member)", (
        lambda: routes_writes.add_boundary(boundary, request, w["dana"]))
    yield "DELETE /v1/boundaries/id (member)", (
        lambda: routes_writes.remove_boundary(f"{TEAM}/b-team", request, w["dana"]))
    yield "PUT /v1/routing (member)", (
        lambda: routes_writes.put_routing(routing, request, w["dana"]))
    yield "POST /v1/harnesses at a team (member)", (
        lambda: routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(name="Team's", scope=TEAM), request, w["dana"]))
    yield "PATCH /v1/harnesses/id (member)", (
        lambda: routes_writes.edit_harness_on_ref(
            uuid.UUID(w["team_harness"]), routes_writes.HarnessPatch(name="x"),
            request, w["dana"]))
    yield "DELETE /v1/harnesses/id (member)", (
        lambda: routes_writes.delete_harness_on_ref(
            uuid.UUID(w["team_harness"]), request, w["dana"]))
    yield "DELETE /v1/org-units/id/members/person (member)", (
        lambda: routes_writes.remove_member(TEAM, w["rae"].auth_user_id, request, w["dana"]))


@requires_postgres
async def test_every_write_refuses_the_role_that_does_not_hold_it():
    """00 §4.11's role column, one case per endpoint per role, and P13: every
    message names who decides."""
    async with world() as w, fake_definitions(_files()) as fake:
        for name, call in _cases(w):
            with pytest.raises(ApiError) as caught:
                await call()
            assert caught.value.status_code == 403, name
            assert "admin" in caught.value.message, f"{name} does not name who decides"
        assert fake.commits == []
        assert await _actions(w["connection"]) == []


@requires_postgres
async def test_member_may_ask_and_may_comment():
    """The other half of the table: what a member *does* hold (04 §7, §15)."""
    async with world() as w, fake_definitions(_files()):
        connection = w["connection"]
        request_id = await _offer(w)
        await routes_requests.comment_on_request(
            request_id, routes_requests.Comment(text="ready when you are"),
            _request(connection), w["dana"],
        )
        await routes_requests.withdraw_request(request_id, _request(connection), w["dana"])
        harness = await routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(name="Mine too"), _request(connection), w["dana"]
        )
        assert harness["ref"].endswith(str(w["dana"].auth_user_id))


@requires_postgres
async def test_a_sub_team_takes_the_consoles_body_or_the_records_one():
    """00 §4.11's `{ kind: "team", parent, members }`, and the legacy body, at
    the one route that creates a node and its branch together (02 §5.3)."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        created = await routes_writes.create_org_unit(
            routes_writes.TeamIn(kind="team", parent=TEAM, name="Events",
                                 members=["sam@acme.co"]),
            _request(connection),
            w["rae"],
        )
        assert created["path"] == "acme.marketing.events"
        assert created["invited"] == ["sam@acme.co"]
        assert fake.branches[0]["ref"] == "refs/heads/teams/acme.marketing.events"
        # The records form still works, by parent id.
        legacy = await routes_writes.create_org_unit(
            routes_writes.TeamIn(parent_id=w["team"], role="team", name="Brand"),
            _request(connection),
            w["rae"],
        )
        assert legacy["path"] == "acme.marketing.brand"
        # And inviting names who decides.
        with pytest.raises(ApiError) as caught:
            await routes_writes.invite(
                routes_writes.InviteIn(team=TEAM, email="jo@acme.co"),
                _request(connection),
                w["dana"],
            )
        assert caught.value.message == "Inviting is a team admin's decision."
        await routes_writes.invite(
            routes_writes.InviteIn(team=TEAM, email="jo@acme.co"),
            _request(connection),
            w["rae"],
        )
        assert await connection.fetchval("select count(*) from org_invites") == 2


# --- the envelope ----------------------------------------------------------------


def test_unknown_route_returns_envelope():
    """03 D30: one envelope everywhere, an unrouted path included."""
    with TestClient(create_app(pool=object())) as client:
        response = client.get("/v1/nothing-here")
        assert response.status_code == 404
        body = response.json()
        assert body["code"] == "not_found"
        assert body["message"] == "There is nothing at /v1/nothing-here."
        assert body["remedy"]
        assert body["detail"] == {}
        assert set(body) == {"code", "message", "remedy", "detail"}

        wrong_method = client.delete("/v1/grants")
        assert wrong_method.status_code == 405
        assert wrong_method.json()["code"] == "method_not_allowed"


def test_the_legacy_harness_writes_are_gone_and_the_paths_remain():
    """00 §4.11: a harness is a file on a ref, not a row. The replaced
    handlers are dropped so one shape per path reaches `openapi.json`."""
    paths = create_app(pool=object()).openapi()["paths"]
    assert set(paths["/v1/harnesses"]) == {"post"}
    assert set(paths["/v1/harnesses/{harness_id}"]) == {"get", "patch", "delete"}
    for path in ("/v1/grants", "/v1/boundaries", "/v1/groups", "/v1/routing", "/v1/vaults",
                 "/v1/assets/{asset_id}/loads", "/v1/requests/{request_id}/accept",
                 "/v1/requests/{request_id}/decline", "/v1/requests/{request_id}/comments",
                 "/v1/org-units/{id_or_path}/visibility", "/v1/people/{person_id}"):
        assert path in paths, path


# --- POST /v1/providers/model/{id}/setup (00 §4.10, console 04 §10) ---------


def _wrote(fake, index: int, path: str) -> object:
    """The body a commit wrote at one path."""
    change = next(c for c in fake.commits[index]["changes"] if c["path"] == path)
    return json.loads(base64.b64decode(change["blob"]))


@requires_postgres
async def test_setting_up_a_model_key_is_one_commit_over_four_files():
    """The vault entry, the group, its grant and the organisation's routing
    default in one write, with the key in none of them."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        result = await routes_writes.set_up_model_provider(
            "anthropic",
            routes_writes.SetupIn(key="sk-not-a-real-key", model="claude-opus-5"),
            _request(connection),
            w["ana"],
        )
        assert result == {"commit": "c-new-1", "ref": ORG_REF, "default": True}
        assert len(fake.commits) == 1
        assert {change["path"] for change in fake.commits[0]["changes"]} == {
            "policy/groups.json", "policy/grants.json",
            "policy/model-providers.json", "policy/routing.json",
        }
        ref = "model-keys/acme/anthropic"
        group = next(g for g in _wrote(fake, 0, "policy/groups.json") if g["name"] == "model-keys")
        assert group["sources"] == "vault"
        assert group["entries"] == [{
            "alias": "anthropic",
            "secret": {"vault": "bundled", "ref": ref},
            "upstream": "https://api.anthropic.com",
            "attach": {"header": "x-api-key", "prefix": ""},
        }]
        assert {g["id"] for g in _wrote(fake, 0, "policy/grants.json")} == {
            "g-marketing", "model-keys"}
        provider = _wrote(fake, 0, "policy/model-providers.json")[0]
        assert provider["credential"] == {"alias": "anthropic"}
        assert provider["models"] == ["claude-sonnet-5", "claude-opus-5"]
        routing = _wrote(fake, 0, "policy/routing.json")
        assert routing["defaultFor"]["teams"] == {ORG: "anthropic"}
        assert routing["approvedFor"]["teams"] == {TEAM: ["anthropic"], ORG: ["anthropic"]}
        # The value is in the vault and nowhere else.
        assert await connection.fetchval(
            "select count(*) from api_key_versions v join api_keys k on k.id=v.api_key_id"
            " where k.ref=$1", ref) == 1
        assert await _actions(connection) == ["provider.key_setup"]


@requires_postgres
async def test_a_setup_key_never_reaches_the_commit_or_the_log():
    """The one property the modal promises: `key` is stored and referenced,
    never written. Also §5.6 — no event exists while `definitions` is called."""
    key = "sk-nobody-should-ever-see-this"

    async with world() as w:
        connection = w["connection"]

        async def audit_rows():
            return await connection.fetchval("select count(*) from audit_log")

        async with fake_definitions(_files(), probe=audit_rows) as fake:
            await routes_writes.set_up_model_provider(
                "anthropic",
                routes_writes.SetupIn(key=key),
                _request(connection),
                w["ana"],
            )
        assert fake.probed == [0]
        assert key not in json.dumps(fake.commits[0])
        payloads = json.dumps([dict(row["payload"]) for row in await connection.fetch(
            "select payload from audit_log")])
        assert key not in payloads
        assert json.loads(payloads)[0]["default"] is True


@requires_postgres
async def test_a_second_provider_does_not_take_the_default():
    """D30i: the organisation's line is written once. The second key is
    approved for everyone and changes nobody's default."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        request = _request(connection)
        await routes_writes.put_model_provider(
            "openai",
            routes_writes.ModelProviderIn(
                endpoints={"openai-completions": "https://api.openai.com/v1"}, models=[]),
            request,
            w["ana"],
        )
        first = await routes_writes.set_up_model_provider(
            "anthropic", routes_writes.SetupIn(key="a-first-key"), request, w["ana"])
        second = await routes_writes.set_up_model_provider(
            "openai", routes_writes.SetupIn(key="a-second-key"), request, w["ana"])
        assert first["default"] is True and second["default"] is False
        routing = _wrote(fake, 2, "policy/routing.json")
        assert routing["defaultFor"]["teams"][ORG] == "anthropic"
        assert routing["approvedFor"]["teams"][ORG] == ["anthropic", "openai"]
        # One group, two entries; one grant, written once.
        group = next(g for g in _wrote(fake, 2, "policy/groups.json") if g["name"] == "model-keys")
        assert [entry["alias"] for entry in group["entries"]] == ["anthropic", "openai"]
        assert [entry["upstream"] for entry in group["entries"]] == [
            "https://api.anthropic.com", "https://api.openai.com"]
        assert "policy/grants.json" not in {c["path"] for c in fake.commits[2]["changes"]}


@requires_postgres
async def test_on_a_personal_account_set_up_is_the_whole_model_story():
    """W7-D3: one *Set up* leaves nothing else to do. The same commit carries
    the key's group entry, the grant that reaches the person (`teams: "all"`,
    which is the only scope a chain with no team node can be covered by), the
    provider's credential, and the organisation's default **and** approval —
    so the Account list's *a model* row is ticked and the first-harness modal
    has something to name."""
    async with personal_world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        result = await routes_writes.set_up_model_provider(
            "anthropic", routes_writes.SetupIn(key="a-first-key"), _request(connection), w["kit"])
        assert result["default"] is True
        assert len(fake.commits) == 1  # D9: one commit, not four
        wrote = {change["path"] for change in fake.commits[0]["changes"]}
        assert wrote == {"policy/groups.json", "policy/model-providers.json",
                         "policy/grants.json", "policy/routing.json"}
        routing = _wrote(fake, 0, "policy/routing.json")
        assert routing["defaultFor"]["teams"] == {"kit": "anthropic"}
        assert routing["approvedFor"]["teams"]["kit"] == ["anthropic"]
        grant = next(g for g in _wrote(fake, 0, "policy/grants.json")
                     if g["group"] == "model-keys")
        assert grant["scope"] == {"teams": "all"}
        # The grant reaches this person: an org·user chain with no team node is
        # covered by `teams: "all"` and by nothing else (`broker.covers` row 1).
        chain = [{"path": "kit", "kind": "org"}, {"path": "kit.kit", "kind": "user"}]
        assert broker.covers(grant["scope"], chain, None) is True


@requires_postgres
async def test_a_personal_second_key_becomes_the_default():
    """W7-D3 against D30i, side by side. D30i protects an organisation's
    standing choice from the next admin who pastes a key; a personal account
    has one person and nowhere else to set a default, so *Set up* **is** that
    choice being made and the newest key wins."""
    async with personal_world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        request = _request(connection)
        await routes_writes.put_model_provider(
            "openai",
            routes_writes.ModelProviderIn(
                endpoints={"openai-completions": "https://api.openai.com/v1"}, models=[]),
            request, w["kit"])
        first = await routes_writes.set_up_model_provider(
            "anthropic", routes_writes.SetupIn(key="a-first-key"), request, w["kit"])
        second = await routes_writes.set_up_model_provider(
            "openai", routes_writes.SetupIn(key="a-second-key"), request, w["kit"])
        assert first["default"] is True and second["default"] is True
        routing = _wrote(fake, 2, "policy/routing.json")
        assert routing["defaultFor"]["teams"]["kit"] == "openai"
        assert routing["approvedFor"]["teams"]["kit"] == ["anthropic", "openai"]


@requires_postgres
async def test_setting_up_a_provider_the_organisation_does_not_hold_is_a_404():
    async with world() as w, fake_definitions(_files()) as fake:
        with pytest.raises(ApiError) as caught:
            await routes_writes.set_up_model_provider(
                "openrouter",
                routes_writes.SetupIn(key="a-key-that-is-long"),
                _request(w["connection"]),
                w["ana"],
            )
        assert caught.value.status_code == 404
        assert caught.value.code == "model_provider_unknown"
        assert "Add a model provider" in caught.value.remedy
        # Nothing was stored and nothing was committed.
        assert fake.commits == []
        assert await w["connection"].fetchval("select count(*) from api_keys") == 0


@requires_postgres
async def test_setup_refuses_a_row_that_already_has_a_credential():
    """00 §4.10: a second alias on one provider ties in the broker's
    precedence, so the row is refused before the vault is written."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        request = _request(connection)
        await routes_writes.set_up_model_provider(
            "anthropic", routes_writes.SetupIn(key="a-first-key"), request, w["ana"])
        with pytest.raises(ApiError) as caught:
            await routes_writes.set_up_model_provider(
                "anthropic", routes_writes.SetupIn(key="a-second-key"), request, w["ana"])
        assert caught.value.status_code == 409
        assert caught.value.code == "provider.credential_exists"
        assert "Rotate it on Key vaults" in caught.value.message
        # The first key is still the only one in the vault, and nothing else committed.
        assert len(fake.commits) == 1
        assert await connection.fetchval("select count(*) from api_keys") == 1


# --- reach (W5-D1, W5-D5) ---------------------------------------------------


@requires_postgres
async def test_reach_is_set_at_the_scope_and_only_by_its_admin():
    """D131. Four routes over one file, and each names who decides."""
    async with world() as w, fake_definitions(_files()) as fake:
        connection = w["connection"]
        result = await routes_writes.set_reach(
            routes_writes.ReachIn(mode="allow", hosts=["pypi.org", "files.pythonhosted.org"]),
            _request(connection), w["ana"], scope="org",
        )
        assert result == {"commit": "c-new-1", "ref": ORG_REF}
        assert [change["path"] for change in fake.commits[0]["changes"]] == ["policy/reach.json"]
        assert fake.changed() == {"mode": "allow",
                                  "hosts": ["pypi.org", "files.pythonhosted.org"]}
        assert await _actions(connection) == ["reach.set"]

        # A team admin sets their own team's, and nobody else's.
        await routes_writes.set_reach(
            routes_writes.ReachIn(mode="allow", hosts=["pypi.org"]),
            _request(connection), w["rae"], scope=f"team:{TEAM}",
        )
        assert fake.commits[1]["ref"] == TEAM_REF
        with pytest.raises(ApiError) as caught:
            await routes_writes.set_reach(
                routes_writes.ReachIn(mode="on", hosts=[]),
                _request(connection), w["dana"], scope="org",
            )
        assert caught.value.status_code == 403 and caught.value.code == "reach.not_yours"
        assert "Reach only ever narrows" in caught.value.message


@requires_postgres
async def test_a_host_is_not_a_pattern_we_cannot_match():
    """D133's matching rule as the shape a person may type: no CIDR, no port,
    no regex — because the tunnel matches an exact name or a `*.suffix`."""
    async with world() as w, fake_definitions(_files()):
        for bad in ("10.0.0.0/8", "pypi.org:443", "not a host"):
            with pytest.raises(ApiError) as caught:
                await routes_writes.set_reach(
                    routes_writes.ReachIn(mode="allow", hosts=[bad]),
                    _request(w["connection"]), w["ana"], scope="org",
                )
            assert caught.value.code == "invalid_request"


@requires_postgres
async def test_allow_adds_to_an_allow_list_and_takes_off_a_deny_list():
    """The Endpoints tab's **Allow** is one wish — *let this through* — and the
    person should not have to know which mode the node is in (W5-D4)."""
    async with world() as w, fake_definitions(
        {**_files(), ("c-org", "policy/reach.json"): {"mode": "allow", "hosts": ["pypi.org"]}}
    ) as fake:
        connection = w["connection"]
        await routes_writes.allow_host(
            routes_writes.HostIn(host="registry.npmjs.org"),
            _request(connection), w["ana"], scope="org",
        )
        assert fake.changed() == {"mode": "allow", "hosts": ["pypi.org", "registry.npmjs.org"]}
        with pytest.raises(ApiError) as caught:
            await routes_writes.allow_host(
                routes_writes.HostIn(host="pypi.org"), _request(connection), w["ana"], scope="org")
        assert caught.value.code == "reach.host_present"

    async with world() as w, fake_definitions(
        {**_files(),
         ("c-org", "policy/reach.json"): {"mode": "on", "hosts": ["evil.example", "x.example"]}}
    ) as fake:
        await routes_writes.allow_host(
            routes_writes.HostIn(host="evil.example"),
            _request(w["connection"]), w["ana"], scope="org",
        )
        assert fake.changed() == {"mode": "on", "hosts": ["x.example"]}


@requires_postgres
async def test_a_host_cannot_be_allowed_where_reach_is_off():
    """W5-D4's third state: there is no list to put it on, and the sentence
    says where to go instead."""
    async with world() as w, fake_definitions(_files()):
        with pytest.raises(ApiError) as caught:
            await routes_writes.allow_host(
                routes_writes.HostIn(host="pypi.org"),
                _request(w["connection"]), w["ana"], scope="org",
            )
        assert caught.value.status_code == 403 and caught.value.code == "reach.off"
        assert "Boundaries → Reach" in caught.value.message


@requires_postgres
async def test_deny_takes_a_host_off_an_allow_list():
    async with world() as w, fake_definitions(
        {**_files(),
         ("c-org", "policy/reach.json"): {"mode": "allow", "hosts": ["pypi.org", "crates.io"]}}
    ) as fake:
        connection = w["connection"]
        await routes_writes.deny_host("crates.io", _request(connection), w["ana"], scope="org")
        assert fake.changed() == {"mode": "allow", "hosts": ["pypi.org"]}
        assert await _actions(connection) == ["reach.deny_host"]
        with pytest.raises(ApiError) as caught:
            await routes_writes.deny_host("crates.io", _request(connection), w["ana"],
                                          scope="org")
        assert caught.value.code == "reach.host_absent"


@requires_postgres
async def test_a_grant_no_longer_carries_reach():
    """D132: `Grant.reach` is retired, so the field is gone from the write and
    a grant that names no group is refused where it used to be accepted."""
    async with world() as w, fake_definitions(_files()):
        assert "reach" not in routes_writes.GrantIn.model_fields
        with pytest.raises(ApiError) as caught:
            await routes_writes.create_grant(
                routes_writes.GrantIn(scope={"teams": [TEAM]}),
                _request(w["connection"]), w["ana"],
            )
        assert caught.value.code == "invalid_request"
