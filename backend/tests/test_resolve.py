import asyncio
import base64
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import asyncpg
import pytest

from app.api import routes_assets
from app.domain.resolve import (
    descendant_owners,
    model_from_assets,
    resolved_assets,
    shadowed_copy,
    subtree_owner,
    version_files,
)
from app.errors import ApiError
from app.identity import Principal


def test_model_connection_is_read_from_cas_asset():
    model = {
        "provider": "openai-compatible",
        "model_id": "example-model",
        "base_url": "https://api.example.com/v1",
        "key_ref": "secret://acme/default-provider",
    }
    assets = [
        {
            "kind": "connection",
            "name": "model-default",
            "files": [
                {
                    "path": "model.json",
                    "content_b64": base64.b64encode(json.dumps(model).encode()).decode(),
                }
            ],
        }
    ]
    assert model_from_assets(assets) == model


def test_missing_or_invalid_model_connection_returns_none():
    assert model_from_assets([]) is None
    assert (
        model_from_assets(
            [
                {
                    "kind": "connection",
                    "name": "model-default",
                    "files": [{"path": "model.json", "content_b64": "bm90IGpzb24="}],
                }
            ]
        )
        is None
    )


class FakeConnection:
    """Returns canned candidate rows, then canned file bodies."""

    def __init__(self, candidates, files):
        self.candidates = candidates
        self.files = files
        self.queries = []

    async def fetch(self, query, *args):
        self.queries.append(query)
        return self.candidates if "with recursive chain" in query else self.files


def _candidate(kind, name, choice, *, unit, seq, version_id, asset_id, scope="all", harnesses=()):
    return {
        "id": asset_id,
        "kind": kind,
        "name": name,
        "choice": choice,
        "org_unit_path": unit,
        "version_id": version_id,
        "seq": seq,
        "file_hashes": {"SKILL.md": "h1"},
        "harness_scope": scope,
        "harness_ids": list(harnesses),
    }


async def test_resolved_assets_reports_the_asset_a_personal_override_shadows():
    rows = [
        _candidate(
            "skill", "triage", 1, unit="acme.eng.ana", seq=3, version_id="v-mine", asset_id="a-mine"
        ),
        _candidate(
            "skill", "triage", 2, unit="acme.eng", seq=7, version_id="v-team", asset_id="a-team"
        ),
        _candidate(
            "skill", "solo", 1, unit="acme.eng", seq=1, version_id="v-solo", asset_id="a-solo"
        ),
    ]
    connection = FakeConnection(rows, [{"hash": "h1", "content": b"body"}])

    assets = await resolved_assets(connection, "unit-id")

    # Only the winner of each (kind, name) is returned.
    assert [a["name"] for a in assets] == ["triage", "solo"]
    triage, solo = assets
    assert triage["asset_id"] == "a-mine"
    assert triage["version_id"] == "v-mine"
    assert triage["version_seq"] == 3
    assert triage["org_unit_path"] == "acme.eng.ana"
    assert triage["shadows"] == {
        "asset_id": "a-team",
        "org_unit_path": "acme.eng",
        "version_id": "v-team",
        "seq": 7,
    }
    # An asset nobody overrides shadows nothing.
    assert solo["shadows"] is None
    assert solo["files"] == [
        {"path": "SKILL.md", "content_b64": base64.b64encode(b"body").decode()}
    ]


# ---------------------------------------------------------------------------
# docs/scoping.md §9.1 — the scope predicate and the backfill.
#
# FakeConnection above cannot exercise any of this: the property under test
# is SQL clause-evaluation order (WHERE before the window function), and a
# canned `fetch` result proves nothing about order. These tests run the real
# query against a real, throwaway Postgres database.
# ---------------------------------------------------------------------------

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "supabase" / "migrations"
ADMIN_DSN = os.environ.get("TEST_POSTGRES_DSN", "postgresql://127.0.0.1:5432/postgres")


def _all_migrations() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


SCOPING_MIGRATION = MIGRATIONS_DIR / "0022_asset_scopes.sql"
PRE_SCOPING_MIGRATIONS = [p for p in _all_migrations() if p != SCOPING_MIGRATION]


def _postgres_reachable() -> bool:
    async def probe() -> None:
        connection = await asyncpg.connect(ADMIN_DSN, timeout=2)
        await connection.close()

    try:
        asyncio.run(probe())
        return True
    except (OSError, asyncpg.PostgresError):
        return False


requires_postgres = pytest.mark.skipif(
    not _postgres_reachable(),
    reason=(
        f"No live Postgres reachable at {ADMIN_DSN} (override with "
        "TEST_POSTGRES_DSN). The ordering and backfill acceptance tests in "
        "docs/scoping.md §9.1 need a real query planner, not a mock."
    ),
)


