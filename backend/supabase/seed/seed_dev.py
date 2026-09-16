"""Seed a disposable development database with the Acme example workspace."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx
from nacl.exceptions import CryptoError
from nacl.secret import SecretBox

ZERO_HASH = "0" * 64
SEED_NAMESPACE = uuid.UUID("4072674d-86c8-40ef-b820-e4343961521d")

AUTH_USERS: dict[str, uuid.UUID] = {}
SEED_EMAILS = {
    "ana": "ana@acme.test",
    "cass": "cass@acme.test",
    "root": "root@acme.test",
}

ORG_UNITS = {
    "acme": uuid.uuid5(SEED_NAMESPACE, "org-unit:acme"),
    "finance": uuid.uuid5(SEED_NAMESPACE, "org-unit:acme.finance"),
    "engineering": uuid.uuid5(SEED_NAMESPACE, "org-unit:acme.engineering"),
    "ana": uuid.uuid5(SEED_NAMESPACE, "org-unit:acme.finance.ana"),
    "cass": uuid.uuid5(SEED_NAMESPACE, "org-unit:acme.engineering.cass"),
}

SKILLS = {
    "summarize-catch-up": """---
name: summarize-catch-up
description: Summarize recent local material into a concise catch-up.
---

## When to use

Use this when someone needs the important changes, decisions, and open questions from local files.

## Steps

1. Identify the files and time range the user wants covered.
2. Read the relevant local material and separate facts, decisions, and unresolved questions.
3. Produce a short summary with clear source filenames and call out anything uncertain.

## Requires (future)

Chat and document connectors will allow catch-ups across shared workspaces. For now, use only
files the user has made available locally.
""",
    "draft-reply": """---
name: draft-reply
description: Draft a clear reply from local context without sending it.
---

## When to use

Use this when the user wants a response drafted from a message and supporting local files.

## Steps

1. Read the source message and any local context the user identifies.
2. Match the requested audience, tone, and desired outcome.
3. Draft the reply, distinguish assumptions from known facts, and leave sending to the user.

## Requires (future)

Email and chat connectors will provide source threads and delivery. For now, work from local
copies and never claim that a draft was sent.
""",
    "pull-and-compile": """---
name: pull-and-compile
description: Combine facts from several local sources into one structured brief.
---

## When to use

Use this when information is spread across multiple files and needs one coherent output.

## Steps

1. Confirm the question, intended audience, and output format.
2. Read each relevant local source and note agreements, conflicts, and missing information.
3. Compile the findings by topic, cite filenames, and preserve meaningful disagreements.

## Requires (future)

Document, drive, and system-of-record connectors will gather remote sources. For now, compile
only local files supplied by the user.
""",
    "find-it": """---
name: find-it
description: Locate a requested fact or artifact in available local files.
---

## When to use

Use this when the user knows roughly what exists but not where it is stored.

## Steps

1. Turn the request into likely filenames, phrases, and related terms.
2. Search only the local locations available for the task.
3. Return the best matches with paths, short context, and confidence; say plainly if none match.

## Requires (future)

Enterprise search and storage connectors will extend discovery beyond local files. For now,
do not imply that remote systems were searched.
""",
    "prep-me": """---
name: prep-me
description: Build a focused preparation brief from local background material.
---

## When to use

Use this before a meeting, decision, or conversation when the user provides local context.

## Steps

1. Confirm the event, participants, objective, and available preparation time.
2. Extract relevant history, decisions, sensitivities, and unanswered questions from local files.
3. Produce a compact brief with goals, talking points, questions, and likely risks.

## Requires (future)

Calendar, chat, CRM, and document connectors will enrich preparation. For now, use only local
material and label missing context.
""",
}

HOUSE_DEFAULTS = """# House defaults

