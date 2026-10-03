"""W7-D8: a boundary bound to named harnesses, at the wire and in the file.

The fixtures are `test_writes.py`'s — one organization, two teams, three
people, a real Postgres and the one permitted mock at the network edge — with
the organization's and the team's deny lists given a **harness-scoped** row:
`{ teams, harnesses: [] }`, a boundary that applies to no harness until one is
bound. Every assertion here is about the file that was committed, because the
scope is what `covers()` reads and nothing else decides whether a session is
refused.
"""

import uuid

import pytest
from test_resolve import _request, requires_postgres  # type: ignore[import-not-found]
from test_writes import (  # type: ignore[import-not-found]
    INTERNS,
    ORG,
    ORG_POLICY,
    ORG_REF,
    TEAM,
    TEAM_POLICY,
    TEAM_REF,
    _actions,
    _files,
    fake_definitions,
    world,
)

from app.api import routes_writes
from app.errors import ApiError

# The two rows this file is about, beside the universal ones `world()` already
# writes: one at the organization, one at the team.
ORG_SCOPED = {
    "id": "b-scoped", "scope": {"teams": "all", "harnesses": []}, "kind": "command",
    "value": "git push --force*", "holds": "intercepted",
    "reason": "A protected branch is protected in every harness that asked for it.",
}
TEAM_SCOPED = {
    "id": "b-team-scoped", "scope": {"teams": [TEAM], "harnesses": []},
    "kind": "filesystem", "value": "/etc/shadow", "holds": "enforced",
    "reason": "Nothing a session does reads it.",
}


def _files_with_scoped_boundaries() -> dict[tuple[str, str], object]:
    return _files() | {
        ("c-org", "policy/boundaries.json"): [*ORG_POLICY["boundaries.json"], ORG_SCOPED],
        ("c-team", "policy/boundaries.json"): [*TEAM_POLICY["boundaries.json"], TEAM_SCOPED],
    }


def _bound(rows: object, boundary_id: str) -> list:
    """The `scope.harnesses` of one row of a written file."""
    row = next(entry for entry in rows if entry["id"] == boundary_id)  # type: ignore[union-attr]
    return row["scope"]["harnesses"]


# --- creation (the modal's third question) ----------------------------------


@requires_postgres
async def test_a_new_harness_binds_every_boundary_the_modal_ticked():
    """One commit per node that holds a ticked boundary, after the harness
    commit, with the harness's id appended to that row's `scope.harnesses` and
    to no other row."""
    async with world() as w, fake_definitions(_files_with_scoped_boundaries()) as fake:
        connection = w["connection"]
        result = await routes_writes.create_harness_on_ref(
            routes_writes.HarnessIn(
                name="Drafts", boundaries=[f"{ORG}/b-scoped", f"{TEAM}/b-team-scoped"]
            ),
            _request(connection),
            w["ana"],
        )
        harness_id = result["id"]
        assert [commit["ref"] for commit in fake.commits] == [
            f"refs/heads/users/{w['ana'].auth_user_id}", ORG_REF, TEAM_REF,
        ]
        # The organization's row names the new harness; the universal row it
        # sits beside is untouched, and still has no `harnesses` at all.
        org_rows = fake.changed(1)
        assert _bound(org_rows, "b-scoped") == [harness_id]
        assert "harnesses" not in next(r for r in org_rows if r["id"] == "b-org")["scope"]
        assert _bound(fake.changed(2), "b-team-scoped") == [harness_id]
        assert await _actions(connection) == [
            "harness.create", "boundary.bind", "boundary.bind",
        ]