@asynccontextmanager
async def scratch_db(migrations: list[Path]):
    """A throwaway database with the given migration files applied, dropped
    on exit."""
    name = f"harness_scope_test_{uuid.uuid4().hex}"
    admin = await asyncpg.connect(ADMIN_DSN)
    try:
        await admin.execute(f'create database "{name}"')
    finally:
        await admin.close()
    base_dsn = ADMIN_DSN.rsplit("/", 1)[0]
    connection = await asyncpg.connect(f"{base_dsn}/{name}")
    try:
        # Match app.db.create_pool's codec: asyncpg otherwise hands back
        # jsonb columns (file_hashes, provenance) as raw text, not dicts.
        def encode(value):
            return value if isinstance(value, str) else json.dumps(value)

        await connection.set_type_codec(
            "jsonb", schema="pg_catalog", encoder=encode, decoder=json.loads
        )
        # A stand-in for Supabase's managed auth schema: 0009 and 0010
        # reference auth.users, but nothing in these tests signs anyone in,
        # so an empty table satisfies the foreign keys and the trigger.
        await connection.execute(
            "create schema auth; create table auth.users(id uuid primary key, email text);"
        )
        for path in migrations:
            await connection.execute(path.read_text())
        yield connection
    finally:
        await connection.close()
        admin = await asyncpg.connect(ADMIN_DSN)
        try:
            await admin.execute(f'drop database "{name}" with (force)')
        finally:
            await admin.close()


async def _unit(connection, parent_id, role, name) -> uuid.UUID:
    row = await connection.fetchrow(
        "insert into org_units(parent_id, role, name) values ($1,$2,$3) returning id",
        parent_id,
        role,
        name,
    )
    return row["id"]


async def _asset(connection, org_unit_id, kind, name) -> uuid.UUID:
    """An active asset with one non-pending head version, seq 1."""
    asset = await connection.fetchrow(
        "insert into assets(org_unit_id, kind, name) values ($1,$2,$3) returning id",
        org_unit_id,
        kind,
        name,
    )
    version = await connection.fetchrow(
        """insert into asset_versions(asset_id, seq, file_hashes, author_auth_user_id, message)
           values ($1,1,'{}'::jsonb,$2,'seed') returning id""",
        asset["id"],
        uuid.uuid4(),
    )
    await connection.execute(
        "update assets set head_version_id=$1 where id=$2", version["id"], asset["id"]
    )
    return asset["id"]


async def _scope(connection, asset_id, org_unit_id, granted_by) -> None:
    await connection.execute(
        "insert into asset_scopes(asset_id, org_unit_id, granted_by) values ($1,$2,$3)",
        asset_id,
        org_unit_id,
        granted_by,
    )


@requires_postgres
async def test_ordering_literal_case_org_and_marketing_both_own_triage():
    """docs/scoping.md §9.1's stated acceptance case, literally.

    Marketing's own copy needs a scope row to reach a user beneath it at
    all (§4: an asset is visible only to its owner until scoped) — scoping
    it to itself is what lets Ana, a descendant, match on it. The org's
    copy is deliberately left unscoped to marketing.
    """
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        ana = await _unit(connection, marketing, "user", "ana")

        await _asset(connection, org, "skill", "triage")
        marketing_triage = await _asset(connection, marketing, "skill", "triage")
        await _scope(connection, marketing_triage, marketing, marketing)

        resolved = await resolved_assets(connection, ana)

        assert [a["name"] for a in resolved] == ["triage"]
        assert resolved[0]["asset_id"] == marketing_triage


@requires_postgres
async def test_ordering_predicate_runs_before_the_window_not_after():
    """The mirror of the literal case above, and the one that actually forces
    the ordering.

    Here the NEARER asset (marketing's own, unscoped) fails the candidacy
    predicate, and the FARTHER one (the org's, scoped down to marketing)
    passes it. Filtering after the window would let marketing's copy take
    the window's #1 slot, get discarded for failing the predicate, and never
    promote the org's copy sitting at #2 — Ana would resolve nothing.
    Filtering before the window removes marketing's copy from the race
    before ranking happens, so the org's copy is the only candidate left and
    wins outright (docs/scoping.md §3.1).
    """
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        ana = await _unit(connection, marketing, "user", "ana")

        # Nearer, but nobody has shared it past marketing itself.
        await _asset(connection, marketing, "skill", "triage")
        # Farther, but explicitly scoped down to marketing.
        org_triage = await _asset(connection, org, "skill", "triage")
        await _scope(connection, org_triage, marketing, org)

        resolved = await resolved_assets(connection, ana)

        assert [a["name"] for a in resolved] == ["triage"]
        assert resolved[0]["asset_id"] == org_triage


@requires_postgres
async def test_a_grant_to_a_team_reaches_a_user_inside_it():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        ana = await _unit(connection, marketing, "user", "ana")

        crm = await _asset(connection, org, "connection", "crm")
        await _scope(connection, crm, marketing, org)

        resolved = await resolved_assets(connection, ana)

        assert [a["name"] for a in resolved] == ["crm"]
        assert resolved[0]["asset_id"] == crm


@requires_postgres
async def test_a_new_asset_resolves_for_its_owner_and_nobody_below():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        ana = await _unit(connection, marketing, "user", "ana")

        widget = await _asset(connection, marketing, "skill", "widget")

        owned = await resolved_assets(connection, marketing)
        assert [a["name"] for a in owned] == ["widget"]
        assert owned[0]["asset_id"] == widget

        below = await resolved_assets(connection, ana)
        assert below == []


@requires_postgres
async def test_an_asset_scoped_to_one_team_does_not_resolve_for_a_sibling_team():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        team_b = await _unit(connection, org, "team", "team-b")

        crm = await _asset(connection, org, "connection", "crm")
        await _scope(connection, crm, team_a, org)

        team_a_resolved = await resolved_assets(connection, team_a)
        assert [a["name"] for a in team_a_resolved] == ["crm"]

        team_b_resolved = await resolved_assets(connection, team_b)
        assert team_b_resolved == []


