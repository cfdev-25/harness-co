"""Postgres → bare git repos, one per organisation (02 §11.1's table).

Nothing here writes to the database: the connection is opened read-only at
the transaction level as well as by intent, so a mistake is refused by
Postgres rather than caught by review.

Run it:

    python -m app.migration.export_to_git --out /tmp/definitions-scratch

It prints, and writes into `--out`, a `migration-report.json` naming every row
that was dropped, re-id'd, shadowed or left unreached (02 §11.2 step 3).
"""

import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from uuid import UUID

import asyncpg

from app.domain import seed
from app.domain.capabilities import FIXED_CAPABILITIES, to_capability
from app.domain.org_tree import merge_boundaries
from app.domain.resolve import resolved_assets, shadowed_copy

# C30. The exporter writes repos people will later push to, so a hook planted
# in one must never run, and a fixed identity keeps the export reproducible.
GIT_FLAGS = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.fileMode=false",
    "-c",
    "user.name=harness",
    "-c",
    "user.email=harness@local",
]
GIT_ENV = {
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
}


def git(
    repo: str, args: list[str], stdin: bytes | None = None, env: dict[str, str] | None = None
) -> bytes:
    done = subprocess.run(
        ["git", f"--git-dir={repo}", *GIT_FLAGS, *args],
        input=stdin,
        capture_output=True,
        check=True,
        env={**os.environ, **GIT_ENV, **(env or {})},
    )
    return done.stdout


def slugify(value: str) -> str:
    """`org_units_slugify` (0001), so a name becomes the same word it does in a path."""
    return re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", value.strip().lower()))


def ref_for(unit: dict[str, Any], auth_user: str | None) -> str | None:
    """01 §4.1. A user unit nobody has logged in as has no branch to be."""
    if unit["role"] == "org":
        return "refs/heads/org"
    if unit["role"] == "team":
        return f"refs/heads/teams/{unit['path']}"
    return f"refs/heads/users/{auth_user}" if auth_user else None


class Branch:
    """The files one branch will hold, keyed by path. Built, then written once."""

    def __init__(self, unit: dict[str, Any], ref: str) -> None:
        self.unit = unit
        self.ref = ref
        self.files: dict[str, bytes] = {}

    def add(self, path: str, body: bytes) -> None:
        self.files[path] = body

    def add_json(self, path: str, body: Any) -> None:
        self.files[path] = (json.dumps(body, indent=2, sort_keys=False) + "\n").encode()

    def at(self, directory: str) -> str | None:
        """The id of the asset already placed at this directory, if any."""
        sidecar = self.files.get(f"{directory}/asset.json")
        return json.loads(sidecar)["id"] if sidecar else None

    def drop(self, directory: str) -> None:
        for path in [p for p in self.files if p.startswith(f"{directory}/")]:
            del self.files[path]


# The migration's own commit note. It is read by a person, in the console's
# *Their note* column, so it is a sentence and not a path: `created <path>` is
# the root commit's subject and nothing else, because `repos.ts` `branchPath()`
# parses a user branch's node path out of it and no body in 00 §4.10 carries
# that path back (02 §5.3).
MIGRATED = "Migrated from the previous console."


def write_branch(repo: str, branch: Branch) -> str:
    """Two commits: the root `definitions` would have made, then the migration.

    `createBranch` (02 §5.3, D43) starts every branch as an orphan commit with
    an empty tree and the subject `created <node_path>`; the exporter writes
    the same root so a migrated repo is indistinguishable from a created one,
    then commits the unit's whole tree on top of it. One orphan commit carrying
    both would force the node path to be the note every file row shows.
    """
    empty = git(repo, ["hash-object", "-t", "tree", "-w", "--stdin"], stdin=b"").decode().strip()
    subject = f"created {branch.unit['path']}"
    root = git(repo, ["commit-tree", empty, "-m", subject]).decode().strip()
    with tempfile.TemporaryDirectory() as scratch:
        index = os.path.join(scratch, "index")
        env = {"GIT_INDEX_FILE": index}
        for path, body in sorted(branch.files.items()):
            oid = git(repo, ["hash-object", "-w", "--stdin"], stdin=body).decode().strip()
            git(repo, ["update-index", "--add", "--cacheinfo", f"100644,{oid},{path}"], env=env)
        tree = git(repo, ["write-tree"], env=env).decode().strip()
    commit = git(repo, ["commit-tree", tree, "-p", root, "-m", MIGRATED]).decode().strip()
    git(repo, ["update-ref", branch.ref, commit])
    return commit


