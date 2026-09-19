import base64
import json
from typing import Any
from uuid import UUID

import asyncpg


async def resolved_assets(
    connection: asyncpg.Connection, org_unit_id: UUID
) -> list[dict[str, Any]]:
    """Assets visible to an org unit, nearest ancestor winning per (kind, name).

    Each result also carries the asset it shadows, if any, so the client can
    tell a user that the team's version advanced behind their personal
    override. The runner-up of the same window gives us that for free.

    Harnesses do not take part in resolution, and nothing here mentions
    them: a harness is a list of (kind, name), carried once on the manifest,
    and the client drops the names that are not on it when it lays out a
    session. That ordering is forced — there is one work tree per user, so
    hydration has to see the whole resolved set or switching harnesses would
    churn it (docs/harnesses.md §3).
    """
    rows = await connection.fetch(
        """with recursive chain as (
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
             -- Candidacy, not ranking: I own it, or an ancestor has scoped it
             -- to some unit in my chain. This has to be a WHERE on the same
             -- select as the window function, so it runs before row_number()
             -- partitions the survivors — a scoped-out ancestor asset must
             -- never enter the window, or it shadows the nearest legitimate
             -- copy and the window throws that copy away too
             -- (docs/scoping.md §3.1).
             where c.id=$1
                or exists (
                     select 1 from asset_scopes s
                     where s.asset_id=a.id and s.org_unit_id in (select id from chain)
                   )
           ) select * from candidates where choice<=2 order by kind,name,choice""",
        org_unit_id,
    )
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
    result = []
    for row in rows:
        if row["choice"] != 1:
            continue
        hashes = dict(row["file_hashes"])
        file_rows = await connection.fetch(
            "select hash,content from asset_files where hash=any($1::text[])",
            list(hashes.values()),
        )
        contents = {file_row["hash"]: file_row["content"] for file_row in file_rows}
        result.append(
            {
                "name": row["name"],
                "kind": row["kind"],
                "asset_id": row["id"],
                # Where it came from, so a client can order broad-to-narrow and
                # tell an inherited asset from the user's own.
                "org_unit_path": row["org_unit_path"],
                "version_id": row["version_id"],
                "version_seq": row["seq"],
                "shadows": shadowed.get((row["kind"], row["name"])),
                "files": [
                    {"path": path, "content_b64": base64.b64encode(contents[digest]).decode()}
                    for path, digest in sorted(hashes.items())
                ],
            }
        )
    return result


async def version_files(
    connection: asyncpg.Connection, file_hashes: dict[str, str]
) -> list[dict[str, Any]]:
    """A version's files as the wire format wants them: path plus base64 body.

    Pulled out of `resolved_assets`'s loop so the same lookup can back a
    collision's "here is what you would be overriding" payload
    (`routes_assets.py`) without a second, slightly different query.
    """
    file_rows = await connection.fetch(
        "select hash,content from asset_files where hash=any($1::text[])",
        list(file_hashes.values()),
    )
    contents = {row["hash"]: row["content"] for row in file_rows}
    return [
        {"path": path, "content_b64": base64.b64encode(contents[digest]).decode()}
        for path, digest in sorted(file_hashes.items())
    ]


async def shadowed_copy(
    connection: asyncpg.Connection, org_unit_id: UUID, kind: str, name: str
) -> dict[str, Any] | None:
    """The ancestor asset that would resolve for `org_unit_id` right now for
    this `(kind, name)` — i.e. exactly what a brand-new asset of that name at
    `org_unit_id` would shadow the instant it existed.

    Same candidacy predicate as `resolved_assets` (docs/scoping.md §3.1),
    restricted to strict ancestors (`depth>0`): an ancestor's asset only
    counts if it is scoped to reach a unit in this chain. An ancestor that
    owns the name but never scoped it down creates no shadow and is not a
    collision — nothing about this unit's resolved set would change, so a
    push of the same name must not be refused (docs/scoping.md §5.2).
    """
    row = await connection.fetchrow(
        """with recursive chain as (
             select id,parent_id,0 depth from org_units where id=$1
             union all select p.id,p.parent_id,c.depth+1
             from org_units p join chain c on c.parent_id=p.id
           )
           select a.id asset_id, a.org_unit_id, u.path org_unit_path,
                  v.id version_id, v.seq, v.file_hashes
             from chain c
             join assets a on a.org_unit_id=c.id and a.kind=$2 and a.name=$3
               and a.status='active'
             join org_units u on u.id=a.org_unit_id
             join lateral (
               select av.* from asset_versions av
               where av.asset_id=a.id and not (av.provenance ? 'pending_review')
               order by av.seq desc limit 1
             ) v on true
            where c.depth>0
              and exists (
                    select 1 from asset_scopes s
                    where s.asset_id=a.id and s.org_unit_id in (select id from chain)
                  )
            order by c.depth asc
            limit 1""",
        org_unit_id,
        kind,
        name,
    )
    return dict(row) if row else None