# The exact query resolved_assets ran before this migration existed, captured
# verbatim as the definition of "pre-migration behaviour" for the backfill
# test below (docs/v3.md §5: the acceptance check is not "the backfill ran"
# but "every pre-existing manifest is byte-identical after it").
PRE_SCOPING_QUERY = """with recursive chain as (
             select id,parent_id,0 depth from org_units where id=$1
             union all select p.id,p.parent_id,c.depth+1
             from org_units p join chain c on c.parent_id=p.id
           ), candidates as (
             select a.*,c.depth,u.path org_unit_path,v.id version_id,v.seq,v.file_hashes,
                    row_number() over(partition by a.kind,a.name order by c.depth asc) choice
             from chain c join assets a on a.org_unit_id=c.id and a.status='active'
             join org_units u on u.id=a.org_unit_id
             join lateral (
               select av.* from asset_versions av
               where av.asset_id=a.id
                 and not (av.provenance ? 'pending_review')
               order by av.seq desc limit 1
             ) v on true
           ) select * from candidates where choice<=2 order by kind,name,choice"""


async def _pre_scoping_manifest(connection, org_unit_id) -> list[dict]:
    rows = await connection.fetch(PRE_SCOPING_QUERY, org_unit_id)
    shadowed = {
        (row["kind"], row["name"]): {
            "asset_id": row["id"],
            "org_unit_path": row["org_unit_path"],
            "version_id": row["version_id"],
            "seq": row["seq"],
        }
        for row in rows
        if row["choice"] == 2
    }
    return [
        {
            "name": row["name"],
            "kind": row["kind"],
            "asset_id": row["id"],
            "org_unit_path": row["org_unit_path"],
            "version_id": row["version_id"],
            "version_seq": row["seq"],
            "shadows": shadowed.get((row["kind"], row["name"])),
        }
        for row in rows
        if row["choice"] == 1
    ]


def _comparable(manifest: list[dict]) -> list[dict]:
    fields = ("name", "kind", "asset_id", "org_unit_path", "version_id", "version_seq", "shadows")
    return [{field: entry[field] for field in fields} for entry in manifest]


@requires_postgres
async def test_the_backfill_leaves_every_pre_existing_manifest_byte_identical():
    """docs/v3.md §5's real acceptance check for the one irreversible step:
    not that the backfill ran, but that every unit that existed before it
    resolves exactly what it resolved before — including a shadow, an
    archived asset, and a pending-review version, none of which the
    predicate is supposed to touch.
    """
    async with scratch_db(PRE_SCOPING_MIGRATIONS) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        team_b = await _unit(connection, org, "team", "team-b")
        ana = await _unit(connection, team_a, "user", "ana")

        # The org's own triage, shadowed by team-a's own override — the
        # silent-shadow shape docs/scoping.md §5.2 describes.
        await _asset(connection, org, "skill", "triage")
        await _asset(connection, team_a, "skill", "triage")
        # Resolved straight from the org, with no override anywhere.
        await _asset(connection, org, "connection", "crm")
        # A personal asset that never leaves its own user.
        await _asset(connection, ana, "memory", "notes")
        # Archived before scoping existed; must stay excluded after.
        retired = await _asset(connection, team_a, "skill", "retired")
        await connection.execute("update assets set status='archived' where id=$1", retired)
        # A pending-review version must not become anyone's head, before or
        # after.
        draft = await _asset(connection, team_b, "skill", "draft")
        await connection.execute(
            """insert into asset_versions(asset_id, seq, file_hashes, author_auth_user_id,
                                           message, provenance)
               values ($1,2,'{}'::jsonb,$2,'pending','{"pending_review": true}'::jsonb)""",
            draft,
            uuid.uuid4(),
        )

        units = [org, team_a, team_b, ana]
        before = {
            unit: _comparable(await _pre_scoping_manifest(connection, unit)) for unit in units
        }

        await connection.execute(SCOPING_MIGRATION.read_text())

        after = {unit: _comparable(await resolved_assets(connection, unit)) for unit in units}

        assert after == before
        # The migration did something, not "ran and inserted nothing": every
        # asset gained a scope row for every descendant of its owning unit.
        scope_rows = await connection.fetchval("select count(*) from asset_scopes")
        assert scope_rows > 0


@requires_postgres
async def test_the_backfill_reaches_units_created_after_it_ran():
    """A person hired after the migration must resolve what their team owns.

    The backfill scopes each asset to its owning unit, which means "this unit
    and everything beneath it" and so covers descendants that do not exist
    yet. Enumerating (asset, descendant) pairs would pass every test written
    against the tree as it stood at migration time and fail the first new
    hire — and fail it asymmetrically, since a row naming their team would
    still deliver the org's assets while their own team's went missing.
    """
    async with scratch_db(PRE_SCOPING_MIGRATIONS) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")

        crm = await _asset(connection, org, "connection", "crm")
        triage = await _asset(connection, marketing, "skill", "triage")

        await connection.execute(SCOPING_MIGRATION.read_text())

        # Hired after the deploy: no scope row anywhere names this unit.
        ana = await _unit(connection, marketing, "user", "ana")

        resolved = await resolved_assets(connection, ana)
        assert sorted(a["name"] for a in resolved) == ["crm", "triage"]
        assert {a["asset_id"] for a in resolved} == {crm, triage}


