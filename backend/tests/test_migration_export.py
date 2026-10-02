"""00 D6, the byte-identical test: every manifest that resolved before the
migration composes byte-identically after it, for every user.

`resolve.py`'s `resolved_assets` is the "before". `compose()` over the exported
branches is the "after", reached by spawning the engine's
`compose-chain` binary — composition has one implementation and it is
TypeScript (00 D2), so the two meet at a process boundary rather than at a
second copy of the algorithm in Python.

02 §11.2 step 5 runs this at cutover; 09 §M1 runs it now, a milestone before
anything moves, because it is the proof that composition is `resolve.py`'s
semantics.
"""

import base64
import hashlib
import json
import os
import subprocess
import uuid
from pathlib import Path

import asyncpg
import pytest

# The scratch-database harness docs/archive/scoping.md §9.1 already built. Reusing it
# keeps one way to stand up a real query planner in this suite.
from test_resolve import (  # type: ignore[import-not-found]
    ADMIN_DSN,
    _all_migrations,
    _scope,
    _unit,
    requires_postgres,
    scratch_db,
)

from app.domain.resolve import resolved_assets
from app.domain.seed import seed_assets
from app.migration.export_to_git import export_all

# D30j: the export seeds these onto the org branch, so they are in the "after"
# and in no record's "before". Everything else must match byte for byte.
BUILT_IN = set(seed_assets()[1]) | set(seed_assets()[2])

REPO = Path(__file__).resolve().parents[2]
COMPOSE_CHAIN = REPO / "engine" / "compose" / "dist" / "bin" / "compose-chain.js"

requires_compose = pytest.mark.skipif(
    not COMPOSE_CHAIN.exists(),
    reason=f"{COMPOSE_CHAIN} is not built; run `npm run build -w engine/compose`.",
)


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def git(repo: str, args: list[str], stdin: bytes | None = None) -> bytes:
    return subprocess.run(
        ["git", f"--git-dir={repo}", *args], input=stdin, capture_output=True, check=True
    ).stdout


def tree_files(repo: str, tree: str) -> dict[str, str]:
    """Every file under a tree as path → sha256 of its bytes."""
    out: dict[str, str] = {}
    listing = git(repo, ["ls-tree", "-r", "-z", tree]).decode()
    for line in filter(None, listing.split("\0")):
        meta, path = line.split("\t", 1)
        oid = meta.split(" ")[2]
        out[path] = sha256(git(repo, ["cat-file", "blob", oid]))
    return out


def composed_set(repo: str, chain: list[dict[str, str]]) -> dict[str, dict]:
    """What `compose()` delivers this person, keyed by asset id."""
    done = subprocess.run(
        ["node", str(COMPOSE_CHAIN), repo, json.dumps(chain)], capture_output=True, check=True
    )
    composed = json.loads(done.stdout)
    # A conflict means the export is wrong, not that the comparison is hard:
    # a conflicting path resolves to nothing, so the sets could never match.
    assert composed["conflicts"] == [], composed["conflicts"]
    out: dict[str, dict] = {}
    for asset in composed["assets"]:
        if asset["id"] in BUILT_IN:
            continue
        files = tree_files(repo, asset["tree"])
        # The sidecar is the migration's own file; `resolve.py` never returned it.
        files.pop("asset.json", None)
        out[asset["id"]] = {"kind": asset["kind"], "name": asset["name"], "files": files}
    return out


async def resolved_set(connection, unit_id, reid: dict[str, str]) -> dict[str, dict]:
    """What `/v1/resolve` delivered this person, with ids mapped through D46."""
    out: dict[str, dict] = {}
    for asset in await resolved_assets(connection, unit_id):
        asset_id = str(asset["asset_id"])
        out[reid.get(asset_id, asset_id)] = {
            "kind": asset["kind"],
            "name": asset["name"],
            "files": {
                found["path"]: sha256(base64.b64decode(found["content_b64"]))
                for found in asset["files"]
            },
        }
    return out


async def assert_byte_identical(connection, dsn: str, out: Path) -> dict[str, int]:
    """02 §11.2 step 5, over whatever is in this database."""
    exported = await export_all(dsn, out)
    users = mismatches = 0
    assets = set()
    for org in exported["orgs"]:
        for person in org["chains"]:
            users += 1
            before = await resolved_set(connection, uuid.UUID(person["unit"]), org["reid"])
            after = composed_set(org["repo"], person["chain"])
            assets |= set(before)
            if before != after:
                mismatches += 1
                pytest.fail(
                    f"user {person['unit']} differs\n"
                    f"  only in resolve: {sorted(set(before) - set(after))}\n"
                    f"  only in compose: {sorted(set(after) - set(before))}\n"
                    f"  differing bodies: "
                    f"{sorted(k for k in set(before) & set(after) if before[k] != after[k])}"
                )
    return {"users": users, "assets": len(assets), "mismatches": mismatches}


