"""Creating a node creates its branch (02 §5.3, 00 §4.10, D30f, D6).

Every creation path in `api` that adds an org, a team or a user to the records
calls `definitions` before its transaction commits, so **a node that has no
branch does not exist**. These tests drive the real route handlers against a
real scratch Postgres — the rollback they assert is a real rollback — and stand
a fake `definitions` at the network edge, which is the one place 10 rule 17
permits a mock. Its shape is 02 §5.3's table: path, bearer, body, status.

The route functions are called in-process rather than over HTTP for the reason
`test_resolve.py` gives: a real client needs a second event loop, which the
scratch connection would not survive.
"""

import base64
import json
import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest

# The scratch-database harness (docs/archive/scoping.md §9.1), reused so the routes run
# against a real query planner and a real transaction.
from test_resolve import (  # type: ignore[import-not-found]
    ConnectionPool,
    _all_migrations,
    _request,
    requires_postgres,
    scratch_db,
)

from app.api import routes_auth, routes_console, routes_org_units
from app.config import get_settings
from app.domain import audit, console, definitions_client, seed
from app.errors import ApiError
from app.identity import Principal

SERVICE_TOKEN = "service-token-for-tests"
DEFINITIONS_URL = "http://definitions.test"
os.environ["HARNESS_SERVICE_TOKEN"] = SERVICE_TOKEN
os.environ["DEFINITIONS_URL"] = DEFINITIONS_URL
# W7-D1. Named here rather than taken from `backend/.env`, which pytest's
# working directory would otherwise hand these tests: the gate is proved
# against a code this file owns, so the deployment's own value cannot make a
# wrong-code test pass.
SIGNUP_CODE = "open-sesame"
os.environ["HARNESS_SIGNUP_CODE"] = SIGNUP_CODE
get_settings.cache_clear()


def _signup(**fields) -> routes_org_units.OrgCreate:
    """A sign-up that carries the access code. Every creation path below is
    about what is created, not about the door; the door has its own tests."""
    return routes_org_units.OrgCreate(code=SIGNUP_CODE, **fields)


class FakeDefinitions:
    """`POST /internal/orgs`, `/internal/branches` and `/internal/commit`.

    Records every call in order, because the order is part of the contract: a
    branch cannot be created in a repository that does not exist yet, and the
    seed commit is the last call of all (§5.6).
    """

    def __init__(self, *, unreachable: bool = False, probe=None) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.unreachable = unreachable
        # Run against the caller's own connection while its transaction is open
        # and suspended on this request — the only moment the ordering of §5.6
        # is observable.
        self.probe = probe
        self.probed: list = []

    async def handle(self, request: httpx.Request) -> httpx.Response:
        if self.unreachable:
            raise httpx.ConnectError("connection refused", request=request)
        if self.probe is not None:
            self.probed.append(await self.probe())
        # D42: the shared bearer, never a person's token.
        assert request.headers["authorization"] == f"Bearer {SERVICE_TOKEN}"
        assert str(request.url).startswith(DEFINITIONS_URL)
        path = request.url.path
        body = json.loads(request.content or b"{}")
        self.calls.append((path, body))
        if path == "/internal/orgs":
            assert set(body) == {"org_id", "node_path"}, body
            # The org branch's root commit: `expectedHead` for the seed, because
            # nothing has indexed `refs/heads/org` yet.
            return httpx.Response(201, json={"org": body["org_id"], "commit": "r" * 40})
        if path == "/internal/branches":
            assert set(body) == {"org_id", "ref", "node_path"}, body
            return httpx.Response(201, json={"commit": "0" * 40})
        if path == "/internal/commit":
            return httpx.Response(200, json={"commit": "1" * 40})
        return httpx.Response(404, json={})

    @property
    def seed(self) -> dict:
        """The one `CommitRequest` `POST /v1/orgs` makes (D30h)."""
        return next(body for path, body in self.calls if path == "/internal/commit")

    @property
    def refs(self) -> list[str]:
        return [body["ref"] for path, body in self.calls if path == "/internal/branches"]