- Use a direct, calm, and helpful tone.
- Lead with the outcome or recommendation.
- Prefer short paragraphs and descriptive headings over dense formatting.
- Separate confirmed facts from assumptions and questions.
- Include dates, owners, and next actions when they are known.
- Never claim to have read, changed, sent, or approved something that was not actually handled.
"""

MODEL_DEFAULT = {
    "provider": "openai-compatible",
    "model_id": "mock-model",
    "base_url": "http://localhost:8401/v1",
    "key_ref": "secret://acme/mock-provider",
}


def stable_id(label: str) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, label)


def required_environment() -> tuple[str, bytes, str, str, str]:
    database_url = os.environ.get("DATABASE_URL")
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    password = os.environ.get("SEED_USER_PASSWORD")
    encoded_key = os.environ.get("HARNESS_MASTER_KEY")
    missing = [
        name
        for name, value in {
            "DATABASE_URL": database_url,
            "SUPABASE_URL": supabase_url,
            "SUPABASE_SERVICE_ROLE_KEY": service_role,
            "SEED_USER_PASSWORD": password,
            "HARNESS_MASTER_KEY": encoded_key,
        }.items()
        if not value
    ]
    if missing:
        raise SystemExit(f"Missing required environment: {', '.join(missing)}.")
    assert database_url and supabase_url and service_role and password and encoded_key
    try:
        key = base64.b64decode(encoded_key, validate=True)
    except ValueError as exc:
        raise SystemExit("HARNESS_MASTER_KEY must be valid base64.") from exc
    if len(key) != SecretBox.KEY_SIZE:
        raise SystemExit("HARNESS_MASTER_KEY must decode to exactly 32 bytes.")
    return database_url, key, supabase_url.rstrip("/"), service_role, password


async def ensure_auth_users(supabase_url: str, service_role: str, password: str) -> None:
    headers = {
        "apikey": service_role,
        "authorization": f"Bearer {service_role}",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        for label, email in SEED_EMAILS.items():
            response = await client.post(
                f"{supabase_url}/auth/v1/admin/users",
                headers=headers,
                json={"email": email, "password": password, "email_confirm": True},
            )
            if response.status_code == 422:
                listed = await client.get(
                    f"{supabase_url}/auth/v1/admin/users",
                    headers=headers,
                    params={"page": 1, "per_page": 1000},
                )
                listed.raise_for_status()
                match = next(
                    (
                        user
                        for user in listed.json().get("users", [])
                        if str(user.get("email", "")).lower() == email
                    ),
                    None,
                )
                if not match:
                    raise SystemExit(f"Could not find existing Auth user {email}.")
                AUTH_USERS[label] = uuid.UUID(match["id"])
                continue
            response.raise_for_status()
            AUTH_USERS[label] = uuid.UUID(response.json()["id"])


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


async def append_audit(
    connection: asyncpg.Connection,
    *,
    org_unit_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    await connection.execute(
        """
        insert into audit_log_latest_hashes (org_unit_id, last_hash)
        values ($1, $2)
        on conflict (org_unit_id) do nothing
        """,
        org_unit_id,
        ZERO_HASH,
    )
    previous_hash = await connection.fetchval(
        """
        select last_hash
          from audit_log_latest_hashes
         where org_unit_id = $1
           for update
        """,
        org_unit_id,
    )
    created_at = datetime.now(timezone.utc)
    record = {
        "org_unit_id": str(org_unit_id),
        "actor_type": "user",
        "actor_id": str(actor_id),
        "class": "authoritative",
        "action": action,
        "payload": payload,
        "created_at": created_at.isoformat(),
    }
    digest = hashlib.sha256(
        (previous_hash + canonical_json(record)).encode("utf-8")
    ).hexdigest()
    await connection.execute(
        """
        insert into audit_log (
          org_unit_id, actor_type, actor_id, class, action, payload,
          prev_hash, hash, created_at
        )
        values ($1, 'user', $2, 'authoritative', $3, $4::jsonb, $5, $6, $7)
        """,
        org_unit_id,
        actor_id,
        action,
        canonical_json(payload),
        previous_hash,
        digest,
        created_at,
    )
    await connection.execute(
        """
        update audit_log_latest_hashes
           set last_hash = $2
         where org_unit_id = $1
        """,
        org_unit_id,
        digest,
    )


async def upsert_org_units(connection: asyncpg.Connection) -> None:
    rows = [
        (ORG_UNITS["acme"], None, "org", "Acme"),
        (ORG_UNITS["finance"], ORG_UNITS["acme"], "team", "Finance"),
        (ORG_UNITS["engineering"], ORG_UNITS["acme"], "team", "Engineering"),
        (ORG_UNITS["ana"], ORG_UNITS["finance"], "user", "ana@acme.test"),
        (ORG_UNITS["cass"], ORG_UNITS["engineering"], "user", "cass@acme.test"),
    ]
    for unit_id, parent_id, role, name in rows:
        await connection.execute(
            """
            insert into org_units (id, parent_id, role, name, path)
            values ($1, $2, $3, $4, '')
            on conflict (id) do update
              set parent_id = excluded.parent_id,
                  role = excluded.role,
                  name = excluded.name
            """,
            unit_id,
            parent_id,
            role,
            name,
        )

    await connection.execute(
        """
        insert into org_unit_members (auth_user_id, user_unit_id)
        values ($1, $2), ($3, $4)
        on conflict (auth_user_id) do update
          set user_unit_id = excluded.user_unit_id
        """,
        AUTH_USERS["ana"],
        ORG_UNITS["ana"],
        AUTH_USERS["cass"],
        ORG_UNITS["cass"],
    )
    await connection.execute(
        """
        insert into org_unit_admins (auth_user_id, org_unit_id, level)
        values ($1, $2, 'admin'), ($3, $4, 'platform')
        on conflict (auth_user_id, org_unit_id) do update
          set level = excluded.level
        """,
        AUTH_USERS["ana"],
        ORG_UNITS["finance"],
        AUTH_USERS["root"],
        ORG_UNITS["acme"],
    )


async def upsert_boundary(connection: asyncpg.Connection) -> None:
    policy = {
        "approvals": {"deploy": "required"},
        "budget": {"monthly_usd_cap": 1000.0},
    }
    await connection.execute(
        """
        insert into org_unit_boundaries (org_unit_id, policy, updated_by)
        values ($1, $2::jsonb, $3)
        on conflict (org_unit_id) do update
          set policy = excluded.policy,
              updated_by = excluded.updated_by,
              updated_at = now()
        """,
        ORG_UNITS["acme"],
        canonical_json(policy),
        AUTH_USERS["root"],
    )


async def upsert_asset(
    connection: asyncpg.Connection,
    *,
    kind: str,
    name: str,
    files: dict[str, bytes],
) -> uuid.UUID:
    asset_id = stable_id(f"asset:acme:{kind}:{name}")
    file_hashes: dict[str, str] = {}
    for path, content in files.items():
        digest = hashlib.sha256(content).hexdigest()
        file_hashes[path] = digest
        await connection.execute(
            """
            insert into asset_files (hash, content, size)
            values ($1, $2, $3)
            on conflict (hash) do nothing
            """,
            digest,
            content,
            len(content),
        )

    await connection.execute(
        """
        insert into assets (id, org_unit_id, kind, name)
        values ($1, $2, $3, $4)
        on conflict (org_unit_id, kind, name) do update
          set status = 'active'
        """,
        asset_id,
        ORG_UNITS["acme"],
        kind,
        name,
    )
    actual_asset_id = await connection.fetchval(
        """
        select id from assets
         where org_unit_id = $1 and kind = $2 and name = $3
        """,
        ORG_UNITS["acme"],
        kind,
        name,
    )
    version_id = stable_id(f"asset-version:{actual_asset_id}:1")
    await connection.execute(
        """
        insert into asset_versions (
          id, asset_id, seq, file_hashes, author_auth_user_id, message
        )
        values ($1, $2, 1, $3::jsonb, $4, 'Initial development seed.')
        on conflict (asset_id, seq) do nothing
        """,
        version_id,
        actual_asset_id,
        canonical_json(file_hashes),
        AUTH_USERS["root"],
    )
    saved_version = await connection.fetchrow(
        """
        select id, file_hashes
          from asset_versions
         where asset_id = $1 and seq = 1
        """,
        actual_asset_id,
    )
    saved_hashes = saved_version["file_hashes"]
    if isinstance(saved_hashes, str):
        saved_hashes = json.loads(saved_hashes)
    if saved_hashes != file_hashes:
        raise RuntimeError(
            f"Seed asset {kind}/{name} already has different immutable version-1 content."
        )
    await connection.execute(
        "update assets set head_version_id = $2 where id = $1",
        actual_asset_id,
        saved_version["id"],
    )
    return actual_asset_id


async def upsert_assets(connection: asyncpg.Connection) -> list[uuid.UUID]:
    asset_ids = []
    model_bytes = canonical_json(MODEL_DEFAULT).encode("utf-8")
    asset_ids.append(
        await upsert_asset(
            connection,
            kind="connection",
            name="model-default",
            files={"connection.json": model_bytes},
        )
    )
    for name, content in SKILLS.items():
        asset_ids.append(
            await upsert_asset(
                connection,
                kind="skill",
                name=name,
                files={"SKILL.md": content.encode("utf-8")},
            )
        )
    asset_ids.append(
        await upsert_asset(
            connection,
            kind="memory",
            name="house-defaults",
            files={"MEMORY.md": HOUSE_DEFAULTS.encode("utf-8")},
        )
    )
    return asset_ids


async def upsert_api_key(connection: asyncpg.Connection, master_key: bytes) -> uuid.UUID:
    api_key_id = stable_id("api-key:acme:mock-provider")
    plaintext = "mock-key-123"
    box = SecretBox(master_key)
    await connection.execute(
        """
        insert into api_keys (
          id, org_unit_id, name, ref, kind, env_var, created_by
        )
        values (
          $1, $2, 'Mock Provider', 'secret://acme/mock-provider',
          'provider_api_key', 'MOCK_API_KEY', $3
        )
        on conflict (org_unit_id, name) do update
          set ref = excluded.ref,
              kind = excluded.kind,
              env_var = excluded.env_var,
              created_by = excluded.created_by
        """,
        api_key_id,
        ORG_UNITS["acme"],
        AUTH_USERS["root"],
    )
    actual_api_key_id = await connection.fetchval(
        """
        select id from api_keys
         where org_unit_id = $1 and name = 'Mock Provider'
        """,
        ORG_UNITS["acme"],
    )
    version_id = stable_id(f"api-key-version:{actual_api_key_id}:1")
    existing_ciphertext = await connection.fetchval(
        """
        select ciphertext
          from api_key_versions
         where api_key_id = $1 and version = 1
        """,
        actual_api_key_id,
    )
    if existing_ciphertext is None:
        ciphertext = bytes(box.encrypt(plaintext.encode("utf-8")))
    else:
        try:
            existing_plaintext = box.decrypt(existing_ciphertext).decode("utf-8")
        except (CryptoError, UnicodeDecodeError) as exc:
            raise RuntimeError(
                "The seeded API key exists but cannot be decrypted with HARNESS_MASTER_KEY."
            ) from exc
        if existing_plaintext != plaintext:
            raise RuntimeError("The seeded API key version has an unexpected immutable value.")
        ciphertext = existing_ciphertext
    await connection.execute(
        """
        insert into api_key_versions (
          id, api_key_id, version, ciphertext, last4, status
        )
        values ($1, $2, 1, $3, $4, 'active')
        on conflict (api_key_id, version) do nothing
        """,
        version_id,
        actual_api_key_id,
        ciphertext,
        plaintext[-4:],
    )
    return actual_api_key_id


async def replace_pats(connection: asyncpg.Connection) -> dict[str, str]:
    tokens: dict[str, str] = {}
    for label, auth_user_id in AUTH_USERS.items():
        token_body = secrets.token_urlsafe(32)
        token = f"hpat_{token_body}"
        token_hash = hashlib.sha256(token_body.encode("utf-8")).hexdigest()
        pat_id = stable_id(f"pat:seed:{label}")
        await connection.execute(
            """
            insert into personal_access_tokens (
              id, auth_user_id, token_hash, name
            )
            values ($1, $2, $3, 'Development seed')
            on conflict (id) do update
              set auth_user_id = excluded.auth_user_id,
                  token_hash = excluded.token_hash,
                  name = excluded.name,
                  expires_at = null,
                  created_at = now()
            """,
            pat_id,
            auth_user_id,
            token_hash,
        )
        tokens[label] = token
    return tokens


async def seed() -> dict[str, str]:
    database_url, master_key, supabase_url, service_role, password = required_environment()
    await ensure_auth_users(supabase_url, service_role, password)
    connection = await asyncpg.connect(database_url)
    try:
        async with connection.transaction():
            await upsert_org_units(connection)
            await upsert_boundary(connection)
            asset_ids = await upsert_assets(connection)
            api_key_id = await upsert_api_key(connection, master_key)
            tokens = await replace_pats(connection)
            await append_audit(
                connection,
                org_unit_id=ORG_UNITS["acme"],
                actor_id=AUTH_USERS["root"],
                action="seed.apply",
                payload={
                    "asset_ids": [str(asset_id) for asset_id in asset_ids],
                    "api_key_id": str(api_key_id),
                },
            )
            return tokens
    finally:
        await connection.close()


def main() -> None:
    tokens = asyncio.run(seed())
    print(f"ANA_PAT={tokens['ana']}")
    print(f"CASS_PAT={tokens['cass']}")
    print(f"ROOT_PAT={tokens['root']}")


if __name__ == "__main__":
    main()