# ---------------------------------------------------------------------------
# The fixture organization: one row of 02 §11.1's table each
# ---------------------------------------------------------------------------


async def _files(connection, mapping: dict[str, bytes]) -> dict[str, str]:
    hashes = {}
    for path, body in mapping.items():
        digest = sha256(body)
        await connection.execute(
            "insert into asset_files(hash, content, size) values ($1,$2,$3)"
            " on conflict (hash) do nothing",
            digest,
            body,
            len(body),
        )
        hashes[path] = digest
    return hashes


async def _asset(connection, unit, kind, name, files, *, status="active", pending=None):
    """An asset with real bytes, and optionally a second version awaiting review."""
    asset = await connection.fetchval(
        "insert into assets(org_unit_id, kind, name, status) values ($1,$2,$3,$4) returning id",
        unit,
        kind,
        name,
        status,
    )
    head = None
    for seq, (bodies, provenance) in enumerate(
        [(files, {})] + ([(pending, {"pending_review": True})] if pending else []), start=1
    ):
        head = await connection.fetchval(
            """insert into asset_versions(asset_id, seq, file_hashes, author_auth_user_id,
                                          message, provenance)
               values ($1,$2,$3,$4,'seed',$5) returning id""",
            asset,
            seq,
            json.dumps(await _files(connection, bodies)),
            uuid.uuid4(),
            json.dumps(provenance),
        )
    await connection.execute("update assets set head_version_id=$1 where id=$2", head, asset)
    return asset


async def _member(connection, unit) -> uuid.UUID:
    auth_user = uuid.uuid4()
    await connection.execute("insert into auth.users(id) values ($1)", auth_user)
    await connection.execute(
        "insert into org_unit_members(auth_user_id, user_unit_id) values ($1,$2)", auth_user, unit
    )
    return auth_user


