"""02 §8: the index write endpoint and the three read seams it feeds."""

import uuid

import pytest
from test_broker import (
    ORG_PATH,
    ORG_REF,
    SERVICE_TOKEN,
    TEAM_PATH,
    TEAM_REF,
    _policy,
    _write_index,
    all_nodes,
    seed,
)
from test_resolve import _all_migrations, _request, requires_postgres, scratch_db

from app.api import routes_internal
from app.domain import console_index


@requires_postgres
async def test_index_write_is_idempotent_and_replaces_the_refs_rows():
    """10 rule 19: run it twice, and the second run writes nothing new."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        counts = ("idx_nodes", "idx_policy", "idx_refs")
        before = {
            table: await connection.fetchval(f"select count(*) from {table}") for table in counts
        }
        await _write_index(
            connection,
            world["org"],
            ORG_REF,
            "c-org",
            {
                "idx_nodes": all_nodes(world["person"]),
                "idx_policy": [
                    {"node_path": ORG_PATH, "file": name, "body": body}
                    for name, body in _policy().items()
                ],
            },
        )
        after = {
            table: await connection.fetchval(f"select count(*) from {table}") for table in counts
        }
        assert before == after

        # A second write with fewer files removes the ones it no longer names.
        await _write_index(
            connection,
            world["org"],
            ORG_REF,
            "c-org-2",
            {
                "idx_nodes": all_nodes(world["person"]),
                "idx_policy": [{"node_path": ORG_PATH, "file": "kinds.json", "body": ["skill"]}],
            },
        )
        assert (
            await connection.fetchval(
                "select count(*) from idx_policy where node_path=$1", ORG_PATH
            )
            == 1
        )
        assert (
            await connection.fetchval("select commit from idx_refs where ref=$1", ORG_REF)
            == "c-org-2"
        )


@requires_postgres
async def test_stale_form_blocks_the_three_reads_and_a_write_clears_it():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        await routes_internal.write_index(
            routes_internal.IndexWrite(
                org=world["org"], ref=ORG_REF, commit="c-org", stale={"error": "compose threw"}
            ),
            _request(connection),
            f"Bearer {SERVICE_TOKEN}",
        )
        for read in (
            console_index.org_policy(connection, world["org"]),
            console_index.harness(connection, world["org"], uuid.uuid4()),
            console_index.effective_for(connection, world["org"], world["person"]),
        ):
            with pytest.raises(console_index.IndexStale):
                await read

        await _write_index(
            connection,
            world["org"],
            ORG_REF,
            "c-org",
            {"idx_nodes": all_nodes(world["person"])},
        )
        assert await connection.fetchval("select count(*) from idx_stale") == 0
        assert await console_index.org_policy(connection, world["org"]) is not None


@requires_postgres
async def test_org_policy_shapes_the_effective_policy():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        policy = await console_index.org_policy(connection, world["org"])
        assert set(policy["groups"]) == {"marketing"}
        assert policy["harnessProviders"]["pi"]["approval"] == "approved"
        assert policy["modelProviders"]["anthropic"]["models"] == ["claude-sonnet-5"]
        assert policy["routing"]["approvedFor"]["teams"][TEAM_PATH] == ["anthropic"]
        assert [grant["id"] for grant in policy["grants"]] == ["g-marketing"]
        assert policy["kinds"] == ["skill"]


@requires_postgres
async def test_effective_for_walks_the_chain_and_collects_narrowed_grants():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        narrowed = {
            "id": "g-interns",
            "scope": {"teams": [TEAM_PATH]},
            "group": "marketing",
            "narrowedFrom": {"grant": "g-marketing", "aliases": ["crm"]},
            "by": "rae",
        }
        await _write_index(
            connection,
            world["org"],
            TEAM_REF,
            "c-team",
            {
                "idx_nodes": all_nodes(world["person"]),
                "idx_policy": [
                    {"node_path": TEAM_PATH, "file": "grants.json", "body": [narrowed]}
                ],
            },
        )
        effective = await console_index.effective_for(connection, world["org"], world["person"])
        assert [node["path"] for node in effective["chain"]] == [
            ORG_PATH,
            TEAM_PATH,
            "acme.marketing.dana",
        ]
        assert [node["kind"] for node in effective["chain"]] == ["org", "team", "user"]
        assert effective["chain"][0]["commit"] == "c-org"
        assert {grant["id"] for grant in effective["grants"]} == {"g-marketing", "g-interns"}


@requires_postgres
async def test_harness_read_and_a_harness_off_the_chain_is_not_found():
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        harness_id = uuid.uuid4()
        await _write_index(
            connection,
            world["org"],
            TEAM_REF,
            "c-team",
            {
                "idx_nodes": all_nodes(world["person"]),
                "idx_harnesses": [
                    {
                        "node_path": TEAM_PATH,
                        "id": harness_id,
                        "name": "Support",
                        "def": {"id": str(harness_id), "name": "Support", "assets": []},
                    }
                ],
            },
        )
        found = await console_index.harness(connection, world["org"], harness_id)
        assert found["name"] == "Support"
        assert await console_index.harness(connection, world["org"], uuid.uuid4()) is None


@requires_postgres
async def test_edges_are_replaced_per_ref_not_per_org():
    """02 §8.3 step 5: one ref's re-index leaves another ref's edges alone."""
    async with scratch_db(_all_migrations()) as connection:
        world = await seed(connection)
        nodes = all_nodes(world["person"])
        await _write_index(
            connection,
            world["org"],
            TEAM_REF,
            "c-team",
            {
                "idx_nodes": nodes,
                "idx_edges": [
                    {
                        "from_kind": "asset",
                        "from_id": "a-1",
                        "rel": "placed_on",
                        "to_kind": "node",
                        "to_id": TEAM_PATH,
                    }
                ],
            },
        )
        await _write_index(
            connection,
            world["org"],
            ORG_REF,
            "c-org-2",
            {
                "idx_nodes": nodes,
                "idx_edges": [
                    {
                        "from_kind": "group",
                        "from_id": "marketing",
                        "rel": "entry",
                        "to_kind": "alias",
                        "to_id": "crm",
                    }
                ],
            },
        )
        rows = await connection.fetch(
            "select ref, from_id from idx_edges where org=$1 order by from_id", world["org"]
        )
        assert [(row["ref"], row["from_id"]) for row in rows] == [
            (TEAM_REF, "a-1"),
            (ORG_REF, "marketing"),
        ]

        # Re-indexing the team ref with no edges clears only its own.
        await _write_index(
            connection, world["org"], TEAM_REF, "c-team-2", {"idx_nodes": nodes, "idx_edges": []}
        )
        assert await connection.fetchval(
            "select count(*) from idx_edges where org=$1", world["org"]
        ) == 1