# ---------------------------------------------------------------------------
# docs/scoping.md §9.2 — the scope endpoints.
#
# These call the route functions directly (not through TestClient/HTTP): the
# functions FastAPI's decorators register are plain coroutines, and calling
# them in-process keeps everything on the one event loop the scratch_db
# connection was opened on — asyncpg connections are not safe to hand to a
# second loop, which a real HTTP test client would require.
# ---------------------------------------------------------------------------


class ConnectionPool:
    """Adapts a single scratch_db connection to the slice of asyncpg.Pool's
    interface routes_assets.py uses (`.fetch`/`.execute` directly for reads,
    `.acquire()` for the write endpoint's transaction), so the routes can run
    against a real, transactional connection instead of a mock."""

    def __init__(self, connection):
        self._connection = connection

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def acquire(self):
        return _acquire(self._connection)


@asynccontextmanager
async def _acquire(connection):
    yield connection


def _request(connection) -> SimpleNamespace:
    pool = ConnectionPool(connection)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(pool=pool)))


@requires_postgres
async def test_scoping_to_a_non_descendant_is_refused_with_422_naming_the_unit():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        team_b = await _unit(connection, org, "team", "team-b")
        crm = await _asset(connection, team_a, "connection", "crm")

        principal = Principal(uuid.uuid4())
        user_unit = {"id": team_a}  # owns team_a: require_write passes trivially

        with pytest.raises(ApiError) as caught:
            await routes_assets.set_asset_scopes(
                crm,
                routes_assets.ScopeReplace(
                    scopes=[routes_assets.ScopeGrant(org_unit_id=team_b)]
                ),
                _request(connection),
                principal,
                user_unit,
            )
        assert caught.value.status_code == 422
        assert caught.value.detail["org_unit_id"] == str(team_b)
        assert str(team_b) in caught.value.message

        # Refused atomically: no row was written for the rejected request.
        assert await connection.fetchval(
            "select count(*) from asset_scopes where asset_id=$1", crm
        ) == 0


@requires_postgres
async def test_scoping_to_a_descendant_resolves_there_and_removal_stops_it():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        ana = await _unit(connection, team_a, "user", "ana")
        crm = await _asset(connection, team_a, "connection", "crm")

        principal = Principal(uuid.uuid4())
        user_unit = {"id": team_a}

        result = await routes_assets.set_asset_scopes(
            crm,
            routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=ana)]),
            _request(connection),
            principal,
            user_unit,
        )
        assert [row["org_unit_id"] for row in result] == [ana]

        resolved = await resolved_assets(connection, ana)
        assert [a["name"] for a in resolved] == ["crm"]
        assert resolved[0]["asset_id"] == crm

        # Replacing with an empty set revokes it.
        result = await routes_assets.set_asset_scopes(
            crm,
            routes_assets.ScopeReplace(scopes=[]),
            _request(connection),
            principal,
            user_unit,
        )
        assert result == []
        assert await resolved_assets(connection, ana) == []


@requires_postgres
async def test_caller_with_no_write_access_to_the_owning_unit_gets_403():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        team_b = await _unit(connection, org, "team", "team-b")
        crm = await _asset(connection, org, "connection", "crm")

        principal = Principal(uuid.uuid4())
        # team_b can read org's asset (org is its ancestor) but administers
        # nothing above itself, so it cannot scope an asset org owns.
        user_unit = {"id": team_b}

        with pytest.raises(ApiError) as caught:
            await routes_assets.set_asset_scopes(
                crm,
                routes_assets.ScopeReplace(
                    scopes=[routes_assets.ScopeGrant(org_unit_id=team_a)]
                ),
                _request(connection),
                principal,
                user_unit,
            )
        assert caught.value.status_code == 403
        assert caught.value.code == "write_not_allowed"


@requires_postgres
async def test_replacing_the_scope_set_leaves_exactly_what_was_sent():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        ana = await _unit(connection, team_a, "user", "ana")
        ben = await _unit(connection, team_a, "user", "ben")
        crm = await _asset(connection, team_a, "connection", "crm")

        principal = Principal(uuid.uuid4())
        user_unit = {"id": team_a}

        await routes_assets.set_asset_scopes(
            crm,
            routes_assets.ScopeReplace(
                scopes=[
                    routes_assets.ScopeGrant(org_unit_id=ana),
                    routes_assets.ScopeGrant(org_unit_id=ben),
                ]
            ),
            _request(connection),
            principal,
            user_unit,
        )

        # Second call replaces, rather than merging with, the first.
        result = await routes_assets.set_asset_scopes(
            crm,
            routes_assets.ScopeReplace(
                scopes=[routes_assets.ScopeGrant(org_unit_id=ana, key_ref="secret://acme/ro")]
            ),
            _request(connection),
            principal,
            user_unit,
        )

        assert [(row["org_unit_id"], row["key_ref"]) for row in result] == [
            (ana, "secret://acme/ro")
        ]
        fetched = await routes_assets.list_asset_scopes(
            crm, _request(connection), principal, user_unit
        )
        assert [(row["org_unit_id"], row["key_ref"]) for row in fetched] == [
            (ana, "secret://acme/ro")
        ]


