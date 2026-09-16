from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.domain.audit import ZERO_HASH, canonical_event, event_hash, verify_records


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