async def seed(connection) -> None:
    """Three levels of team, every placement rule, and the rows §11.1 drops."""
    org = await _unit(connection, None, "org", "acme")
    marketing = await _unit(connection, org, "team", "marketing")
    interns = await _unit(connection, marketing, "team", "interns")
    eng = await _unit(connection, org, "team", "eng")
    dana = await _unit(connection, marketing, "user", "dana")
    rae = await _unit(connection, interns, "user", "rae")
    sam = await _unit(connection, eng, "user", "sam")
    for unit in (dana, rae, sam):
        await _member(connection, unit)

    # Reaches everybody: one scope row naming the organization (0022's backfill).
    org_triage = await _asset(connection, org, "skill", "triage", {"SKILL.md": b"# org triage\n"})
    await _scope(connection, org_triage, org, org)
    # …and also named at eng, where eng owns the name: shadowed_by_owner.
    await _scope(connection, org_triage, eng, org)
    eng_triage = await _asset(connection, eng, "skill", "triage", {"SKILL.md": b"# eng triage\n"})
    await _scope(connection, eng_triage, eng, eng)

    # An override chain three deep: org → marketing → dana, all one id after D46.
    org_deploy = await _asset(connection, org, "tool", "deploy", {"run": b"echo org\n"})
    await _scope(connection, org_deploy, org, org)
    mkt_deploy = await _asset(connection, marketing, "tool", "deploy", {"run": b"echo mkt\n"})
    await _scope(connection, mkt_deploy, marketing, marketing)
    await _asset(connection, dana, "tool", "deploy", {"run": b"echo dana\n"})

    # An organization asset scoped to one sibling only: sam sees it, dana does not.
    sauce = await _asset(connection, org, "prompt", "secret-sauce", {"PROMPT.md": b"# sauce\n"})
    await _scope(connection, sauce, eng, org)

    # Two owners, one name, both scoped into the interns and neither on the
    # other's chain: nothing re-ids them, so both are placed at the same
    # directory on the interns' branch and the nearer one must win whole.
    org_notice = await _asset(connection, org, "prompt", "notice", {"PROMPT.md": b"# org notice\n"})
    await _scope(connection, org_notice, interns, org)
    mkt_notice = await _asset(
        connection, marketing, "prompt", "notice", {"PROMPT.md": b"# mkt notice\n"}
    )
    await _scope(connection, mkt_notice, interns, marketing)

    # A team asset with no scope row at all: it resolved for nobody.
    await _asset(connection, eng, "tool", "unreached", {"run": b"echo nobody\n"})

    # Only the interns.
    house = await _asset(connection, interns, "memory", "house-style", {"house.md": b"# house\n"})
    await _scope(connection, house, interns, interns)

    # A pending second version must not be the exported one, and an archived
    # asset must not be exported at all.
    pending = await _asset(
        connection,
        marketing,
        "prompt",
        "brief",
        {"PROMPT.md": b"# approved\n"},
        pending={"PROMPT.md": b"# awaiting review\n"},
    )
    await _scope(connection, pending, marketing, marketing)
    gone = await _asset(
        connection, marketing, "skill", "retired", {"SKILL.md": b"# gone\n"}, status="archived"
    )
    await _scope(connection, gone, marketing, marketing)

    # The model connection, the key that backs it, and a user-owned key.
    model = {
        "provider": "anthropic",
        "model_id": "claude-sonnet-5",
        "base_url": "https://api.anthropic.com",
        "wire_format": "anthropic-messages",
        "key_ref": "secret://acme/anthropic",
    }
    connection_asset = await _asset(
        connection, org, "connection", "model-default", {"model.json": json.dumps(model).encode()}
    )
    await _scope(connection, connection_asset, org, org)
    for unit, name, ref in [
        (org, "anthropic", "secret://acme/anthropic"),
        (dana, "danas own", "secret://acme/dana"),
    ]:
        key = await connection.fetchval(
            """insert into api_keys(org_unit_id, name, ref, kind, env_var, created_by)
               values ($1,$2,$3,'provider_api_key','MODEL_DEFAULT',$4) returning id""",
            unit,
            name,
            ref,
            uuid.uuid4(),
        )
        await connection.execute(
            """insert into api_key_versions(api_key_id, version, ciphertext, last4, status)
               values ($1,1,'\\x00'::bytea,'abcd','active')""",
            key,
        )

    # allowed_tools intersected down the chain, and model_policy (D9).
    await connection.execute(
        "insert into org_unit_boundaries(org_unit_id, policy) values ($1,$2)",
        org,
        json.dumps(
            {
                "allowed_tools": ["read", "grep", "edit", "deploy-helper"],
                "model_policy": {"source": "proxied", "user_credentials": "forbidden"},
                "egress_allowlist": ["api.example.com"],
            }
        ),
    )
    await connection.execute(
        "insert into org_unit_boundaries(org_unit_id, policy) values ($1,$2)",
        marketing,
        json.dumps({"allowed_tools": ["read", "edit"]}),
    )

    # A harness whose (kind, name) resolves to a different copy per unit, and
    # one assignment that resolves to nothing.
    harness = await connection.fetchval(
        """insert into harnesses(org_unit_id, name, icon, created_by)
           values ($1,'Campaign drafts',$2,$3) returning id""",
        marketing,
        json.dumps({"palette": ["#c8875a"], "rows": ["." * 16] * 16}),
        uuid.uuid4(),
    )
    for kind, name in [("skill", "triage"), ("tool", "deploy"), ("memory", "house-style")]:
        await connection.execute(
            "insert into harness_assets(harness_id, kind, name) values ($1,$2,$3)",
            harness,
            kind,
            name,
        )


@requires_postgres
@requires_compose
async def test_migration_is_byte_identical(tmp_path):
    """00 D6, over a fixture organization that exercises every §11.1 row."""
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        name = await connection.fetchval("select current_database()")
        dsn = f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}"
        counts = await assert_byte_identical(connection, dsn, tmp_path / "out")
        assert counts == {"users": 3, "assets": 7, "mismatches": 0}


@requires_postgres
@requires_compose
async def test_the_export_records_what_it_could_not_carry(tmp_path):
    """Nothing is dropped silently (02 §11.1's rightmost column, I6)."""
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        name = await connection.fetchval("select current_database()")
        exported = await export_all(f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}", tmp_path / "out")
        recorded = {row["what"] for row in exported["report"]}
        assert {
            "reid",
            "unreached",
            "shadowed_by_owner",
            "user_key_needs_owner",
            "boundary_field_dropped",
            "tool_entry_dropped",
            "placement_collision",
        } <= recorded
        # D46 re-ids the three overrides onto the ancestor's id. Two of them —
        # marketing's deploy and dana's deploy — land on the *organization's*
        # id, which is the transitive step: dana overrode marketing, which had
        # already been re-id'd onto the org.
        reid = exported["orgs"][0]["reid"]
        assert len(reid) == 3
        assert len(set(reid.values())) == 2


