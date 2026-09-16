import base64
import json
from typing import Any
from uuid import UUID

import asyncpg


async def resolved_assets(
    connection: asyncpg.Connection, org_unit_id: UUID
) -> list[dict[str, Any]]:
    rows = await connection.fetch(
        """with recursive chain as (
             select id,parent_id,0 depth from org_units where id=$1
             union all select p.id,p.parent_id,c.depth+1
             from org_units p join chain c on c.parent_id=p.id
           ), candidates as (
             select a.*,c.depth,v.id version_id,v.seq,v.file_hashes,
                    row_number() over(partition by a.kind,a.name order by c.depth asc) choice
             from chain c join assets a on a.org_unit_id=c.id and a.status='active'
             join lateral (
               select av.* from asset_versions av
               where av.asset_id=a.id
                 and not (av.provenance ? 'pending_review')
               order by av.seq desc limit 1
             ) v on true
           ) select * from candidates where choice=1 order by kind,name""",
        org_unit_id,
    )
    result = []
    for row in rows:
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
                "version_seq": row["seq"],
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
