"""The three read seams over the derived index (02 §8.6).

`api` never composes (00 D2): `definitions` runs `compose()` post-receive and
posts the rows here. These functions shape those rows back into the contracts
00 §4.3–§4.4 names, and nothing else reads `idx_*`.
"""

from typing import Any
from uuid import UUID

import asyncpg

from app.domain import seed


class IndexStale(Exception):
    """Any `idx_stale` row for the org (02 §8.4). The broker turns this into
    `broker.index_stale` and refuses to mint: a stale index fails closed."""


# 01 §4.2, the org-only policy files, in the order EffectivePolicy names them.
# `idx_policy.file` is the file's own name, as `definitions` reads it off the
# `policy/` tree (`engine/definitions/src/indexer.ts`), not its path.
_ORG_FILES = {
    "groups": "groups.json",
    "modelProviders": "model-providers.json",
    "harnessProviders": "harness-providers.json",
    "routing": "routing.json",
    "kinds": "kinds.json",
    # W5-D10: read through `seed.always_loaded_lists` into `required` and
    # `recommended`, which is what `EffectivePolicy` names.
    "alwaysLoaded": "always-loaded.json",
}
_EMPTY_ROUTING: dict[str, Any] = {
    "defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
    "approvedFor": {"teams": {}, "harnesses": {}, "providers": {}},
}


async def _fresh(connection: asyncpg.Connection, org_id: UUID) -> None:
    if await connection.fetchval("select exists(select 1 from idx_stale where org=$1)", org_id):
        raise IndexStale(str(org_id))


async def _files(
    connection: asyncpg.Connection, org_id: UUID, node_path: str
) -> dict[str, Any]:
    rows = await connection.fetch(
        "select file, body from idx_policy where org=$1 and node_path=$2", org_id, node_path
    )
    return {row["file"]: row["body"] for row in rows}


async def _org_path(connection: asyncpg.Connection, org_id: UUID) -> str | None:
    return await connection.fetchval(
        "select path from idx_nodes where org=$1 and kind='org'", org_id
    )


# D131: `reach.json` is per node, like boundaries — not org-only — so it is not
# in `_ORG_FILES`. Absent everywhere is `off`, set by the node that turns it on.
NO_REACH = {"mode": "off", "hosts": []}

# The modes, widest first: a step down the chain may only move down this list
# (engine `compose/src/reach.ts`, one rule, two languages).
_RANK = {"on": 0, "allow": 1, "off": 2}


def start_reach(said: dict[str, Any] | None, at: str) -> dict[str, Any]:
    """The organization is the top of the walk: its file *is* the start, and
    only what is below it can widen anything."""
    mode = (said or NO_REACH).get("mode", "off")
    hosts = [] if mode == "off" else list((said or {}).get("hosts") or [])
    return {"mode": mode, "hosts": hosts, "setBy": at}


def narrow_reach(parent: dict[str, Any], step: dict[str, Any], at: str) -> dict[str, Any]:
    """One step of D131's walk. A step that widens is ignored: the parent stands,
    which is what `compose()` does after reporting the `reach-widened` conflict."""
    said = {"mode": step.get("mode", "off"), "hosts": list(step.get("hosts") or [])}
    if said["mode"] == "off":
        said["hosts"] = []
    if _RANK[said["mode"]] < _RANK[parent["mode"]]:
        return parent
    if said["mode"] == "allow" and parent["mode"] == "allow":
        if any(host not in parent["hosts"] for host in said["hosts"]):
            return parent
    if said["mode"] == "allow" and parent["mode"] == "on":
        if any(host in parent["hosts"] for host in said["hosts"]):
            return parent
    if said["mode"] == "on" and any(host not in said["hosts"] for host in parent["hosts"]):
        return parent
    if said["mode"] == parent["mode"] and said["hosts"] == parent["hosts"]:
        return parent
    return {**said, "setBy": at}


def _policy(files: dict[str, Any], boundaries: list, grants: list,
            reach: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "boundaries": boundaries,
        "grants": grants,
        "reach": reach or {**NO_REACH, "setBy": ""},
        "groups": {g["name"]: g for g in files.get(_ORG_FILES["groups"], [])},
        "modelProviders": {p["id"]: p for p in files.get(_ORG_FILES["modelProviders"], [])},
        "harnessProviders": {p["id"]: p for p in files.get(_ORG_FILES["harnessProviders"], [])},
        "routing": files.get(_ORG_FILES["routing"]) or _EMPTY_ROUTING,
        "kinds": files.get(_ORG_FILES["kinds"], []),
        # W5-D10's two lists. The indexer writes the file normalised, so a bare
        # array only reaches here from an index written before the split.
        **seed.always_loaded_lists(files.get(_ORG_FILES["alwaysLoaded"])),
    }


async def org_policy(connection: asyncpg.Connection, org_id: UUID) -> dict[str, Any]:
    """The org node's groups, providers, routing, kinds, always-loaded, and its
    own grants and boundaries — composed for the org node alone (02 §8.6)."""
    await _fresh(connection, org_id)
    path = await _org_path(connection, org_id)
    if path is None:
        return _policy({}, [], [])
    files = await _files(connection, org_id, path)
    reach = start_reach(files.get("reach.json"), path)
    return _policy(
        files, files.get("boundaries.json", []), files.get("grants.json", []), reach
    )


async def harness(
    connection: asyncpg.Connection, org_id: UUID, harness_id: UUID | str
) -> dict[str, Any] | None:
    """The selected harness, or None if no node on this org holds it."""
    await _fresh(connection, org_id)
    return await connection.fetchval(
        "select def from idx_harnesses where org=$1 and id=$2", org_id, UUID(str(harness_id))
    )


async def effective_for(
    connection: asyncpg.Connection, org_id: UUID, user_id: UUID
) -> dict[str, Any]:
    """The person's chain, every grant and boundary on it (narrowed grants
    included, already validated at push), and the winning asset per id."""
    await _fresh(connection, org_id)
    nodes = await connection.fetch(
        """with recursive up as (
             select n.* from idx_nodes n where n.org=$1 and n.ref=$2
             union all
             select p.* from idx_nodes p join up on p.org=$1 and p.path=up.parent_path
           )
           select up.kind, up.path, up.ref, coalesce(r.commit, '') commit
             from up left join idx_refs r on r.org=$1 and r.ref=up.ref
            order by length(up.path)""",
        org_id,
        f"refs/heads/users/{user_id}",
    )
    chain = [dict(row) for row in nodes]
    grants: list[dict[str, Any]] = []
    boundaries: list[dict[str, Any]] = []
    reach = {**NO_REACH, "setBy": chain[0]["path"] if chain else ""}
    for node in chain:
        files = await _files(connection, org_id, node["path"])
        grants.extend(files.get("grants.json", []))
        boundaries.extend(files.get("boundaries.json", []))
        # D131, root first: the org's file starts the walk, a team's narrows it.
        said = files.get("reach.json")
        if said is None or node["kind"] == "user":
            continue
        reach = (start_reach(said, node["path"]) if node["kind"] == "org"
                 else narrow_reach(reach, said, node["path"]))
    assets = await connection.fetch(
        """select e.asset_id id, a.kind, a.name, a.tree, a.sidecar, e.from_path, e.shadows_path
             from idx_effective e
             join idx_assets a on a.org=e.org and a.node_path=e.from_path and a.id=e.asset_id
            where e.org=$1 and e.user_id=$2""",
        org_id,
        user_id,
    )
    return {
        "chain": chain,
        "grants": grants,
        "boundaries": boundaries,
        "reach": reach,
        "assets": [dict(row) for row in assets],
    }