@requires_postgres
@requires_compose
async def test_the_exported_branches_are_01_section_4s_layout(tmp_path):
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        name = await connection.fetchval("select current_database()")
        exported = await export_all(f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}", tmp_path / "out")
        repo = exported["orgs"][0]["repo"]
        refs = {line.split(" ")[1] for line in git(repo, ["show-ref"]).decode().splitlines()}
        assert "refs/heads/org" in refs
        assert "refs/heads/teams/acme.marketing.interns" in refs
        assert sum(ref.startswith("refs/heads/users/") for ref in refs) == 3
        listing = git(repo, ["ls-tree", "-r", "--name-only", "refs/heads/org"]).decode()
        assert "assets/skill/triage/asset.json" in listing
        assert "policy/kinds.json" in listing
        assert "policy/groups.json" in listing
        # 01 §4.2: three provider files, because each is one screen's to edit.
        for name in ("harness-providers", "model-providers", "routing"):
            assert f"policy/{name}.json" in listing


def _blob(repo: str, ref: str, path: str) -> dict:
    return json.loads(git(repo, ["cat-file", "blob", f"{ref}:{path}"]))


@requires_postgres
@requires_compose
async def test_commit_messages_are_plain(tmp_path):
    """The note the console shows beside a file is a sentence, and the node
    path `repos.ts` parses stays on the root commit, where it is not a note."""
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        name = await connection.fetchval("select current_database()")
        exported = await export_all(f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}", tmp_path / "out")
        repo = exported["orgs"][0]["repo"]
        for ref, path in (("refs/heads/org", "acme"),
                          ("refs/heads/teams/acme.marketing", "acme.marketing")):
            subjects = git(repo, ["log", "--format=%s", ref]).decode().split("\n")
            assert subjects[0] == "Migrated from the previous console."
            # 02 §5.3: the root commit is the one `branchPath()` reads, and it
            # is the only place the path appears as a message.
            assert subjects[1] == f"created {path}"
            root = git(repo, ["rev-list", "--max-parents=0", ref]).decode().strip()
            assert git(repo, ["ls-tree", "--name-only", root]).decode() == ""


@requires_postgres
@requires_compose
async def test_policy_carries_three_provider_files_kinds_and_harness_ids(tmp_path):
    """02 §11.1's provider rows, 01 §4.2's layout, and the assignment mapping."""
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        name = await connection.fetchval("select current_database()")
        exported = await export_all(f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}", tmp_path / "out")
        repo = exported["orgs"][0]["repo"]
        kinds = _blob(repo, "refs/heads/org", "policy/kinds.json")
        assert "system_prompt" in kinds and kinds == sorted(kinds)
        runtimes = _blob(repo, "refs/heads/org", "policy/harness-providers.json")
        assert [row["id"] for row in runtimes] == ["pi", "claude"]
        assert all(row["approval"] == "approved" and row["speaks"] for row in runtimes)
        models = _blob(repo, "refs/heads/org", "policy/model-providers.json")
        assert models[0]["id"] == "anthropic" and models[0]["credential"]["alias"] == "anthropic"

        # `harnesses/<id>.json` carries asset ids, not (kind, name): two of the
        # three assignments resolve at Marketing, and `memory/house-style` is
        # owned by the interns *below* it, so it resolves for nobody there.
        harness = next(path for path in git(
            repo, ["ls-tree", "-r", "--name-only", "refs/heads/teams/acme.marketing"]
        ).decode().splitlines() if path.startswith("harnesses/"))
        definition = _blob(repo, "refs/heads/teams/acme.marketing", harness)
        assert len(definition["assets"]) == 2
        assert all(uuid.UUID(asset) for asset in definition["assets"])
        assert {row["what"] for row in exported["report"]} >= {"assignment_unresolved",
                                                               "harness_providers_seeded"}


@requires_postgres
@requires_compose
async def test_routing_is_keyed_by_the_owning_path(tmp_path):
    """D30i: `defaultFor.teams` takes the organization's own path, and
    preflight walks up to it — so the one organization-owned connection is one
    line, not a copy onto every team."""
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        name = await connection.fetchval("select current_database()")
        exported = await export_all(f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}", tmp_path / "out")
        routing = _blob(exported["orgs"][0]["repo"], "refs/heads/org", "policy/routing.json")
        assert routing["defaultFor"]["teams"] == {"acme": "anthropic"}
        assert routing["approvedFor"]["teams"] == {"acme": ["anthropic"]}
        assert not any(row["what"] == "routing_keyed_by_org_path" for row in exported["report"])