@asynccontextmanager
async def fake_definitions(**kwargs):
    """Point the client's transport at the fake for the duration of one test."""
    fake = FakeDefinitions(**kwargs)
    definitions_client.transport = httpx.MockTransport(fake.handle)
    try:
        yield fake
    finally:
        definitions_client.transport = None


@asynccontextmanager
async def world():
    """A scratch database with a login in it and no organization yet."""
    async with scratch_db(_all_migrations()) as connection:
        # `append_event`'s partition memo is module-level; a second scratch
        # database in the same process would otherwise inherit a partition it
        # does not have.
        audit._PARTITIONED.clear()
        person = uuid.uuid4()
        await connection.execute(
            "insert into auth.users(id,email) values ($1,$2)", person, "dana@acme.co"
        )
        yield connection, person


async def _units(connection) -> int:
    return await connection.fetchval("select count(*) from org_units")


@requires_postgres
async def test_org_creation_calls_definitions():
    """02 §5.3: the repo, then the team ref, then the person's user ref."""
    async with world() as (connection, person), fake_definitions() as fake:
        body = await routes_org_units.create_org(
            _signup(org_name="Acme", team_name="Marketing"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        org_id = str(body["id"])

        assert [path for path, _ in fake.calls] == [
            "/internal/orgs",
            "/internal/branches",
            "/internal/branches",
            # D30h, and §5.6: the seed is a `definitions` call, so it comes last.
            "/internal/commit",
        ]
        # The dotted org path travels with the id; nothing is derived from refs.
        assert fake.calls[0][1] == {"org_id": org_id, "node_path": "acme"}
        assert fake.calls[1][1] == {
            "org_id": org_id,
            "ref": "refs/heads/teams/acme.marketing",
            "node_path": "acme.marketing",
        }
        assert fake.calls[2][1] == {
            "org_id": org_id,
            "ref": f"refs/heads/users/{person}",
            "node_path": "acme.marketing.danaacmeco",
        }


@requires_postgres
async def test_definitions_is_called_before_the_org_chain_is_locked():
    """`append_event` holds `audit_log_latest_hashes` for the org `for update`
    until the transaction ends (C34, one writer), and `POST /internal/branches`
    makes `definitions` call `api` straight back with `definitions.push` on that
    same chain (02 §12). Appending first is therefore a self-deadlock that only
    the client's timeout breaks — observed against the real service, and the
    reason every creation path here calls `definitions` before it audits.

    The probe runs while the handler is suspended on the request: no event, and
    so no lock, exists yet.
    """
    async with world() as (connection, person):
        async def audit_rows():
            return await connection.fetchval("select count(*) from audit_log")

        async with fake_definitions(probe=audit_rows) as fake:
            await routes_org_units.create_org(
                _signup(org_name="Acme", team_name="Marketing"),
                _request(connection),
                Principal(person, "dana@acme.co"),
            )
        assert fake.probed == [0, 0, 0, 0], fake.probed
        # The seed's own event and the org's: both after the last call out.
        assert await connection.fetchval("select count(*) from audit_log") == 2


@requires_postgres
async def test_user_node_creates_user_ref():
    """Both paths that add a person: an admin adding a member, and a person
    accepting an invite. A user ref is keyed by the login id (02 §5.3), never
    by the path, which is why a user unit with no member row has no branch."""
    async with world() as (connection, person), fake_definitions() as fake:
        await routes_org_units.create_org(
            _signup(org_name="Acme", team_name="Marketing"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        org_id = str(await connection.fetchval("select id from org_units where role='org'"))
        team_id = await connection.fetchval("select id from org_units where role='team'")
        await connection.execute(
            "insert into org_unit_admins(auth_user_id,org_unit_id,level) values ($1,$2,'owner')",
            person,
            team_id,
        )

        # 1. An admin adds a member.
        added = uuid.uuid4()
        await connection.execute(
            "insert into auth.users(id,email) values ($1,$2)", added, "rae@acme.co"
        )
        fake.calls.clear()
        await routes_org_units.add_member(
            team_id,
            routes_org_units.MemberCreate(auth_user_id=added, name="Rae"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        assert fake.calls == [
            (
                "/internal/branches",
                {
                    "org_id": org_id,
                    "ref": f"refs/heads/users/{added}",
                    "node_path": "acme.marketing.rae",
                },
            )
        ]

        # 2. A person accepts an invite, which is the other way a user node
        #    comes into being (`routes_auth.me` → `accept_pending_invite`).
        invited = uuid.uuid4()
        await connection.execute(
            "insert into auth.users(id,email) values ($1,$2)", invited, "sam@acme.co"
        )
        await connection.execute(
            "insert into org_invites(team_unit_id,email,invited_by) values ($1,$2,$3)",
            team_id,
            "sam@acme.co",
            person,
        )
        fake.calls.clear()
        await routes_auth.me(_request(connection), Principal(invited, "sam@acme.co"))
        assert fake.refs == [f"refs/heads/users/{invited}"]
        assert fake.calls[0][1]["node_path"] == "acme.marketing.samacmeco"


@requires_postgres
async def test_personal_signup_is_org_plus_user():
    """D30f and 02 §5.3's personal-edition row: `api` creates the org repo and
    the person's user ref in one call sequence; **there is no team ref**, and
    the chain the repository holds is `org · user`."""
    async with world() as (connection, person), fake_definitions() as fake:
        body = await routes_org_units.create_org(
            _signup(org_name="Dana", personal=True),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        org_id = str(body["id"])
        assert [path for path, _ in fake.calls] == [
            "/internal/orgs",
            "/internal/branches",
            "/internal/commit",
        ]
        assert fake.calls[0][1] == {"org_id": org_id, "node_path": "dana"}
        assert fake.calls[1][1] == {
            "org_id": org_id,
            "ref": f"refs/heads/users/{person}",
            # `org · user`: the records-only team segment is not in it.
            "node_path": "dana.danaacmeco",
        }
        assert not any(ref.startswith("refs/heads/teams/") for ref in fake.refs)


@requires_postgres
async def test_definitions_unreachable_fails_creation():
    """Fail closed (D6, I5's shape): a node that has no branch must not exist.

    The call is made inside the creating transaction, so an unreachable service
    rolls back the org, the team, the user unit, the membership, the ownership
    grant and the audit row together — the records are exactly as they were.
    """
    async with world() as (connection, person):
        before = await _units(connection)
        async with fake_definitions(unreachable=True):
            with pytest.raises(ApiError) as caught:
                await routes_org_units.create_org(
                    _signup(org_name="Acme"),
                    _request(connection),
                    Principal(person, "dana@acme.co"),
                )
        assert caught.value.status_code == 503
        assert caught.value.code == "definitions_unreachable"
        assert await _units(connection) == before
        assert await connection.fetchval("select count(*) from org_unit_members") == 0

        # The same rule for a team: `POST /org-units` writes nothing if the
        # branch cannot be made.
        async with fake_definitions():
            await routes_org_units.create_org(
                _signup(org_name="Acme", team_name="Marketing"),
                _request(connection),
                Principal(person, "dana@acme.co"),
            )
            org_id = await connection.fetchval("select id from org_units where role='org'")
        settled = await _units(connection)
        async with fake_definitions(unreachable=True):
            with pytest.raises(ApiError) as caught:
                await routes_org_units.create_org_unit(
                    routes_org_units.OrgUnitCreate(parent_id=org_id, role="team", name="Eng"),
                    _request(connection),
                    Principal(person, "dana@acme.co"),
                )
        assert caught.value.code == "definitions_unreachable"
        assert await _units(connection) == settled


@requires_postgres
async def test_a_node_with_no_ref_shape_is_refused_before_it_is_written():
    """02 §5.3 has one ref shape per kind of node, and two shapes do not exist:
    a repository holds exactly one `refs/heads/org`, and a user's ref is named
    by a login that `POST /org-units` never carries. Both are refused rather
    than written as a node nothing can compose."""
    async with world() as (connection, person), fake_definitions() as fake:
        await routes_org_units.create_org(
            _signup(org_name="Acme", team_name="Marketing"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        org_id = await connection.fetchval("select id from org_units where role='org'")
        team_id = await connection.fetchval("select id from org_units where role='team'")
        settled = await _units(connection)
        fake.calls.clear()

        for parent, role, code in [
            (org_id, "org", "nested_org_has_no_branch"),
            (team_id, "user", "user_unit_needs_member"),
        ]:
            with pytest.raises(ApiError) as caught:
                await routes_org_units.create_org_unit(
                    routes_org_units.OrgUnitCreate(parent_id=parent, role=role, name="Nope"),
                    _request(connection),
                    Principal(person, "dana@acme.co"),
                )
            assert caught.value.code == code
        assert fake.calls == []
        assert await _units(connection) == settled


@requires_postgres
async def test_an_unconfigured_definitions_url_is_not_permission_to_skip_it():
    """No `DEFINITIONS_URL` is a deployment that cannot create a branch, which
    is refused — not a deployment that creates nodes without one."""
    async with world() as (connection, person), fake_definitions():
        before = await _units(connection)
        os.environ.pop("DEFINITIONS_URL")
        try:
            with pytest.raises(ApiError) as caught:
                await routes_org_units.create_org(
                    _signup(org_name="Acme"),
                    _request(connection),
                    Principal(person, "dana@acme.co"),
                )
        finally:
            os.environ["DEFINITIONS_URL"] = DEFINITIONS_URL
        assert caught.value.code == "definitions_unconfigured"
        assert await _units(connection) == before


def _seeded(fake) -> dict:
    """The seed commit's policy files, path → body. The asset files beside them
    are bytes, not bodies (D30j), and are read by the tests below."""
    return {
        change["path"]: json.loads(base64.b64decode(change["blob"]))
        for change in fake.seed["changes"]
        if change["path"].startswith("policy/")
    }


SKILL = "assets/skill/harness-authoring/SKILL.md"
AUTHORING = "0460b220-8379-5ddf-82ef-31bc0e8a99e1"
# W5-D11: the default brief, a `system_prompt` preset, seeded as recommended.
BRIEF = "7b1f5c94-2d0a-5e63-9c18-4a6d3f0b28c7"


def _changes(edition: str, existing: dict | None = None) -> dict[str, bytes]:
    return {
        change["path"]: base64.b64decode(change["blob"])
        for change in seed.seed_files(edition, existing)
    }


def test_seed_commits_the_built_in_skill_and_lists_it_always_loaded():
    """D30j: the skill ships as data, so the seed carries the directory itself
    and names its id — the same in both editions, because the seam it describes
    is the same one."""
    source = (seed.PRESETS / "assets" / "skill" / "harness-authoring" / "SKILL.md").read_bytes()
    for edition in ("enterprise", "personal"):
        changes = _changes(edition)
        # Verbatim: the branch carries the preset's bytes, not a re-serialised
        # copy of something parsed on the way through.
        assert changes[SKILL] == source
        assert json.loads(changes["assets/skill/harness-authoring/asset.json"])["id"] == AUTHORING
        # W5-D10: two lists. The skill is required; the default brief is
        # recommended, so a new harness starts with it and may drop it.
        loaded = json.loads(changes["policy/always-loaded.json"])
        assert loaded["required"] == [AUTHORING]
        assert BRIEF in loaded["recommended"]


def test_seed_never_overwrites_a_held_asset():
    """Filling is by id: an organization that edited the skill keeps its copy,
    and one whose own asset happens to share the directory is not renamed into
    `always-loaded.json` under an id it does not carry."""
    held = _changes("enterprise", {"assets/skill/harness-authoring/asset.json": {"id": AUTHORING},
                                   SKILL: b"# ours\n"})
    assert SKILL not in held
    assert AUTHORING in json.loads(held["policy/always-loaded.json"])["required"]

    theirs = _changes("enterprise", {"assets/skill/harness-authoring/asset.json": {"id": str(
        uuid.uuid4())}})
    assert SKILL not in theirs
    assert AUTHORING not in json.loads(theirs["policy/always-loaded.json"])["required"]


# W6-D2: the manifest is the list. These three read `presets/index.json` rather
# than naming files, so a default added to the manifest is seeded (or refused)
# without a line here, and one added to `presets/` without an entry is not.

SHAPES = {
    # The policy files that hold no default: three are the empty shape every
    # branch carries, and `always-loaded.json` is derived from the asset
    # entries' `managed` words rather than being a preset of its own.
    "policy/routing.json",
    "policy/groups.json",
    "policy/grants.json",
    "policy/always-loaded.json",
}


def _wanted(edition: str) -> set[str]:
    """What the manifest says a new organization of this edition holds."""
    wanted: set[str] = set()
    for entry in seed.defaults("required", "recommended"):
        path = entry["path"]
        if path.startswith("assets/"):
            wanted |= set(seed.preset_assets()[path])
        elif entry["id"].startswith(seed.REACH_DEFAULT):
            if entry["id"] == f"{seed.REACH_DEFAULT}{edition}":
                wanted.add("policy/reach.json")
        else:
            wanted.add(f"policy/{path}")
    return wanted


def test_a_new_organization_holds_the_manifests_entries_and_nothing_else():
    """Every `required` and `recommended` entry lands, every `suggested` one does
    not, and the only other files are the four shapes that hold no default."""
    for edition in ("enterprise", "personal"):
        changes = _changes(edition)
        wanted = _wanted(edition)
        assert set(changes) == wanted | SHAPES, edition
        # `reach-suggested.json` is `suggested`: offered on the screen, never
        # written — including as a file of its own name.
        assert not any("suggested" in path for path in changes)
        # And a policy default is its own file, byte for byte what the preset
        # holds: the kinds are no longer a constant in this module.
        assert json.loads(changes["policy/kinds.json"]) == seed.presets("kinds.json")


def test_the_edition_picks_the_reach_default_from_the_manifest():
    """W5-D1c/D135 as data: two files, one per edition, and the seed picks."""
    for edition in ("enterprise", "personal"):
        entry = next(
            one for one in seed.manifest() if one["id"] == f"{seed.REACH_DEFAULT}{edition}"
        )
        body = seed.presets(entry["path"])
        if isinstance(body.get("hosts"), str):
            # The one indirection (01 §4.2), still resolved though no preset
            # uses it today: a `@<id>` is the *entry's* file, looked up in the
            # manifest — an id is not a file name and the next user of this
            # will not be `<id>.json`.
            named = next(
                one for one in seed.manifest() if one["id"] == body["hosts"][1:]
            )
            body = {**body, "hosts": seed.presets(named["path"])}
        assert json.loads(_changes(edition)["policy/reach.json"]) == body
    # W7-D4 (D155) amended W5-D1c: the personal default is `on` with an empty
    # deny-list, not the suggested allow-list, because the first-harness
    # modal's *Web access* switch writes `off` on the harness and reach only
    # ever narrows — there has to be an `on` above it to narrow from.
    personal = json.loads(_changes("personal")["policy/reach.json"])
    assert personal == {"mode": "on", "hosts": []}
    assert json.loads(_changes("enterprise")["policy/reach.json"]) == {"mode": "off", "hosts": []}
    # The suggested list did not go away: it is what Boundaries → Reach
    # offers, and it is still `suggested`, so it is still never seeded.
    assert seed.presets("reach-suggested.json")
    assert not any(
        one["managed"] != "suggested"
        for one in seed.manifest() if one["id"] == "reach-suggested"
    )


def test_the_required_asset_ids_are_exactly_the_manifests_required_entries():
    """`REQUIRED_ASSETS` is gone: which built-in asset a session must load is the
    entry's `managed` word, read off the sidecar the entry names."""
    required = {
        json.loads((seed.PRESETS / entry["path"] / "asset.json").read_text())["id"]
        for entry in seed.defaults("required")
        if entry["path"].startswith("assets/")
    }
    assert required == {AUTHORING}
    for edition in ("enterprise", "personal"):
        loaded = json.loads(_changes(edition)["policy/always-loaded.json"])
        assert set(loaded["required"]) == required
        assert BRIEF in loaded["recommended"] and AUTHORING not in loaded["recommended"]


@requires_postgres
async def test_a_new_organization_is_seeded_not_empty():
    """D30h. Seven policy files on `refs/heads/org`, in the last `definitions` call
    the creating transaction makes, against the root commit `/internal/orgs`
    returned — `refs/heads/org` is in no index until this commit indexes it."""
    async with world() as (connection, person), fake_definitions() as fake:
        await routes_org_units.create_org(
            _signup(org_name="Acme", team_name="Marketing"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        assert fake.calls[-1][0] == "/internal/commit"
        assert fake.seed["ref"] == "refs/heads/org"
        assert fake.seed["expectedHead"] == "r" * 40
        assert fake.seed["message"] == "seeded acme"
        assert fake.seed["author"]["email"] == "dana@acme.co"
        files = _seeded(fake)
        assert set(files) == {
            "policy/harness-providers.json",
            "policy/model-providers.json",
            "policy/routing.json",
            "policy/kinds.json",
            "policy/always-loaded.json",
            "policy/groups.json",
            "policy/grants.json",
            "policy/reach.json",
        }
        # Enterprise: every runtime is a row, and every row is refused with the
        # reason a person reads (prd-v2 §9.1).
        runtimes = files["policy/harness-providers.json"]
        assert [row["id"] for row in runtimes] == ["pi", "claude"]
        # W6-D3: the runtime says what it is called, from the presets, so no
        # screen has to hold a map from id to display name.
        assert [row["name"] for row in runtimes] == ["Pi", "Claude Code"]
        assert all(row["approval"] == "not-approved" and row["reason"] for row in runtimes)
        assert [row["id"] for row in files["policy/model-providers.json"]] == [
            "openrouter", "anthropic", "openai"]
        assert all("credential" not in row for row in files["policy/model-providers.json"])
        assert files["policy/groups.json"] == [] and files["policy/grants.json"] == []
        # D131/D135: an enterprise starts closed; an org admin turns reach on
        # from Boundaries → Reach, which is the same file.
        assert files["policy/reach.json"] == {"mode": "off", "hosts": []}
        assert await connection.fetchval(
            "select count(*) from audit_log where action='org.seed'") == 1


@requires_postgres
async def test_a_personal_account_is_seeded_approved_with_my_keys():
    """D73: the two differences from enterprise, and nothing else."""
    async with world() as (connection, person), fake_definitions() as fake:
        await routes_org_units.create_org(
            _signup(org_name="Dana", personal=True),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        files = _seeded(fake)
        runtimes = files["policy/harness-providers.json"]
        assert all(row["approval"] == "approved" and "reason" not in row for row in runtimes)
        assert files["policy/groups.json"] == [
            {"name": "my-keys", "entries": [], "sources": "vault"}
        ]
        # D135, amended by D155 (W7-D4): a hobby account's first `pip install`
        # works because reach starts `on` with nothing denied — and a first
        # harness can turn it `off` for itself, which an allow-list could not
        # be narrowed to without naming every host it was dropping.
        assert files["policy/reach.json"] == {"mode": "on", "hosts": []}
        assert files["policy/grants.json"] == [
            {"id": "my-keys", "scope": {"teams": "all"}, "group": "my-keys", "by": "seed"}
        ]


@requires_postgres
async def test_an_unreadable_preset_directory_is_not_permission_to_skip_the_seed():
    """The same rule as `definitions_unconfigured`: a deployment that cannot
    read its catalogue refuses the organization rather than creating one whose
    provider tables nobody can act on (D30h)."""
    async with world() as (connection, person), fake_definitions():
        before = await _units(connection)
        os.environ["HARNESS_PRESETS_DIR"] = "/nonexistent/presets"
        try:
            with pytest.raises(ApiError) as caught:
                await routes_org_units.create_org(
                    _signup(org_name="Acme"),
                    _request(connection),
                    Principal(person, "dana@acme.co"),
                )
        finally:
            del os.environ["HARNESS_PRESETS_DIR"]
        assert caught.value.code == "presets_unconfigured"
        assert await _units(connection) == before


# --- W7-D1: the door --------------------------------------------------------


@requires_postgres
async def test_the_right_code_creates_the_organization():
    """The gate is a gate, not a wall: with the configured code the ordinary
    creation path runs and the person has a workspace."""
    async with world() as (connection, person), fake_definitions():
        body = await routes_org_units.create_org(
            _signup(org_name="Acme"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        assert body["name"] == "Acme"
        assert await _units(connection) == 3


@requires_postgres
async def test_a_wrong_code_refuses_with_no_hint_and_creates_nothing():
    async with world() as (connection, person), fake_definitions() as fake:
        with pytest.raises(ApiError) as caught:
            await routes_org_units.create_org(
                # Non-ASCII on purpose: a typed code is whatever the
                # keyboard gave, and `compare_digest` raises on a non-ASCII
                # *string* — which would be a 500 where a refusal belongs.
                routes_org_units.OrgCreate(code=SIGNUP_CODE + "ÿ", org_name="Acme"),
                _request(connection),
                Principal(person, "dana@acme.co"),
            )
        assert caught.value.status_code == 403
        assert caught.value.code == "signup.code_wrong"
        # No hint: not how long, not how close, not whether one is configured.
        assert caught.value.message == "That access code is not right."
        assert caught.value.remedy is None
        # Refused before the transaction, so neither the records nor the
        # definition plane heard about it.
        assert await _units(connection) == 0
        assert fake.calls == []


@requires_postgres
async def test_an_unset_code_refuses_every_sign_up():
    """A deployment that never set `HARNESS_SIGNUP_CODE` is closed, not open.
    The empty string is not a code anyone can type, and it must not be the
    code everyone can type."""
    async with world() as (connection, person), fake_definitions():
        os.environ["HARNESS_SIGNUP_CODE"] = ""
        get_settings.cache_clear()
        try:
            with pytest.raises(ApiError) as caught:
                await routes_org_units.create_org(
                    routes_org_units.OrgCreate(code="", org_name="Acme"),
                    _request(connection),
                    Principal(person, "dana@acme.co"),
                )
        finally:
            os.environ["HARNESS_SIGNUP_CODE"] = SIGNUP_CODE
            get_settings.cache_clear()
        assert caught.value.code == "signup.code_wrong"
        assert await _units(connection) == 0


@requires_postgres
async def test_team_sign_up_is_an_enterprise_org_with_the_signer_as_its_admin():
    """W7-D1's Team door: the name is the signer's, and they own what they
    just made — an enterprise organization, so nothing is approved yet."""
    async with world() as (connection, person), fake_definitions() as fake:
        body = await routes_org_units.create_org(
            _signup(org_name="Acme", team_name="Marketing"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        assert await connection.fetchval(
            "select level from org_unit_admins where auth_user_id=$1 and org_unit_id=$2",
            person,
            body["id"],
        ) == "owner"
        assert any(ref.startswith("refs/heads/teams/") for ref in fake.refs)
        runtimes = _seeded(fake)["policy/harness-providers.json"]
        assert all(row["approval"] == "not-approved" for row in runtimes)


@requires_postgres
async def test_a_personal_organization_is_named_after_the_person():
    """W7-D1's Personal door has no name field, so the name is the address's
    local part. `org_units.path` is unique-indexed, so the second `dana@` to
    arrive takes `email_label` — the one form of an address that cannot
    collide with another address."""
    async with world() as (connection, person), fake_definitions():
        first = await routes_org_units.create_org(
            _signup(personal=True),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        assert (first["name"], first["path"]) == ("dana", "dana")

        other = uuid.uuid4()
        await connection.execute(
            "insert into auth.users(id,email) values ($1,$2)", other, "dana@other.co"
        )
        second = await routes_org_units.create_org(
            _signup(personal=True),
            _request(connection),
            Principal(other, "dana@other.co"),
        )
        assert second["path"] == "dana-at-other-co"


@requires_postgres
async def test_a_team_sign_up_without_a_name_is_refused():
    """Only Personal is named for you; Team must say what it is called."""
    async with world() as (connection, person), fake_definitions():
        with pytest.raises(ApiError) as caught:
            await routes_org_units.create_org(
                _signup(),
                _request(connection),
                Principal(person, "dana@acme.co"),
            )
        assert caught.value.code == "org_name_required"
        assert await _units(connection) == 0


@requires_postgres
async def test_a_personal_account_has_no_team_and_reads_as_personal():
    """D30f, as the records hold it too. `Viewer.edition` is derived from the
    organization having no team nodes (console D70), so a vestigial `General`
    made every signed-up personal account render as an enterprise one — the
    modal's two controls, the Getting started list, the sidebar. Sign-up writes
    no team at all now, and 0038 is what lets it: a user may sit in an org."""
    async with world() as (connection, person), fake_definitions() as fake:
        await routes_org_units.create_org(
            _signup(personal=True),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        assert [(row["role"], row["path"]) for row in await connection.fetch(
            "select role, path from org_units order by path")] == [
            ("org", "dana"), ("user", "dana.danaacmeco")]
        # The branch's `node_path` is the stored path, with nothing skipped.
        assert fake.calls[1][1]["node_path"] == "dana.danaacmeco"

        ctx = await console.context(ConnectionPool(connection), Principal(person, "dana@acme.co"))
        assert ctx.edition == "personal" and ctx.teams == []
        viewer = await routes_console.read_viewer(ctx)
        assert viewer["edition"] == "personal" and viewer["teams"] == []
        assert viewer["role"] == {"level": "org-admin", "at": "dana"}
        assert [(node["kind"], node["path"]) for node in viewer["chain"]] == [
            ("org", "dana"), ("user", "dana.danaacmeco")]


@requires_postgres
async def test_a_team_account_still_has_its_team():
    """The other half of the same rule: an enterprise sign-up is unchanged, so
    `edition` reads `enterprise` and the team is on the chain."""
    async with world() as (connection, person), fake_definitions():
        await routes_org_units.create_org(
            _signup(org_name="Acme", team_name="Marketing"),
            _request(connection),
            Principal(person, "dana@acme.co"),
        )
        ctx = await console.context(ConnectionPool(connection), Principal(person, "dana@acme.co"))
        assert ctx.edition == "enterprise"
        viewer = await routes_console.read_viewer(ctx)
        assert [team["path"] for team in viewer["teams"]] == ["acme.marketing"]


def test_a_personal_account_routes_to_a_sign_in_provider_by_default():
    """W7-D7: a fresh personal account can open its first session on the
    person's own sign-in — the sign-in providers are approved and Anthropic is
    the default — while an enterprise is routed by its admins."""
    personal = {c["path"]: c for c in seed.seed_files("personal", node_path="dana")}
    routing = json.loads(base64.b64decode(personal["policy/routing.json"]["blob"]))
    assert routing["defaultFor"]["teams"] == {"dana": "anthropic"}
    assert "anthropic" in routing["approvedFor"]["teams"]["dana"]
    assert "openai" not in routing["approvedFor"]["teams"]["dana"]  # Pi has no sign-in for it
    enterprise = {c["path"]: c for c in seed.seed_files("enterprise", node_path="acme")}
    enterprise_routing = json.loads(base64.b64decode(enterprise["policy/routing.json"]["blob"]))
    assert enterprise_routing["defaultFor"]["teams"] == {}