async def head_version(connection: asyncpg.Connection, asset_id: UUID) -> asyncpg.Record | None:
    """`resolve.py`'s own choice of version: the highest seq that is not
    awaiting review. `assets.head_version_id` is not it — a pending version can
    be the head — so taking the column would export a version nobody resolves."""
    return await connection.fetchrow(
        """select id, seq, file_hashes from asset_versions
             where asset_id = $1 and not (provenance ? 'pending_review')
             order by seq desc limit 1""",
        asset_id,
    )


async def export_org(
    connection: asyncpg.Connection, org: asyncpg.Record, out: Path, report: list[dict[str, Any]]
) -> dict[str, Any]:
    """One organisation → one bare repo. Returns what the acceptance test needs."""
    org_id = org["id"]
    repo = str(out / f"{org_id}.git")
    subprocess.run(["git", "init", "--bare", "--quiet", repo], check=True)

    def record(what: str, **fields: Any) -> None:
        report.append({"org": str(org_id), "what": what, **fields})

    units = await connection.fetch(
        """with recursive tree as (
             select * from org_units where id = $1
             union all select o.* from org_units o join tree t on o.parent_id = t.id
           ) select * from tree order by path""",
        org_id,
    )
    by_id = {unit["id"]: dict(unit) for unit in units}
    members = {
        row["user_unit_id"]: str(row["auth_user_id"])
        for row in await connection.fetch(
            "select auth_user_id, user_unit_id from org_unit_members"
            " where user_unit_id = any($1::uuid[])",
            list(by_id),
        )
    }

    branches: dict[UUID, Branch] = {}
    for unit in by_id.values():
        ref = ref_for(unit, members.get(unit["id"]))
        if ref is None:
            record("user_unit_has_no_login", unit=unit["path"])
            continue
        branches[unit["id"]] = Branch(unit, ref)

    # --- assets -----------------------------------------------------------
    # Root first, so an override is always re-id'd against an ancestor whose
    # own id is already final (D46 applied transitively).
    reid: dict[UUID, UUID] = {}
    assets = await connection.fetch(
        "select * from assets where org_unit_id = any($1::uuid[]) and status = 'active'",
        list(by_id),
    )
    ordered = sorted(
        assets,
        key=lambda row: (by_id[row["org_unit_id"]]["path"].count("."), row["kind"], row["name"]),
    )
    scopes: dict[UUID, set[UUID]] = {}
    for row in await connection.fetch(
        "select asset_id, org_unit_id from asset_scopes where asset_id = any($1::uuid[])",
        [row["id"] for row in assets],
    ):
        scopes.setdefault(row["asset_id"], set()).add(row["org_unit_id"])

    placed: list[dict[str, Any]] = []
    for row in ordered:
        owner = by_id[row["org_unit_id"]]
        version = await head_version(connection, row["id"])
        if version is None:
            record(
                "only_pending_versions",
                asset=str(row["id"]),
                unit=owner["path"],
                name=f"{row['kind']}/{row['name']}",
            )
            continue
        # D46, and the reason it is not only user-owned assets: the rule is
        # "an ancestor's copy lands on my chain", which `shadowed_copy` is.
        ancestor = await shadowed_copy(connection, owner["id"], row["kind"], row["name"])
        asset_id = row["id"]
        if ancestor:
            asset_id = reid.get(ancestor["asset_id"], ancestor["asset_id"])
            reid[row["id"]] = asset_id
            record(
                "reid",
                old=str(row["id"]),
                new=str(asset_id),
                unit=owner["path"],
                name=f"{row['kind']}/{row['name']}",
            )

        hashes = dict(version["file_hashes"])
        bodies = {
            found["hash"]: found["content"]
            for found in await connection.fetch(
                "select hash, content from asset_files where hash = any($1::text[])",
                list(hashes.values()),
            )
        }
        directory = f"assets/{row['kind']}/{row['name']}"
        files = {f"{directory}/{path}": bodies[digest] for path, digest in hashes.items()}
        files[f"{directory}/asset.json"] = (
            json.dumps({"id": str(asset_id), "kind": row["kind"]}, indent=2) + "\n"
        ).encode()

        # 02 §11.1, asset_scopes → placement.
        reach = scopes.get(row["id"], set())
        if owner["role"] != "user" and not reach:
            record(
                "unreached",
                asset=str(row["id"]),
                unit=owner["path"],
                name=f"{row['kind']}/{row['name']}",
            )
            continue
        targets: list[UUID] = []
        for target in sorted(
            reach, key=lambda unit_id: by_id[unit_id]["path"] if unit_id in by_id else ""
        ):
            if target not in by_id:
                continue
            owned_here = await connection.fetchval(
                "select 1 from assets where org_unit_id = $1 and kind = $2 and name = $3"
                " and status = 'active' and id <> $4",
                target,
                row["kind"],
                row["name"],
                row["id"],
            )
            if owned_here and target != owner["id"]:
                # A never resolved there — nearest wins — and placing it would
                # be a same-path-different-id conflict.
                record(
                    "shadowed_by_owner",
                    asset=str(row["id"]),
                    unit=by_id[target]["path"],
                    name=f"{row['kind']}/{row['name']}",
                )
                continue
            targets.append(target)
        if owner["role"] == "user" and owner["id"] not in targets:
            targets.append(owner["id"])
        for target in targets:
            branch = branches.get(target)
            if branch is None:
                continue
            # Root first, so a later placement at the same directory is the
            # nearer copy and wins whole — overlaying would leave the wider
            # copy's stray files behind beside the nearer copy's sidecar.
            held = branch.at(directory)
            if held is not None and held != str(asset_id):
                record(
                    "placement_collision",
                    asset=str(row["id"]),
                    unit=by_id[target]["path"],
                    name=f"{row['kind']}/{row['name']}",
                    replaced=held,
                )
                branch.drop(directory)
            for path, body in files.items():
                branch.add(path, body)
        placed.append({"asset": str(asset_id), "kind": row["kind"], "name": row["name"]})

    # --- harnesses --------------------------------------------------------
    for harness in await connection.fetch(
        "select * from harnesses where org_unit_id = any($1::uuid[])", list(by_id)
    ):
        unit = by_id[harness["org_unit_id"]]
        # The pre-migration rule, run once: what (kind, name) meant at this unit.
        visible = {
            (found["kind"], found["name"]): found["asset_id"]
            for found in await resolved_assets(connection, harness["org_unit_id"])
        }
        ids: list[str] = []
        for row in await connection.fetch(
            "select kind, name from harness_assets where harness_id = $1 order by kind, name",
            harness["id"],
        ):
            found = visible.get((row["kind"], row["name"]))
            if found is None:
                record(
                    "assignment_unresolved",
                    harness=str(harness["id"]),
                    name=f"{row['kind']}/{row['name']}",
                )
                continue
            ids.append(str(reid.get(found, found)))
        branch = branches.get(harness["org_unit_id"])
        if branch is None:
            record("harness_unit_has_no_branch", harness=str(harness["id"]), unit=unit["path"])
            continue
        branch.add_json(
            f"harnesses/{harness['id']}.json",
            {
                "id": str(harness["id"]),
                "name": harness["name"],
                "description": harness["description"],
                "icon": harness["icon"]
                if isinstance(harness["icon"], dict)
                else json.loads(harness["icon"]),
                "assets": ids,
            },
        )

    # --- policy -----------------------------------------------------------
    org_branch = branches[org_id]
    kinds = {row["kind"] for row in await connection.fetch("select kind from asset_kinds")}
    if "system_prompt" not in kinds:
        record("kind_seeded", kind="system_prompt")
    await export_policy(connection, by_id, branches, org_branch, report, record)
    # D30h, last: a migrated organisation gets the same catalogue a created one
    # does, **filled by id** over what the records already said. The old schema
    # knew nothing of harness providers — approval was not a concept — so they
    # arrive `approved`: the organisation was already running Pi, and seeding
    # them refused would stop every session after cutover.
    existing = {
        **{path: json.loads(body) for path, body in org_branch.files.items()
           if path.startswith("policy/") or path.endswith("/asset.json")},
        "policy/kinds.json": sorted(kinds),
    }
    seeded = seed.seed_policy("enterprise", existing=existing, approval="approved")
    for path, body in seeded.items():
        org_branch.add_json(path, body)
    # D30j ships as data, so a migrated organisation gains the directory too —
    # unless it already placed one there, which the sidecars above declare.
    for path, file in seed.seed_assets(existing)[0].items():
        org_branch.add(path, file)
    record("harness_providers_seeded",
           providers=[row["id"] for row in seeded["policy/harness-providers.json"]])

    commits = {unit_id: write_branch(repo, branch) for unit_id, branch in branches.items()}
    return {
        "org": str(org_id),
        "path": org["path"],
        "repo": repo,
        "reid": {str(old): str(new) for old, new in reid.items()},
        "placed": placed,
        "chains": chains_of(by_id, branches, commits, members),
    }