@requires_postgres
@requires_compose
async def test_the_migrated_catalogue_is_seeded_and_filled_by_id(tmp_path):
    """D30h's other half: a migrated organization gets the presets too, and the
    `anthropic` row the records held keeps its credential rather than being
    replaced by the preset of the same id."""
    async with scratch_db(_all_migrations()) as connection:
        await seed(connection)
        name = await connection.fetchval("select current_database()")
        exported = await export_all(f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}", tmp_path / "out")
        repo = exported["orgs"][0]["repo"]
        models = _blob(repo, "refs/heads/org", "policy/model-providers.json")
        assert [row["id"] for row in models] == ["anthropic", "openrouter", "openai"]
        assert models[0]["credential"] == {"alias": "anthropic"}
        assert models[0]["models"] == ["claude-sonnet-5"]
        assert all("credential" not in row for row in models[1:])
        # The legacy group and its grant are untouched by the seed.
        assert [row["name"] for row in _blob(repo, "refs/heads/org", "policy/groups.json")] == [
            "legacy-anthropic"]
        # D30j: the built-in skill arrives with the catalogue, bytes and id.
        authoring = "assets/skill/harness-authoring"
        # W5-D10's two lists, filled by id like everything else the seed writes.
        assert _blob(repo, "refs/heads/org", "policy/always-loaded.json") == {
            "required": seed_assets()[1], "recommended": seed_assets()[2],
        }
        assert git(repo, ["cat-file", "blob", f"refs/heads/org:{authoring}/SKILL.md"]) == (
            seed_assets()[0][f"{authoring}/SKILL.md"]
        )


DEV_DATABASE_URL = os.environ.get("MIGRATION_DEV_DATABASE_URL")


@requires_postgres
@requires_compose
@pytest.mark.skipif(
    not DEV_DATABASE_URL,
    reason=(
        "Set MIGRATION_DEV_DATABASE_URL to run D6 against the development "
        "records. It is read-only there: the rows are copied into a scratch "
        "database first, because the development database predates 0022 and "
        "`resolved_assets` cannot run without `asset_scopes`."
    ),
)
async def test_migration_is_byte_identical_against_the_development_records(tmp_path):
    """The same acceptance test, over the rows that are actually in the product."""
    source = await asyncpg.connect(
        DEV_DATABASE_URL,
        statement_cache_size=0,
        server_settings={"default_transaction_read_only": "on"},
    )
    try:
        tables = [
            "org_units",
            "org_unit_members",
            "asset_kinds",
            "assets",
            "asset_versions",
            "asset_files",
            "harnesses",
            "harness_assets",
            "api_keys",
            "api_key_versions",
            "org_unit_boundaries",
        ]
        rows = {table: await source.fetch(f"select * from {table}") for table in tables}
    finally:
        await source.close()

    async with scratch_db(_all_migrations()) as connection:
        await connection.execute("delete from asset_kinds")
        for table in tables:
            for row in rows[table]:
                if table == "org_unit_members":
                    await connection.execute(
                        "insert into auth.users(id) values ($1) on conflict do nothing",
                        row["auth_user_id"],
                    )
                columns = list(row.keys())
                if table == "org_units":
                    # `path` is computed by the trigger from parent and name.
                    columns = [c for c in columns if c != "path"]
                if table == "assets":
                    # assets ↔ asset_versions is a cycle of foreign keys; the
                    # head is set once the versions are in (below).
                    columns = [c for c in columns if c != "head_version_id"]
                values = [
                    json.dumps(row[c]) if isinstance(row[c], dict | list) else row[c]
                    for c in columns
                ]
                await connection.execute(
                    f"insert into {table}({','.join(columns)}) values "
                    f"({','.join(f'${i + 1}' for i in range(len(columns)))})",
                    *values,
                )
        for row in rows["assets"]:
            await connection.execute(
                "update assets set head_version_id=$1 where id=$2",
                row["head_version_id"],
                row["id"],
            )
        # 0022's backfill, which ran against an empty table at migration time:
        # every asset reaches its owner and everything beneath it, unchanged.
        await connection.execute(
            "insert into asset_scopes(asset_id, org_unit_id, granted_by)"
            " select id, org_unit_id, org_unit_id from assets"
        )
        name = await connection.fetchval("select current_database()")
        dsn = f"{ADMIN_DSN.rsplit('/', 1)[0]}/{name}"
        counts = await assert_byte_identical(connection, dsn, tmp_path / "out")
        assert counts["mismatches"] == 0
        assert counts["users"] >= 1
        print(f"\ndevelopment records: {counts}")
