import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import asyncpg
import yaml

from app.errors import ApiError

PATH_PATTERN = re.compile(r"^[a-zA-Z0-9._/-]+$")
SECRET_PATTERN = re.compile(r"secret://[a-z0-9./-]+")
MAX_FILE_SIZE = 256 * 1024
MAX_FILES = 20


@dataclass(frozen=True)
class DecodedFile:
    path: str
    content: bytes
    hash: str


def decode_files(files: list[dict[str, str]]) -> list[DecodedFile]:
    if len(files) > MAX_FILES:
        raise ApiError(422, "too_many_files", "A version can contain at most 20 files.")
    result: list[DecodedFile] = []
    seen: set[str] = set()
    for item in files:
        path = item["path"]
        if (
            not PATH_PATTERN.fullmatch(path)
            or path.startswith("/")
            or any(part in {"", ".", ".."} for part in path.split("/"))
        ):
            raise ApiError(422, "invalid_file_path", f"The file path '{path}' is not allowed.")
        if path in seen:
            raise ApiError(
                422, "duplicate_file_path", f"The file path '{path}' appears more than once."
            )
        seen.add(path)
        try:
            content = base64.b64decode(item["content_b64"], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ApiError(
                422, "invalid_file_content", f"The file '{path}' is not valid base64."
            ) from exc
        if len(content) > MAX_FILE_SIZE:
            raise ApiError(422, "file_too_large", f"The file '{path}' is larger than 256 KiB.")
        result.append(DecodedFile(path, content, hashlib.sha256(content).hexdigest()))
    return result


def _frontmatter(content: bytes) -> dict[str, Any]:
    text = content.decode("utf-8", errors="replace")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end < 0:
        return {}
    loaded = yaml.safe_load(text[4:end])
    return loaded if isinstance(loaded, dict) else {}


def lint_files(
    files: list[DecodedFile],
    boundary: dict[str, Any],
    visible_secret_refs: set[str],
) -> None:
    connectors = set(boundary.get("connector_allowlist", []))
    egress = set(boundary.get("egress_allowlist", []))
    for file in files:
        text = file.content.decode("utf-8", errors="replace")
        if file.path == "SKILL.md" or file.path.endswith(".md"):
            metadata = _frontmatter(file.content)
            requires = metadata.get("requires", {}) if isinstance(metadata, dict) else {}
            for connector in requires.get("connections", []) or []:
                if connector not in connectors:
                    raise ApiError(
                        422,
                        "boundary_violation",
                        f"The connection '{connector}' is not allowed for this org unit.",
                        {"path": file.path},
                    )
            for host in requires.get("egress", []) or []:
                if host not in egress:
                    raise ApiError(
                        422,
                        "boundary_violation",
                        f"The destination '{host}' is not allowed for this org unit.",
                        {"path": file.path},
                    )
        for matched_ref in SECRET_PATTERN.findall(text):
            ref = matched_ref.rstrip(".,;:!?")
            if ref not in visible_secret_refs:
                raise ApiError(
                    422,
                    "boundary_violation",
                    f"The key reference '{ref}' is not available to this org unit.",
                    {"path": file.path},
                )


async def store_files(connection: asyncpg.Connection, files: list[DecodedFile]) -> dict[str, str]:
    for file in files:
        await connection.execute(
            """insert into asset_files(hash,content,size) values($1,$2,$3)
               on conflict (hash) do nothing""",
            file.hash,
            file.content,
            len(file.content),
        )
    return {file.path: file.hash for file in files}


async def push_version(
    connection: asyncpg.Connection,
    *,
    asset_id: UUID,
    parent_version_id: UUID | None,
    files: list[DecodedFile],
    author_id: UUID,
    message: str,
    provenance: dict[str, Any] | None = None,
    make_head: bool = True,
) -> dict[str, Any]:
    asset = await connection.fetchrow("select * from assets where id=$1 for update", asset_id)
    if not asset:
        raise ApiError(404, "asset_not_found", "This asset could not be found.")
    if asset["head_version_id"] != parent_version_id:
        head = await connection.fetchrow(
            """select v.id version_id,v.seq,v.message,v.author_auth_user_id author,v.created_at
               from asset_versions v where v.id=$1""",
            asset["head_version_id"],
        )
        raise ApiError(
            409,
            "stale_parent",
            "Someone saved a newer version before yours.",
            {"head": dict(head) if head else None},
        )
    seq = await connection.fetchval(
        "select coalesce(max(seq),0)+1 from asset_versions where asset_id=$1", asset_id
    )
    hashes = await store_files(connection, files)
    version = await connection.fetchrow(
        """insert into asset_versions
           (asset_id,parent_version_id,seq,file_hashes,author_auth_user_id,message,provenance)
           values($1,$2,$3,$4,$5,$6,$7) returning *""",
        asset_id,
        parent_version_id,
        seq,
        json.dumps(hashes),
        author_id,
        message,
        json.dumps(provenance or {}),
    )
    if make_head:
        await connection.execute(
            "update assets set head_version_id=$2 where id=$1", asset_id, version["id"]
        )
    return dict(version)