async def ancestor_version(
    connection: asyncpg.Connection, org_unit_id: UUID, version_id: UUID
) -> dict[str, Any] | None:
    """The asset owning `version_id`, if that asset is active and belongs to
    a strict ancestor of `org_unit_id` — regardless of current scope.

    Deliberately scope-agnostic, unlike `shadowed_copy`: this backs
    `override_of` on `POST /assets/{id}/versions`, which exists so a unit can
    confirm "keep mine" against an ancestor's copy *before* that copy is ever
    scoped down to them — that is the whole point of raising the collision at
    scope-grant time (docs/scoping.md §5.2(c)) rather than only at push time.
    """
    row = await connection.fetchrow(
        """with recursive chain as (
             select id,parent_id,0 depth from org_units where id=$1
             union all select p.id,p.parent_id,c.depth+1
             from org_units p join chain c on c.parent_id=p.id
           )
           select a.id asset_id, a.kind, a.name
             from chain c
             join assets a on a.org_unit_id=c.id and a.status='active'
             join asset_versions v on v.asset_id=a.id and v.id=$2
            where c.depth>0""",
        org_unit_id,
        version_id,
    )
    return dict(row) if row else None


async def descendant_owners(
    connection: asyncpg.Connection, org_unit_id: UUID, kind: str, name: str
) -> list[dict[str, Any]]:
    """Active assets of this `(kind, name)` owned anywhere below `org_unit_id`.

    Purely informational (docs/scoping.md §5.2(b)): pushing a new asset here
    never blocks on this, because until it is scoped down below itself
    nothing any of these units resolve actually changes. It tells whoever is
    publishing the name what they would shadow the moment they did scope it
    that far, before they commit to it.
    """
    rows = await connection.fetch(
        """with recursive down as (
             select id,parent_id from org_units where id=$1
             union all select o.id,o.parent_id from org_units o join down d on o.parent_id=d.id
           )
           select a.id asset_id, u.id org_unit_id, u.path org_unit_path,
                  v.id version_id, v.seq
             from down d
             join org_units u on u.id=d.id
             join assets a on a.org_unit_id=u.id and a.kind=$2 and a.name=$3
               and a.status='active'
             join asset_versions v on v.id=a.head_version_id
            where u.id != $1
            order by u.path""",
        org_unit_id,
        kind,
        name,
    )
    return [dict(row) for row in rows]


async def subtree_owner(
    connection: asyncpg.Connection, org_unit_id: UUID, kind: str, name: str, excluding: UUID
) -> dict[str, Any] | None:
    """An active asset of this `(kind, name)` — other than `excluding` —
    already owned inside `org_unit_id`'s own subtree (itself included), if any.

    Used at scope-grant time (docs/scoping.md §5.2(c)): a scope row means
    "this unit and everything beneath it" (0022_asset_scopes.sql), so granting
    reach to `org_unit_id` for an asset that some unit in its own subtree
    already owns under the same name would silently create the exact shadow
    §5.2 says nobody may create without choosing to. `excluding` is the asset
    being scoped itself: when the granted unit is the asset's own owning unit
    (an owner scoping its own subtree, per §3), that asset must not shadow-box
    itself out of a real collision sitting deeper in the same subtree.
    """
    row = await connection.fetchrow(
        """with recursive subtree as (
             select id from org_units where id=$1
             union all select o.id from org_units o join subtree s on o.parent_id=s.id
           )
           select a.id asset_id, u.id org_unit_id, u.path org_unit_path, v.provenance
             from subtree s
             join org_units u on u.id=s.id
             join assets a on a.org_unit_id=u.id and a.kind=$2 and a.name=$3
               and a.status='active' and a.id!=$4
             join asset_versions v on v.id=a.head_version_id
            order by u.path
            limit 1""",
        org_unit_id,
        kind,
        name,
        excluding,
    )
    return dict(row) if row else None


def model_from_assets(assets: list[dict[str, Any]]) -> dict[str, Any] | None:
    connection = next(
        (a for a in assets if a["kind"] == "connection" and a["name"] == "model-default"),
        None,
    )
    if not connection:
        return None
    json_file = next((f for f in connection["files"] if f["path"].endswith(".json")), None)
    if not json_file:
        return None
    try:
        return json.loads(base64.b64decode(json_file["content_b64"]))
    except (ValueError, json.JSONDecodeError):
        return None
