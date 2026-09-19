import asyncio
import base64
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
import pytest

from app.domain.resolve import model_from_assets, resolved_assets


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
