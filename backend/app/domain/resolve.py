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
