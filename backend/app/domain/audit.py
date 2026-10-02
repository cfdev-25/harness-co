import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import asyncpg

ZERO_HASH = "0" * 64
# 04 §6, *Audit partitions*. A no-op once the month has been seen, so the
# common path costs a set lookup; the pool-start call in db.py stays.
_PARTITIONED: set[tuple[int, int]] = set()


async def ensure_partition_for(connection: asyncpg.Connection, created_at: datetime) -> None:
    year, month = created_at.year, created_at.month
    if (year, month) in _PARTITIONED:
        return
    for _ in range(2):
        start = datetime(year, month, 1, tzinfo=UTC)
        end = datetime(year + 1, 1, 1, tzinfo=UTC) if month == 12 else datetime(
            year, month + 1, 1, tzinfo=UTC
        )
        await connection.execute(
            f"""create table if not exists audit_log_{year:04d}_{month:02d}
                partition of audit_log for values from ('{start.isoformat()}')
                to ('{end.isoformat()}')"""
        )
        _PARTITIONED.add((year, month))
        year, month = end.year, end.month


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
    await ensure_partition_for(connection, timestamp)
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


async def descendant_events(
    connection: asyncpg.Connection,
    org_unit_id: UUID,
    *,
    after: int | None,
    limit: int,
) -> list[dict[str, Any]]:
    """A unit's audit view, per prd.md §1.10: it rolls up the tree it governs.

    Every other recursive walk in this codebase goes up, from a user to
    their ancestors. This one goes down, because audit is read by whoever
    governs a subtree, about the subtree, not by someone asking what applies
    to them. `id` is a single identity shared across the audit_log
    partitions, so ordering and keyset pagination on it still hold once rows
    from more than one unit are interleaved.
    """
    rows = await connection.fetch(
        """with recursive tree as (
             select id from org_units where id=$1
             union all select o.id from org_units o join tree t on o.parent_id=t.id
           ) select a.id,a.org_unit_id,a.actor_type,a.actor_id,a.class,a.action,a.payload,
                    a.created_at
             from audit_log a join tree t on t.id=a.org_unit_id
             where ($2::bigint is null or a.id<$2)
             order by a.id desc limit $3""",
        org_unit_id,
        after,
        limit,
    )
    return [dict(row) for row in rows]


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