@requires_postgres
async def test_a_universal_boundary_cannot_be_bound_and_nothing_is_committed():
    """A boundary with no `harnesses` in its scope applies to every harness the
    level holds, so there is nothing to bind — and the refusal lands before the
    harness commit, because a commit `definitions` has made does not come back
    when this transaction rolls back."""
    async with world() as w, fake_definitions(_files_with_scoped_boundaries()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as refusal:
            await routes_writes.create_harness_on_ref(
                routes_writes.HarnessIn(name="Drafts", boundaries=[f"{ORG}/b-org"]),
                _request(connection),
                w["ana"],
            )
        assert (refusal.value.status_code, refusal.value.code) == (422, "invalid_request")
        assert "already applies to every harness" in refusal.value.message
        assert fake.commits == []
        assert await _actions(connection) == []


@requires_postgres
async def test_a_boundary_off_the_caller_s_chain_is_refused():
    """`interns` is inside the organization and not on ana's chain, and an id
    nothing on the chain answers is the same refusal: a boundary you cannot be
    reached by is not one you may bind."""
    async with world() as w, fake_definitions(_files_with_scoped_boundaries()) as fake:
        connection = w["connection"]
        for composed in (f"{INTERNS}/b-scoped", f"{ORG}/b-nothing"):
            with pytest.raises(ApiError) as refusal:
                await routes_writes.create_harness_on_ref(
                    routes_writes.HarnessIn(name="Drafts", boundaries=[composed]),
                    _request(connection),
                    w["ana"],
                )
            assert (refusal.value.status_code, refusal.value.code) == (
                404, "boundary_not_found",
            )
        assert fake.commits == []


# --- add more later, and unbind ---------------------------------------------


@requires_postgres
async def test_binding_appends_the_harness_and_binding_twice_is_one_commit():
    async with world() as w, fake_definitions(_files_with_scoped_boundaries()) as fake:
        connection = w["connection"]
        harness_id = w["team_harness"]
        await routes_writes.bind_boundaries_to_harness(
            uuid.UUID(harness_id),
            routes_writes.BoundaryIdsIn(ids=[f"{ORG}/b-scoped"]),
            _request(connection),
            w["ana"],
        )
        assert _bound(fake.changed(0), "b-scoped") == [harness_id]

        # Asking again changes nothing, so it commits nothing — and the caller
        # still gets the head they would have had.
        answer = await routes_writes.bind_boundaries_to_harness(
            uuid.UUID(harness_id),
            routes_writes.BoundaryIdsIn(ids=[f"{ORG}/b-scoped"]),
            _request(connection),
            w["ana"],
        )
        assert len(fake.commits) == 1
        assert answer["bound"] == [] and answer["ref"] == ORG_REF
        assert await _actions(connection) == ["boundary.bind"]


@requires_postgres
async def test_unbinding_empties_the_list_and_never_makes_it_universal():
    """The list goes back to `[]` — *no harness yet*, which is a state the
    screen has words for — and the key stays on the scope. Taking it off would
    turn one harness's deny into every harness's."""
    async with world() as w, fake_definitions(_files_with_scoped_boundaries()) as fake:
        connection = w["connection"]
        harness_id = w["team_harness"]
        await routes_writes.bind_boundaries_to_harness(
            uuid.UUID(harness_id),
            routes_writes.BoundaryIdsIn(ids=[f"{TEAM}/b-team-scoped"]),
            _request(connection),
            w["rae"],
        )
        answer = await routes_writes.unbind_boundary_from_harness(
            uuid.UUID(harness_id),
            f"{TEAM}/b-team-scoped",
            _request(connection),
            w["rae"],
        )
        rows = fake.changed(1)
        assert _bound(rows, "b-team-scoped") == []
        assert answer["unbound"] == [f"{TEAM}/b-team-scoped"]
        assert await _actions(connection) == ["boundary.bind", "boundary.unbind"]


@requires_postgres
async def test_binding_is_refused_for_anyone_who_does_not_administer_the_node():
    """Binding edits the boundary's own row, so it is decided where the row is
    — the same answer `DELETE /v1/boundaries/{id}` gives (04 §9)."""
    async with world() as w, fake_definitions(_files_with_scoped_boundaries()) as fake:
        connection = w["connection"]
        with pytest.raises(ApiError) as refusal:
            await routes_writes.bind_boundaries_to_harness(
                uuid.UUID(w["harness"]),
                routes_writes.BoundaryIdsIn(ids=[f"{ORG}/b-scoped"]),
                _request(connection),
                w["dana"],
            )
        assert (refusal.value.status_code, refusal.value.code) == (403, "boundary.not_yours")
        assert "admins decide this one" in refusal.value.message
        assert fake.commits == []
        assert await _actions(connection) == []
