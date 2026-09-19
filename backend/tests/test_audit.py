from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.deps import current_principal
from app.domain.audit import ZERO_HASH, canonical_event, event_hash, verify_records
from app.identity import Principal
from app.main import create_app


def make_chain():
    org_id = uuid4()
    actor_id = uuid4()
    created = datetime(2026, 1, 1, tzinfo=UTC)
    rows = []
    previous = ZERO_HASH
    for index, action in enumerate(("asset.push", "resolve"), start=1):
        timestamp = created + timedelta(seconds=index)
        payload = {"index": index}
        digest = event_hash(
            previous,
            canonical_event(org_id, "user", actor_id, "authoritative", action, payload, timestamp),
        )
        rows.append(
            {
                "id": index,
                "org_unit_id": org_id,
                "actor_type": "user",
                "actor_id": actor_id,
                "class": "authoritative",
                "action": action,
                "payload": payload,
                "prev_hash": previous,
                "hash": digest,
                "created_at": timestamp,
            }
        )
        previous = digest
    return rows


def test_hash_chain_verifies_and_is_deterministic():
    rows = make_chain()
    assert verify_records(rows) == {"intact": True}
    assert rows[0]["hash"] != make_chain()[0]["hash"]  # UUIDs make distinct chains.


def test_hash_chain_detects_payload_tampering():
    rows = make_chain()
    rows[0]["payload"]["index"] = 99
    assert verify_records(rows) == {"intact": False, "broken_id": 1}


def test_hash_chain_detects_a_removed_link():
    rows = make_chain()
    assert verify_records(rows[1:]) == {"intact": False, "broken_id": 2}


def test_query_audit_rolls_up_descendants_but_not_a_siblings_events():
    """An org admin sees a descendant's events; a sibling team does not see the other's."""
    org_id, team_a_id, team_b_id = uuid4(), uuid4(), uuid4()
    parents = {team_a_id: org_id, team_b_id: org_id}
    events = [
        {"id": 1, "org_unit_id": org_id, "action": "org.event"},
        {"id": 2, "org_unit_id": team_a_id, "action": "team_a.event"},
        {"id": 3, "org_unit_id": team_b_id, "action": "team_b.event"},
    ]
    common = {
        "actor_type": "user",
        "actor_id": str(uuid4()),
        "class": "authoritative",
        "payload": {},
        "created_at": "2026-01-01T00:00:00+00:00",
    }

    class FakePool:
        """A tiny org tree and audit log, so the descendant walk in
        `descendant_events` runs through the real route rather than being
        asserted against canned output."""

        async def fetchrow(self, query, *args):
            _auth_user_id, org_unit_id = args
            return {"level": "admin", "org_unit_id": org_unit_id}

        async def fetch(self, query, *args):
            assert "with recursive tree" in query
            org_unit_id, after, limit = args
            descendants = {org_unit_id}
            frontier = [org_unit_id]
            while frontier:
                current = frontier.pop()
                for unit, parent in parents.items():
                    if parent == current and unit not in descendants:
                        descendants.add(unit)
                        frontier.append(unit)
            rows = [
                {**common, **event}
                for event in events
                if event["org_unit_id"] in descendants
                and (after is None or event["id"] < after)
            ]
            return sorted(rows, key=lambda row: row["id"], reverse=True)[:limit]

    app = create_app(pool=FakePool())

    async def principal():
        return Principal(uuid4())

    app.dependency_overrides[current_principal] = principal
    with TestClient(app) as client:
        org_view = client.get(f"/v1/org-units/{org_id}/audit").json()
        team_a_view = client.get(f"/v1/org-units/{team_a_id}/audit").json()

    assert {row["action"] for row in org_view} == {"org.event", "team_a.event", "team_b.event"}
    assert [row["action"] for row in team_a_view] == ["team_a.event"]