def chains_of(
    by_id: dict[UUID, dict[str, Any]],
    branches: dict[UUID, Branch],
    commits: dict[UUID, str],
    members: dict[UUID, str],
) -> list[dict[str, Any]]:
    """One `Chain` per person, root first (00 §4.1)."""
    out = []
    for unit_id, unit in by_id.items():
        if unit["role"] != "user" or unit_id not in branches:
            continue
        lineage: list[dict[str, Any]] = []
        walk: dict[str, Any] | None = unit
        while walk is not None:
            lineage.insert(0, walk)
            walk = by_id.get(walk["parent_id"]) if walk["parent_id"] else None
        out.append(
            {
                "unit": str(unit_id),
                "auth_user": members[unit_id],
                "chain": [
                    {
                        "kind": node["role"],
                        "path": node["path"],
                        "ref": branches[node["id"]].ref,
                        "commit": commits[node["id"]],
                    }
                    for node in lineage
                    if node["id"] in branches
                ],
            }
        )
    return out


async def export_policy(
    connection: asyncpg.Connection,
    by_id: dict[UUID, dict[str, Any]],
    branches: dict[UUID, Branch],
    org_branch: Branch,
    report: list[dict[str, Any]],
    record: Any,
) -> None:
    """02 §11.1's boundary, api_key and model-connection rows."""
    boundaries = {
        row["org_unit_id"]: (
            row["policy"] if isinstance(row["policy"], dict) else json.loads(row["policy"])
        )
        for row in await connection.fetch(
            "select org_unit_id, policy from org_unit_boundaries"
            " where org_unit_id = any($1::uuid[])",
            list(by_id),
        )
    }

    def lineage(unit: dict[str, Any]) -> list[dict[str, Any]]:
        walk, out = unit, []
        while True:
            out.insert(0, walk)
            parent = by_id.get(walk["parent_id"]) if walk["parent_id"] else None
            if parent is None:
                return out
            walk = parent

    # `.allowed_tools` (intersected) → a capability boundary per fixed
    # capability *absent* from the list: the list said what was permitted, and a
    # boundary is a deny (00 §11).
    for unit_id, unit in by_id.items():
        if unit["role"] == "user" or unit_id not in branches:
            continue
        merged = merge_boundaries([boundaries.get(node["id"], {}) for node in lineage(unit)])
        allowed = merged.get("allowed_tools")
        if allowed is None:
            continue
        capabilities = {to_capability(name) for name in allowed}
        for name in sorted(allowed):
            if to_capability(name).startswith("tool."):
                record("tool_entry_dropped", unit=unit["path"], tool=name)
        denied = sorted(FIXED_CAPABILITIES - capabilities)
        if not denied:
            continue
        scope = {"teams": "all"} if unit["role"] == "org" else {"teams": [unit["path"]]}
        branches[unit_id].add_json(
            "policy/boundaries.json",
            [
                {
                    "id": f"legacy-no-{capability}",
                    "scope": scope,
                    "kind": "capability",
                    "value": capability,
                    "holds": "enforced",
                    "reason": "Carried over from this unit's allowed tools at migration.",
                }
                for capability in denied
            ],
        )
    for unit_id, unit in by_id.items():
        policy = boundaries.get(unit_id, {})
        for dropped in (
            "egress_allowlist",
            "connector_allowlist",
            "deploy_tools",
            "approvals",
            "build_policy",
            "budget",
        ):
            if dropped in policy:
                record("boundary_field_dropped", unit=unit["path"], field=dropped)

    # api_keys + the connection/model-default asset, together: a key's entry
    # needs an upstream and an attachment (00 §4.3) and only the model
    # connection says what they are.
    model_rows = await connection.fetch(
        """select a.org_unit_id, v.file_hashes from assets a
             join lateral (select av.* from asset_versions av
                             where av.asset_id = a.id and not (av.provenance ? 'pending_review')
                             order by av.seq desc limit 1) v on true
            where a.kind = 'connection' and a.name = 'model-default' and a.status = 'active'
              and a.org_unit_id = any($1::uuid[])""",
        list(by_id),
    )
    models: dict[UUID, dict[str, Any]] = {}
    for row in model_rows:
        digest = next(
            (value for path, value in dict(row["file_hashes"]).items() if path.endswith(".json")),
            None,
        )
        body = (
            await connection.fetchval("select content from asset_files where hash = $1", digest)
            if digest
            else None
        )
        if body:
            models[row["org_unit_id"]] = json.loads(body)

    keys = await connection.fetch(
        """select k.id, k.org_unit_id, k.name, k.ref from api_keys k
            where k.org_unit_id = any($1::uuid[])
              and exists (select 1 from api_key_versions v
                            where v.api_key_id = k.id and v.status = 'active')""",
        list(by_id),
    )
    # Widest owner first: the org's line is the default for everyone (D30i), so
    # a team that owns its own connection must be written after it and win.
    keys = sorted(keys, key=lambda key: by_id[key["org_unit_id"]]["path"].count("."))
    by_ref = {model.get("key_ref"): (unit_id, model) for unit_id, model in models.items()}
    groups, grants, providers, default_for, approved_for = [], [], [], {}, {}
    for key in keys:
        unit = by_id[key["org_unit_id"]]
        alias = slugify(key["name"])
        found = by_ref.get(key["ref"])
        if unit["role"] == "user":
            record("user_key_needs_owner", key=str(key["id"]), unit=unit["path"])
            continue
        if found is None:
            # 00 §4.3 requires an origin and an attachment; inventing either
            # would be a credential pointed at a host nobody chose.
            record("key_upstream_unknown", key=str(key["id"]), unit=unit["path"], alias=alias)
            continue
        model_unit, model = found
        endpoints = model.get("endpoints") or {
            model.get("wire_format", "openai-completions"): model.get("base_url", "")
        }
        wire_format, base_url = next(iter(endpoints.items()))
        origin = "/".join(base_url.split("/")[:3])
        header = "x-api-key" if wire_format == "anthropic-messages" else "Authorization"
        prefix = "" if header == "x-api-key" else "Bearer "
        # D9: model_policy.user_credentials decides how far down the chain the
        # group permits, and nothing else about it survives.
        merged = merge_boundaries(
            [boundaries.get(node["id"], {}) for node in lineage(by_id[model_unit])]
        )
        credentials = (merged.get("model_policy") or {}).get("user_credentials", "forbidden")
        groups.append(
            {
                "name": f"legacy-{alias}",
                "entries": [
                    {
                        "alias": alias,
                        "secret": {"vault": "bundled", "ref": key["ref"]},
                        "upstream": origin,
                        "attach": {"header": header, "prefix": prefix},
                    }
                ],
                "sources": "vault" if credentials == "forbidden" else "vault-or-local",
            }
        )
        scope = {"teams": "all"} if unit["role"] == "org" else {"teams": [unit["path"]]}
        grants.append(
            {"id": f"legacy-{alias}", "scope": scope, "group": f"legacy-{alias}", "by": "migration"}
        )
        provider_id = model.get("provider", "legacy")
        providers.append(
            {
                "id": provider_id,
                "endpoints": {wire_format: base_url},
                "models": [model["model_id"]] if model.get("model_id") else [],
                "credential": {"alias": alias},
            }
        )
        source = (merged.get("model_policy") or {}).get("source", "proxied")
        if source == "none":
            record("model_source_none", unit=by_id[model_unit]["path"])
        else:
            # D30i: `defaultFor.teams` is keyed by a team path **or the
            # organisation's**, and preflight takes the nearest key on the
            # chain. An organisation-owned connection is therefore one line
            # under the org path — the default for everybody, overridable by a
            # team's own line — and not a copy onto every team.
            owner = by_id[model_unit]
            default_for[owner["path"]] = provider_id
            approved_for[owner["path"]] = [provider_id]

    # Written whether or not the records held any: D30h seeds all of them, and
    # an absent file would be seeded empty over rows that do exist.
    org_branch.add_json("policy/groups.json", groups)
    org_branch.add_json("policy/grants.json", grants)
    org_branch.add_json("policy/model-providers.json", providers)
    org_branch.add_json(
        "policy/routing.json",
        {
            "defaultFor": {"teams": default_for, "harnesses": {}, "providers": {}},
            "approvedFor": {"teams": approved_for, "harnesses": {}, "providers": {}},
        },
    )