@requires_postgres
async def test_the_audit_event_records_units_added_and_removed():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        ana = await _unit(connection, team_a, "user", "ana")
        ben = await _unit(connection, team_a, "user", "ben")
        crm = await _asset(connection, team_a, "connection", "crm")

        principal = Principal(uuid.uuid4())
        user_unit = {"id": team_a}

        await routes_assets.set_asset_scopes(
            crm,
            routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=ana)]),
            _request(connection),
            principal,
            user_unit,
        )
        await routes_assets.set_asset_scopes(
            crm,
            routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=ben)]),
            _request(connection),
            principal,
            user_unit,
        )

        rows = await connection.fetch(
            "select action, payload from audit_log where action='asset.scopes' order by id"
        )
        assert [dict(row["payload"]) for row in rows] == [
            {
                "asset_id": str(crm),
                "added": [str(ana)],
                "removed": [],
                "recredentialed": [],
            },
            {
                "asset_id": str(crm),
                "added": [str(ben)],
                "removed": [str(ana)],
                "recredentialed": [],
            },
        ]


@requires_postgres
async def test_changing_only_a_credential_is_still_audited():
    """A key swap changes no membership, so the added/removed diff is empty.

    Silently moving a unit from a read-only key to a write one is the single
    change an audit is most needed for, and the one a membership diff cannot
    see on its own.
    """
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        interns = await _unit(connection, org, "team", "interns")
        crm = await _asset(connection, org, "connection", "crm")
        principal = Principal(uuid.uuid4())

        async def put(key_ref: str):
            await routes_assets.set_asset_scopes(
                crm,
                routes_assets.ScopeReplace(
                    scopes=[routes_assets.ScopeGrant(org_unit_id=interns, key_ref=key_ref)]
                ),
                _request(connection),
                principal,
                {"id": org},
            )

        await put("secret://acme/crm-readonly")
        await put("secret://acme/crm-write")

        rows = await connection.fetch(
            "select payload from audit_log where action='asset.scopes' order by id"
        )
        assert len(rows) == 2, "the credential swap must produce its own event"
        swap = dict(rows[1]["payload"])
        assert swap["added"] == [] and swap["removed"] == []
        assert swap["recredentialed"] == [
            {
                "org_unit_id": str(interns),
                "from": "secret://acme/crm-readonly",
                "to": "secret://acme/crm-write",
            }
        ]


# ---------------------------------------------------------------------------
# docs/scoping.md §5.2 / §9.6 — a name collision is a conflict, raised at the
# moment it would be created, never resolved silently.
# ---------------------------------------------------------------------------


def _files(content: bytes = b"body") -> list[routes_assets.FileInput]:
    return [
        routes_assets.FileInput(path="SKILL.md", content_b64=base64.b64encode(content).decode())
    ]


async def _head_version_id(connection, asset_id) -> uuid.UUID:
    return await connection.fetchval("select head_version_id from assets where id=$1", asset_id)


async def _provenance(connection, asset_id) -> dict:
    row = await connection.fetchrow(
        """select v.provenance from assets a join asset_versions v on v.id=a.head_version_id
           where a.id=$1""",
        asset_id,
    )
    return dict(row["provenance"])


# --- domain-level: the three query helpers routes_assets.py builds on ------


@requires_postgres
async def test_shadowed_copy_is_none_when_the_ancestor_is_not_scoped_down():
    """An ancestor that owns the name but never scoped it reaches nobody, so
    it must not read as a collision — nothing about the descendant's resolved
    set would change if the descendant pushed the same name."""
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        await _asset(connection, org, "skill", "triage")

        assert await shadowed_copy(connection, marketing, "skill", "triage") is None


@requires_postgres
async def test_shadowed_copy_finds_the_scoped_ancestor():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        org_triage = await _asset(connection, org, "skill", "triage")
        await _scope(connection, org_triage, marketing, org)

        found = await shadowed_copy(connection, marketing, "skill", "triage")
        assert found["asset_id"] == org_triage
        assert found["org_unit_path"] == "acme"
        assert found["version_id"] == await _head_version_id(connection, org_triage)


@requires_postgres
async def test_descendant_owners_lists_every_unit_below_that_already_owns_the_name():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        team_b = await _unit(connection, org, "team", "team-b")
        await _asset(connection, team_a, "skill", "triage")
        await _asset(connection, team_b, "skill", "triage")

        below = await descendant_owners(connection, org, "skill", "triage")
        assert sorted(row["org_unit_path"] for row in below) == ["acme.team-a", "acme.team-b"]


@requires_postgres
async def test_subtree_owner_finds_a_match_anywhere_below_not_just_the_direct_unit():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        ana = await _unit(connection, marketing, "user", "ana")
        await _asset(connection, ana, "connection", "crm")

        # marketing itself owns nothing, but its subtree — ana — does.
        found = await subtree_owner(
            connection, marketing, "connection", "crm", excluding=uuid.uuid4()
        )
        assert found is not None
        assert found["org_unit_path"] == "acme.marketing.ana"


# --- (a): a push colliding with an ancestor -------------------------------


