"""Service-to-service endpoints (00 §4.10).

`definitions` ↔ `api`, authenticated by a shared bearer from the environment,
never a person's token. There is no default: without `HARNESS_SERVICE_TOKEN`
set, every call here is refused.
"""

import json
import os
from secrets import compare_digest
from typing import Annotated, Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Header, Request, Response, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.db import get_pool, transaction
from app.domain import broker
from app.domain.audit import append_event
from app.errors import ApiError
from app.identity import verify_authorization

router = APIRouter(tags=["internal"])

# 02 §8.3 step 4's `rows`, as `engine/definitions/src/indexer.ts` posts it:
# one key per table, each row carrying the columns below (`org` rides on the
# body, so a row's own copy of it is ignored).
_NODE_TABLES = {
    "idx_assets": ("node_path", "id", "kind", "name", "tree", "sidecar"),
    "idx_harnesses": ("node_path", "id", "name", "def"),
    "idx_policy": ("node_path", "file", "body"),
}
_JSON_COLUMNS = {"sidecar", "def", "body"}


class IndexRef(BaseModel):
    ref: str
    commit: str
    paths: list[str] = Field(default_factory=list)


class IndexWrite(BaseModel):
    org: UUID
    ref: str
    # Absent on the truncate form: there is no commit being indexed, only rows
    # being taken out.
    commit: str = ""
    rows: dict[str, list[dict[str, Any]]] | None = None
    stale: dict[str, str] | None = None
    truncate: bool = False


class PolicyChanged(BaseModel):
    org: UUID
    refs: list[IndexRef]


class AuditBatch(BaseModel):
    org: UUID
    events: list[dict[str, Any]] = Field(max_length=500)


def _service(authorization: str | None) -> None:
    expected = os.environ.get("HARNESS_SERVICE_TOKEN", "")
    prefixed = authorization and authorization.startswith("Bearer ")
    given = authorization[7:].strip() if prefixed else ""
    if not expected or not given or not compare_digest(given, expected):
        raise ApiError(401, "service_token_required", "This endpoint is not yours to call.")


