import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import asyncpg

ZERO_HASH = "0" * 64


def canonical_event(
    org_unit_id: UUID | str,
    actor_type: str,
    actor_id: UUID | str | None,
    event_class: str,
    action: str,
    payload: dict[str, Any],
    created_at: datetime,
) -> str:
    value = {
        "org_unit_id": str(org_unit_id),
        "actor_type": actor_type,
        "actor_id": str(actor_id) if actor_id else None,
        "class": event_class,
        "action": action,
        "payload": payload,
        "created_at": created_at.astimezone(UTC).isoformat(),
    }
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def event_hash(previous: str, canonical_json: str) -> str:
    return hashlib.sha256((previous + canonical_json).encode()).hexdigest()


async def append_event(
    connection: asyncpg.Connection,
    *,
    org_unit_id: UUID,
    actor_type: str,
    actor_id: UUID | None,
    event_class: str,
    action: str,
    payload: dict[str, Any],
    created_at: datetime | None = None,
) -> dict[str, Any]:
    timestamp = created_at or datetime.now(UTC)
    await connection.execute(
        """insert into audit_log_latest_hashes(org_unit_id,last_hash) values($1,$2)
           on conflict (org_unit_id) do nothing""",
        org_unit_id,
        ZERO_HASH,
    )
    previous = await connection.fetchval(
        "select last_hash from audit_log_latest_hashes where org_unit_id=$1 for update",
        org_unit_id,
    )
    digest = event_hash(
        previous,
        canonical_event(org_unit_id, actor_type, actor_id, event_class, action, payload, timestamp),
    )
    row = await connection.fetchrow(
        """insert into audit_log
           (org_unit_id,actor_type,actor_id,class,action,payload,prev_hash,hash,created_at)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *""",
        org_unit_id,
        actor_type,
        actor_id,
        event_class,
        action,
        json.dumps(payload),
        previous,
        digest,
        timestamp,
    )
    await connection.execute(
        "update audit_log_latest_hashes set last_hash=$2 where org_unit_id=$1",
        org_unit_id,
        digest,
    )
    return dict(row)


def verify_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    previous = ZERO_HASH
    for row in records:
        expected = event_hash(
            previous,
            canonical_event(
                row["org_unit_id"],
                row["actor_type"],
                row.get("actor_id"),
                row["class"],
                row["action"],
                row["payload"],
                row["created_at"],
            ),
        )
        if row["prev_hash"] != previous or row["hash"] != expected:
            return {"intact": False, "broken_id": row["id"]}
        previous = row["hash"]
    return {"intact": True}