@requires_postgres
async def test_push_colliding_with_a_scoped_ancestor_is_refused_and_creates_no_asset():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        org_triage = await _asset(connection, org, "skill", "triage")
        await _scope(connection, org_triage, marketing, org)

        principal = Principal(uuid.uuid4())
        user_unit = {"id": marketing}
        with pytest.raises(ApiError) as caught:
            await routes_assets.create_asset(
                routes_assets.AssetCreate(
                    org_unit_id=marketing,
                    kind="skill",
                    name="triage",
                    message="my own triage",
                    files=_files(),
                ),
                _request(connection),
                principal,
                user_unit,
            )
        assert caught.value.status_code == 409
        assert caught.value.code == "name_collision"
        assert caught.value.detail["asset_id"] == str(org_triage)
        assert caught.value.detail["org_unit_path"] == "acme"
        # `_asset()` seeds an empty file set; the shape under test is that the
        # ancestor's *actual* files are what travel in the 409, whatever they
        # are — proven against the real lookup rather than a hand-built list.
        assert caught.value.detail["files"] == await version_files(connection, {})
        assert caught.value.detail["resolutions"] == ["rename", "take_theirs", "keep_mine", "merge"]

        # Refused atomically: no shadow was created.
        count = await connection.fetchval(
            "select count(*) from assets where org_unit_id=$1 and kind='skill' and name='triage'",
            marketing,
        )
        assert count == 0


@requires_postgres
async def test_push_of_a_name_an_unscoped_ancestor_owns_succeeds_without_a_collision():
    """The mirror of the above: an ancestor merely owning the name (never
    scoped this far) must not block a push of the same name — resolving it
    could never have reached this unit anyway."""
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        await _asset(connection, org, "skill", "triage")

        principal = Principal(uuid.uuid4())
        result = await routes_assets.create_asset(
            routes_assets.AssetCreate(
                org_unit_id=marketing,
                kind="skill",
                name="triage",
                message="my own triage",
                files=_files(),
            ),
            _request(connection),
            principal,
            {"id": marketing},
        )
        assert result["shadows_below"] == []


@requires_postgres
async def test_keep_mine_records_who_chose_the_override():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        org_triage = await _asset(connection, org, "skill", "triage")
        await _scope(connection, org_triage, marketing, org)
        collision = await shadowed_copy(connection, marketing, "skill", "triage")

        principal = Principal(uuid.uuid4())
        result = await routes_assets.create_asset(
            routes_assets.AssetCreate(
                org_unit_id=marketing,
                kind="skill",
                name="triage",
                message="keeping mine",
                files=_files(),
                override_of=collision["version_id"],
            ),
            _request(connection),
            principal,
            {"id": marketing},
        )
        provenance = await _provenance(connection, result["id"])
        assert provenance["override_of"] == str(org_triage)
        # And it still shadows the org's, exactly like a shadow nobody chose —
        # this only changes how the shadow was made, never how it resolves.
        resolved = await resolved_assets(connection, marketing)
        [triage] = [a for a in resolved if a["name"] == "triage"]
        assert triage["asset_id"] == result["id"]
        assert triage["shadows"]["asset_id"] == org_triage


@requires_postgres
async def test_keep_mine_is_allowed_for_a_connection():
    """A connection names a credential; it is not one.

    docs/scoping.md §5.5 puts connections in the asset family, so a team may
    keep its own. The credential stays the owner's by a different route —
    `asset_scopes.key_ref` — which the recipient cannot set.
    """
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team = await _unit(connection, org, "team", "marketing")
        theirs = await _asset(connection, org, "connection", "model-default")
        await _scope(connection, theirs, team, org)

        collision = await shadowed_copy(connection, team, "connection", "model-default")
        assert collision is not None, "the org's copy must be seen as a collision"

        created = await routes_assets.create_asset(
            routes_assets.AssetCreate(
                org_unit_id=team,
                kind="connection",
                name="model-default",
                message="ours",
                files=[routes_assets.FileInput(path="model.json", content_b64="e30=")],
                override_of=collision["version_id"],
            ),
            _request(connection),
            Principal(uuid.uuid4()),
            {"id": team},
        )
        assert created["id"]


@requires_postgres
async def test_an_override_that_does_not_match_the_current_collision_is_refused():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        org_triage = await _asset(connection, org, "skill", "triage")
        await _scope(connection, org_triage, marketing, org)

        principal = Principal(uuid.uuid4())
        with pytest.raises(ApiError) as caught:
            await routes_assets.create_asset(
                routes_assets.AssetCreate(
                    org_unit_id=marketing,
                    kind="skill",
                    name="triage",
                    message="keeping mine",
                    files=_files(),
                    override_of=uuid.uuid4(),
                ),
                _request(connection),
                principal,
                {"id": marketing},
            )
        assert caught.value.status_code == 409
        assert caught.value.code == "name_collision"


@requires_postgres
async def test_an_override_offered_with_nothing_to_override_is_refused():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        principal = Principal(uuid.uuid4())
        with pytest.raises(ApiError) as caught:
            await routes_assets.create_asset(
                routes_assets.AssetCreate(
                    org_unit_id=org,
                    kind="skill",
                    name="triage",
                    message="nothing to override",
                    files=_files(),
                    override_of=uuid.uuid4(),
                ),
                _request(connection),
                principal,
                {"id": org},
            )
        assert caught.value.status_code == 422
        assert caught.value.code == "invalid_override"