@router.post("/internal/index", status_code=status.HTTP_204_NO_CONTENT)
async def write_index(
    body: IndexWrite, request: Request, authorization: Annotated[str | None, Header()] = None
) -> Response:
    """One transaction: replace this ref's rows, or record it stale (02 §8.3).

    Scope of the replacement, matching what `definitions` sends per ref:
    `idx_nodes` is the org's whole tree; `idx_assets`, `idx_harnesses` and
    `idx_policy` are this ref's node; `idx_effective` is the users recomposed;
    `idx_edges` is this ref's whole set, keyed by the `ref` column. A successful
    write clears the ref's `idx_stale` row.
    """
    _service(authorization)
    async with transaction(get_pool(request)) as connection:
        if body.truncate:
            await _truncate(connection, body.org, body.ref)
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        if body.stale is not None:
            await connection.execute(
                """insert into idx_stale(org, ref, commit, error) values($1,$2,$3,$4)
                   on conflict (org, ref) do update set commit=$3, error=$4, at=now()""",
                body.org,
                body.ref,
                body.commit,
                body.stale.get("error", ""),
            )
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        rows = body.rows or {}
        await connection.execute(
            """insert into idx_refs(org, ref, commit) values($1,$2,$3)
               on conflict (org, ref) do update set commit=$3, indexed_at=now()""",
            body.org,
            body.ref,
            body.commit,
        )
        # The node set is the org's whole tree on every write, so it replaces.
        nodes = rows.get("idx_nodes", [])
        if nodes:
            await connection.execute("delete from idx_nodes where org=$1", body.org)
            await _insert(
                connection,
                "idx_nodes",
                ("path", "kind", "ref", "parent_path"),
                body.org,
                nodes,
            )
        # Placements, harnesses and policy come from the pushed ref's own trees,
        # so the scope is that ref's node and no other.
        node_path = next(
            (row["path"] for row in nodes if row["ref"] == body.ref),
            await connection.fetchval(
                "select path from idx_nodes where org=$1 and ref=$2", body.org, body.ref
            ),
        )
        for table, columns in _NODE_TABLES.items():
            await connection.execute(
                f"delete from {table} where org=$1 and node_path=$2", body.org, node_path
            )
            await _insert(connection, table, columns, body.org, rows.get(table, []))
        effective = rows.get("idx_effective", [])
        await connection.execute(
            "delete from idx_effective where org=$1 and user_id = any($2::uuid[])",
            body.org,
            sorted({UUID(str(row["user_id"])) for row in effective}),
        )
        await _insert(
            connection,
            "idx_effective",
            ("user_id", "asset_id", "from_path", "shadows_path"),
            body.org,
            effective,
        )
        # Edges are derived from this ref's trees, so `idx_edges.ref` is how one
        # ref's set is replaced without touching another's.
        await connection.execute(
            "delete from idx_edges where org=$1 and ref=$2", body.org, body.ref
        )
        await _insert(
            connection,
            "idx_edges",
            ("ref", "from_kind", "from_id", "rel", "to_kind", "to_id"),
            body.org,
            [{"ref": body.ref, **row} for row in rows.get("idx_edges", [])],
        )
        await connection.execute(
            "delete from idx_stale where org=$1 and ref=$2", body.org, body.ref
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _truncate(connection: asyncpg.Connection, org: UUID, ref: str) -> None:
    """`{ org, ref, truncate: true }` — everything this ref put in the index,
    taken out (02 §8.3).

    A rebuild (§8.5) re-indexes ref by ref, and a ref that no longer holds a
    file it once held would otherwise leave that row behind: the delete in the
    write form is scoped to the node and the ref, so nothing removes the rows
    of a ref that is *gone*. `idx_nodes` is the organization's whole tree on
    every write and belongs to no single ref, so it is never truncated here.
    """
    node_path = await connection.fetchval(
        "select path from idx_nodes where org=$1 and ref=$2", org, ref
    )
    for table in ("idx_assets", "idx_harnesses", "idx_policy"):
        await connection.execute(
            f"delete from {table} where org=$1 and node_path=$2", org, node_path
        )
    if ref.startswith("refs/heads/users/"):
        # A user ref's rows in `idx_effective` are that person's composition.
        await connection.execute(
            "delete from idx_effective where org=$1 and user_id=$2",
            org,
            UUID(ref.rsplit("/", 1)[-1]),
        )
    await connection.execute("delete from idx_edges where org=$1 and ref=$2", org, ref)
    await connection.execute("delete from idx_refs where org=$1 and ref=$2", org, ref)
    await connection.execute("delete from idx_stale where org=$1 and ref=$2", org, ref)


async def _insert(
    connection: asyncpg.Connection,
    table: str,
    columns: tuple[str, ...],
    org: UUID,
    rows: list[dict[str, Any]],
) -> None:
    if not rows:
        return
    names = ", ".join(f'"{column}"' for column in columns)
    holders = ", ".join(f"${index + 2}" for index in range(len(columns)))
    for row in rows:
        await connection.execute(
            f'insert into {table}(org, {names}) values($1, {holders})',
            org,
            *(
                json.dumps(row.get(column))
                if column in _JSON_COLUMNS
                else row.get(column)
                for column in columns
            ),
        )


@router.post("/internal/policy-changed", status_code=status.HTTP_204_NO_CONTENT)
async def policy_changed(
    body: PolicyChanged, request: Request, authorization: Annotated[str | None, Header()] = None
) -> Response:
    """5.5. `definitions` sends this only for a push that touched `policy/` or
    `harnesses/` on an org or team ref, so every listed ref is a policy change."""
    _service(authorization)
    async with transaction(get_pool(request)) as connection:
        await broker.revoke_for_refs(connection, body.org, [item.ref for item in body.refs])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/internal/audit", status_code=status.HTTP_204_NO_CONTENT)
async def internal_audit(
    body: AuditBatch, request: Request, authorization: Annotated[str | None, Header()] = None
) -> Response:
    """`definitions`' authoritative events onto the org's chain."""
    _service(authorization)
    async with transaction(get_pool(request)) as connection:
        for event in body.events:
            action = event.get("action") or event["event"]
            await append_event(
                connection,
                org_unit_id=body.org,
                actor_type="system",
                actor_id=UUID(event["actor_id"]) if event.get("actor_id") else None,
                event_class="authoritative",
                action=action,
                payload={k: v for k, v in event.items() if k not in ("action", "event")},
            )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/internal/principal")
async def internal_principal(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_harness_token: Annotated[str | None, Header()] = None,
) -> dict:
    """`definitions` resolves a git-transport token to the refs it may advertise."""
    _service(authorization)
    pool = get_pool(request)
    principal = await verify_authorization(f"Bearer {x_harness_token or ''}", pool, get_settings())
    unit = await pool.fetchrow(
        """select u.id from org_unit_members m join org_units u on u.id=m.user_unit_id
            where m.auth_user_id=$1""",
        principal.auth_user_id,
    )
    if unit is None:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    org_id = await broker._org_id(pool, unit["id"])
    chain = await broker.chain_for(pool, unit["id"], principal.auth_user_id, org_id)
    role = await broker.role_on_chain(pool, principal.auth_user_id, chain)
    readable: list[str] = []
    if role["at"] is not None:
        # A team admin may fetch the user refs of members in teams under
        # `role.at` (02 §4). An org admin's `role.at` is the org path, so the
        # same query covers both.
        readable = [
            f"refs/heads/users/{row['auth_user_id']}"
            for row in await pool.fetch(
                """select m.auth_user_id from org_unit_members m
                     join org_units u on u.id=m.user_unit_id
                    where u.path like $1 || '.%' and m.auth_user_id <> $2""",
                role["at"],
                principal.auth_user_id,
            )
        ]
    return {
        "user_id": str(principal.auth_user_id),
        "org_id": str(org_id),
        "chain": chain,
        "readable": readable,
    }