async def export_all(database_url: str, out: Path) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    connection = await asyncpg.connect(
        database_url,
        statement_cache_size=0,
        # Structural, not a promise: the server refuses a write on this session.
        server_settings={"default_transaction_read_only": "on"},
    )
    # app/db.py's codec: without it asyncpg hands back jsonb columns
    # (file_hashes, provenance, icon, policy) as raw text, not dicts.
    await connection.set_type_codec(
        "jsonb",
        schema="pg_catalog",
        encoder=lambda value: value if isinstance(value, str) else json.dumps(value),
        decoder=json.loads,
    )
    try:
        report: list[dict[str, Any]] = []
        orgs = [
            await export_org(connection, org, out, report)
            for org in await connection.fetch(
                "select * from org_units where role = 'org' order by path"
            )
        ]
    finally:
        await connection.close()
    result = {"orgs": orgs, "report": report}
    (out / "migration-report.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export today's Postgres records into bare git repos (02 §11)."
    )
    parser.add_argument("--out", required=True, help="a directory to write <org-id>.git repos into")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("set DATABASE_URL or pass --database-url")
    result = asyncio.run(export_all(args.database_url, Path(args.out)))
    print(json.dumps({"orgs": len(result["orgs"]), "recorded": len(result["report"])}, indent=2))


if __name__ == "__main__":
    main()