# --- (b): pushing a name descendants already have -------------------------


@requires_postgres
async def test_push_at_an_ancestor_reports_the_units_it_would_now_shadow():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team_a = await _unit(connection, org, "team", "team-a")
        await _asset(connection, team_a, "skill", "triage")

        principal = Principal(uuid.uuid4())
        result = await routes_assets.create_asset(
            routes_assets.AssetCreate(
                org_unit_id=org,
                kind="skill",
                name="triage",
                message="org triage",
                files=_files(),
            ),
            _request(connection),
            principal,
            {"id": org},
        )
        assert [row["org_unit_path"] for row in result["shadows_below"]] == ["acme.team-a"]
        # Informational only: team-a's own copy still resolves for team-a,
        # because nothing scoped the org's new copy down to it.
        resolved = await resolved_assets(connection, team_a)
        [triage] = [a for a in resolved if a["name"] == "triage"]
        assert triage["org_unit_path"] == "acme.team-a"


# --- (c): a scope grant that would silently create a collision -----------


@requires_postgres
async def test_scoping_to_a_unit_whose_subtree_already_has_the_name_is_refused():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        marketing_crm = await _asset(connection, marketing, "connection", "crm")
        org_crm = await _asset(connection, org, "connection", "crm")

        principal = Principal(uuid.uuid4())
        with pytest.raises(ApiError) as caught:
            await routes_assets.set_asset_scopes(
                org_crm,
                routes_assets.ScopeReplace(
                    scopes=[routes_assets.ScopeGrant(org_unit_id=marketing)]
                ),
                _request(connection),
                principal,
                {"id": org},
            )
        assert caught.value.status_code == 409
        assert caught.value.code == "name_collision"
        assert caught.value.detail["colliding_asset_id"] == str(marketing_crm)
        assert caught.value.detail["resolutions"] == ["rename", "take_theirs", "keep_mine", "merge"]

        # Refused atomically: no scope row was written.
        assert await connection.fetchval(
            "select count(*) from asset_scopes where asset_id=$1", org_crm
        ) == 0


@requires_postgres
async def test_scoping_reaches_a_grandchild_whose_own_copy_already_exists():
    """The reach of a scope row is the whole subtree (docs/scoping.md §3), so
    the check has to look past the directly-named unit — granting the org
    itself must catch a copy two levels down, not just at the org."""
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        ana = await _unit(connection, marketing, "user", "ana")
        await _asset(connection, ana, "skill", "triage")
        org_triage = await _asset(connection, org, "skill", "triage")

        principal = Principal(uuid.uuid4())
        with pytest.raises(ApiError) as caught:
            await routes_assets.set_asset_scopes(
                org_triage,
                routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=org)]),
                _request(connection),
                principal,
                {"id": org},
            )
        assert caught.value.status_code == 409
        assert caught.value.detail["colliding_org_unit_path"] == "acme.marketing.ana"


@requires_postgres
async def test_a_confirmed_override_lets_the_scope_grant_through():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        marketing_triage = await _asset(connection, marketing, "skill", "triage")
        org_triage = await _asset(connection, org, "skill", "triage")

        principal = Principal(uuid.uuid4())
        # The marketing admin confirms "keep mine" against the org's copy —
        # before the org has scoped it down at all (§5.2(c) fires exactly
        # when that scope grant is attempted, not before).
        await routes_assets.create_version(
            marketing_triage,
            routes_assets.VersionCreate(
                message="confirming our own triage",
                parent_version_id=await _head_version_id(connection, marketing_triage),
                files=_files(b"marketing content"),
                override_of=await _head_version_id(connection, org_triage),
            ),
            _request(connection),
            principal,
            {"id": marketing},
        )

        # Now the org can scope its copy down without being refused.
        result = await routes_assets.set_asset_scopes(
            org_triage,
            routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=marketing)]),
            _request(connection),
            principal,
            {"id": org},
        )
        assert [row["org_unit_id"] for row in result] == [marketing]
        # And marketing's own, knowingly-overriding copy still wins there.
        resolved = await resolved_assets(connection, marketing)
        [triage] = [a for a in resolved if a["name"] == "triage"]
        assert triage["asset_id"] == marketing_triage
        assert triage["shadows"]["asset_id"] == org_triage


@requires_postgres
async def test_re_granting_an_already_scoped_unit_is_idempotent():
    """Only *newly* added units are checked, so replacing the set with one
    that already included a unit must not start failing just because that
    unit picked up a competing asset in the meantime — that unit's admin
    already saw (or resolved) this the first time it was granted."""
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        org_crm = await _asset(connection, org, "connection", "crm")
        principal = Principal(uuid.uuid4())
        user_unit = {"id": org}

        await routes_assets.set_asset_scopes(
            org_crm,
            routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=marketing)]),
            _request(connection),
            principal,
            user_unit,
        )
        await _asset(connection, marketing, "connection", "crm")

        result = await routes_assets.set_asset_scopes(
            org_crm,
            routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=marketing)]),
            _request(connection),
            principal,
            user_unit,
        )
        assert [row["org_unit_id"] for row in result] == [marketing]


@requires_postgres
async def test_take_theirs_by_archiving_the_local_copy_clears_the_collision():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        marketing_crm = await _asset(connection, marketing, "connection", "crm")
        org_crm = await _asset(connection, org, "connection", "crm")
        await connection.execute(
            "update assets set status='archived' where id=$1", marketing_crm
        )

        result = await routes_assets.set_asset_scopes(
            org_crm,
            routes_assets.ScopeReplace(scopes=[routes_assets.ScopeGrant(org_unit_id=marketing)]),
            _request(connection),
            Principal(uuid.uuid4()),
            {"id": org},
        )
        assert [row["org_unit_id"] for row in result] == [marketing]


# --- create_version's override_of is opt-in and never gates an ordinary edit


@requires_postgres
async def test_an_ordinary_edit_to_an_existing_shadow_needs_no_override():
    """The core non-regression: a shadow that already exists keeps being
    pushed to exactly as before — this feature changes how a collision is
    made, never how an existing one is edited or resolved."""
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        org_triage = await _asset(connection, org, "skill", "triage")
        await _scope(connection, org_triage, marketing, org)
        # A shadow from before this feature shipped: no override_of anywhere.
        marketing_triage = await _asset(connection, marketing, "skill", "triage")

        version = await routes_assets.create_version(
            marketing_triage,
            routes_assets.VersionCreate(
                message="an ordinary edit",
                parent_version_id=await _head_version_id(connection, marketing_triage),
                files=_files(b"edited"),
            ),
            _request(connection),
            Principal(uuid.uuid4()),
            {"id": marketing},
        )
        assert "override_of" not in version["provenance"]

        # And it resolves exactly as any pre-existing shadow does: nearest
        # ancestor wins for marketing, the org's copy is what it shadows.
        resolved = await resolved_assets(connection, marketing)
        [triage] = [a for a in resolved if a["name"] == "triage"]
        assert triage["asset_id"] == marketing_triage
        assert triage["shadows"]["asset_id"] == org_triage


@requires_postgres
async def test_override_of_must_name_a_real_current_collision():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        marketing_triage = await _asset(connection, marketing, "skill", "triage")

        with pytest.raises(ApiError) as caught:
            await routes_assets.create_version(
                marketing_triage,
                routes_assets.VersionCreate(
                    message="bogus override",
                    parent_version_id=await _head_version_id(connection, marketing_triage),
                    files=_files(b"edited"),
                    override_of=uuid.uuid4(),
                ),
                _request(connection),
                Principal(uuid.uuid4()),
                {"id": marketing},
            )
        assert caught.value.status_code == 422
        assert caught.value.code == "invalid_override"


@requires_postgres
async def test_lineage_carries_the_common_ancestor_version_and_the_override_decision():
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        marketing = await _unit(connection, org, "team", "marketing")
        org_triage = await _asset(connection, org, "skill", "triage")
        org_triage_version = await _head_version_id(connection, org_triage)

        # promote() requires admin rights at the target, unlike the other
        # route calls in this file — a real login row satisfies the FK
        # org_unit_admins needs.
        auth_user_id = uuid.uuid4()
        await connection.execute(
            "insert into auth.users(id, email) values ($1, 'admin@acme.test')", auth_user_id
        )
        await connection.execute(
            "insert into org_unit_admins(auth_user_id, org_unit_id, level) values ($1,$2,'admin')",
            auth_user_id,
            marketing,
        )
        principal = Principal(auth_user_id)
        promoted = await routes_assets.promote(
            org_triage,
            routes_assets.PromoteInput(target_org_unit_id=marketing),
            _request(connection),
            principal,
            {"id": org},
        )
        marketing_triage = promoted["id"]
        await _scope(connection, org_triage, marketing, org)

        rows = await routes_assets.lineage(
            marketing_triage, _request(connection), principal, {"id": marketing}
        )
        mine = next(row for row in rows if row["asset_id"] == marketing_triage)
        assert mine["promoted_from_asset_id"] == org_triage
        assert mine["promoted_from_version_id"] == org_triage_version
        assert mine["override_of"] is None  # promoted, not yet a chosen override

        await routes_assets.create_version(
            marketing_triage,
            routes_assets.VersionCreate(
                message="confirming our own triage",
                parent_version_id=mine["version_id"],
                files=_files(b"marketing content"),
                override_of=org_triage_version,
            ),
            _request(connection),
            principal,
            {"id": marketing},
        )
        rows = await routes_assets.lineage(
            marketing_triage, _request(connection), principal, {"id": marketing}
        )
        mine = next(row for row in rows if row["asset_id"] == marketing_triage)
        assert mine["override_of"] == str(org_triage)


@requires_postgres
async def test_a_sub_team_can_actually_be_inserted():
    """The Python gate and the database trigger both decide role order.

    `validate_role_order` was changed for sub-teams and the trigger was not,
    and nothing caught it because the only test called the Python function.
    A rule enforced in two places needs a test that reaches both.
    """
    async with scratch_db(_all_migrations()) as connection:
        org = await _unit(connection, None, "org", "acme")
        team = await _unit(connection, org, "team", "marketing")
        interns = await _unit(connection, team, "team", "interns")

        skill = await _asset(connection, org, "skill", "triage")
        await _scope(connection, skill, interns, org)
        assert [a["name"] for a in await resolved_assets(connection, interns)] == ["triage"]
