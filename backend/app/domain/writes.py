"""The one write seam onto a ref (console 00 §8 D9, 03 §8.9).

Every "commit on a ref" write in 00 §4.11 goes through `commit()` here: it
reads the file at the ref, the route edits it, and this module posts one
`CommitRequest` to `definitions:/internal/commit` (engine 02 §5.3) and appends
**one** authoritative audit event with the action strings of console 03 §6. No
route calls `definitions` itself and no route appends its own event for a ref
write — that is what makes a change one commit and one row.

Three things this module is careful about, each learned from the code it talks
to rather than from a document:

* **The audit event is appended after the HTTP call returns.** `/internal/commit`
  calls back into `api` (`/v1/internal/audit`, then `/v1/internal/index`) before
  it answers, and the audit callback takes `for update` on this org's
  `audit_log_latest_hashes` row. An event appended first would hold that lock
  while we wait on the answer, and the two would deadlock until the timeout. A
  refused commit must leave no event behind anyway, so "after" is also correct.
* **`/internal/tree` cannot carry a ref.** Its path is
  `/internal/tree/<org>/<rev>/<path…>` and a ref like `refs/heads/teams/a.b` has
  slashes in it, so the head commit is what we pass — which we need for
  `expectedHead` regardless.
* **A failed read never blanks a file.** We rewrite whole files, so a read that
  answered "absent" when the file exists would delete its contents. When the
  index says the node holds the file and `definitions` would not give it to us,
  the write is refused (503) instead.

`definitions_client` is not reused for these two calls because it collapses
every non-2xx into one 503: this seam needs the 409 `definitions.head_moved`
and the pre-receive refusal message. Its `transport` hook is honoured, so a
test still points one place at a fake service.
"""

import base64
import json
import os
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx

from app.domain import definitions_client
from app.domain.audit import append_event
from app.errors import ApiError
from app.identity import Principal

ORG_REF = "refs/heads/org"

# engine 01 §4.2. Org-only files, refused on a team ref at pre-receive (02 §7
# step 10); checked here so the second check is `definitions`, not the first.
ORG_ONLY = {
    "policy/kinds.json",
    "policy/groups.json",
    "policy/harness-providers.json",
    "policy/model-providers.json",
    "policy/routing.json",
    "policy/always-loaded.json",
}

# `engine/definitions/src/validate.ts` step 8, verbatim. A group entry holds a
# `SecretRef`, never a value, and the scanner does not know the difference.
SECRET_PATTERNS = [
    re.compile(r"secret://[a-z0-9./-]+"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{36}"),
    re.compile(r"xox[bp]-"),
]


# --- who is asking ---------------------------------------------------------


@dataclass
class Authority:
    """The viewer, their organization, and what they may write on.

    `level` and `at` are 00 §4.1's `Viewer.role` (member · team-admin ·
    org-admin) for the sentences; `administers()` is the decision, because a
    role granted at a node covers that node's whole subtree.
    """

    principal: Principal
    user_unit_id: UUID
    user_path: str
    org_id: UUID
    org_path: str
    level: str
    at: str | None
    connection: Any

    async def administers(self, node_path: str) -> str | None:
        """The role covering `node_path`, or None. `'org'` beats `'team'`."""
        row = await self.connection.fetchrow(
            """select u.role from org_unit_admins a join org_units u on u.id=a.org_unit_id
                where a.auth_user_id=$1 and ($2 = u.path or $2 like u.path || '.%')
                order by case u.role when 'org' then 0 else 1 end limit 1""",
            self.principal.auth_user_id,
            node_path,
        )
        return None if row is None else ("org-admin" if row["role"] == "org" else "team-admin")

    @property
    def is_org_admin(self) -> bool:
        return self.level == "org-admin"

    @property
    def author(self) -> dict[str, str]:
        """`CommitRequest.author`. `Principal` carries an id and an email, so
        the name is the email's local part rather than an invented one."""
        email = self.principal.email or f"{self.principal.auth_user_id}@harness"
        return {
            "userId": str(self.principal.auth_user_id),
            "name": email.split("@", 1)[0],
            "email": email,
        }

    def ref_for(self, node_path: str) -> str:
        """02 §5.3's three ref shapes, from a dotted path this org owns."""
        if node_path == self.org_path:
            return ORG_REF
        if node_path == self.user_path:
            return f"refs/heads/users/{self.principal.auth_user_id}"
        return f"refs/heads/teams/{node_path}"


async def authority(connection: Any, principal: Principal) -> Authority:
    unit = await connection.fetchrow(
        """select u.id, u.path from org_unit_members m join org_units u on u.id=m.user_unit_id
            where m.auth_user_id=$1""",
        principal.auth_user_id,
    )
    if unit is None:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    org = await connection.fetchrow(
        """with recursive up as (
             select id, parent_id, role, path from org_units where id=$1
             union all select p.id, p.parent_id, p.role, p.path
                         from org_units p join up on up.parent_id=p.id
           ) select id, path from up where role='org' limit 1""",
        unit["id"],
    )
    row = await connection.fetchrow(
        """select u.role, u.path from org_unit_admins a join org_units u on u.id=a.org_unit_id
            where a.auth_user_id=$1 and ($2 = u.path or $2 like u.path || '.%')
            order by case u.role when 'org' then 0 else 1 end limit 1""",
        principal.auth_user_id,
        unit["path"],
    )
    return Authority(
        principal=principal,
        user_unit_id=unit["id"],
        user_path=unit["path"],
        org_id=org["id"],
        org_path=org["path"],
        level=("member" if row is None else
               "org-admin" if row["role"] == "org" else "team-admin"),
        at=None if row is None else row["path"],
        connection=connection,
    )


def name_of(node_path: str) -> str:
    """The last dotted segment — what a refusal sentence calls a team."""
    return node_path.rsplit(".", 1)[-1]


async def unit_of(connection: Any, node_path: str) -> UUID:
    """The records id for a dotted path. Audit is chained per unit, so a write
    on a node's ref is recorded on that node."""
    unit = await connection.fetchval("select id from org_units where path=$1", node_path)
    if unit is None:
        raise ApiError(404, "org_unit_not_found", "This org unit could not be found.")
    return unit


async def unit_by_id_or_path(connection: Any, id_or_path: str) -> dict:
    """A console route takes either (the reads give paths, the records give
    ids), so both resolve here and nowhere else."""
    try:
        key = UUID(id_or_path)
        row = await connection.fetchrow("select * from org_units where id=$1", key)
    except ValueError:
        row = await connection.fetchrow("select * from org_units where path=$1", id_or_path)
    if row is None:
        raise ApiError(404, "org_unit_not_found", "This org unit could not be found.")
    return dict(row)


# --- the service calls -----------------------------------------------------


def _endpoint() -> tuple[str, str]:
    base = os.environ.get("DEFINITIONS_URL", "").rstrip("/")
    token = os.environ.get("HARNESS_SERVICE_TOKEN", "")
    if not base or not token:
        raise ApiError(
            503,
            "definitions_unconfigured",
            "The definition service is not configured, so nothing can be written yet.",
            remedy="An operator sets DEFINITIONS_URL and HARNESS_SERVICE_TOKEN.",
        )
    return base, token


async def _call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    base, token = _endpoint()
    try:
        async with httpx.AsyncClient(
            timeout=definitions_client.TIMEOUT, transport=definitions_client.transport
        ) as client:
            response = await client.request(
                method,
                f"{base}{path}",
                headers={"authorization": f"Bearer {token}"},
                json=body,
            )
    except httpx.HTTPError as exc:
        raise ApiError(
            503,
            "definitions_unreachable",
            "The definition service could not be reached. Nothing was written; try again.",
            remedy="Try again in a moment.",
        ) from exc
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, {}


async def head_of(connection: Any, org_id: UUID, ref: str) -> str:
    """The ref's head as the index holds it — `expectedHead`, and the revision
    a file is read at. A branch is created with a root commit and indexed at
    creation (02 §5.3), so no row means the index is behind, not that the ref
    is empty: fail closed rather than send `expectedHead: null` and have
    `definitions` refuse the update as not-fast-forward."""
    head = await connection.fetchval(
        "select commit from idx_refs where org=$1 and ref=$2", org_id, ref
    )
    if not head:
        raise ApiError(
            409,
            "index_behind",
            "The server has not finished reading the latest change to your organization.",
            {"ref": ref},
            remedy="Run again in a few seconds.",
        )
    return head


async def _indexed(connection: Any, org_id: UUID, node_path: str, path: str) -> bool:
    """Does the index say this node holds this file? Used only to tell an
    absent file from a read that failed (see the module docstring)."""
    if path.startswith("policy/"):
        return bool(
            await connection.fetchval(
                "select 1 from idx_policy where org=$1 and node_path=$2 and file=$3",
                org_id,
                node_path,
                path.removeprefix("policy/"),
            )
        )
    if path.startswith("harnesses/"):
        return bool(
            await connection.fetchval(
                "select 1 from idx_harnesses where org=$1 and node_path=$2 and id=$3",
                org_id,
                node_path,
                UUID(path.removeprefix("harnesses/").removesuffix(".json")),
            )
        )
    return False


async def read_json(
    connection: Any,
    *,
    org_id: UUID,
    node_path: str,
    head: str,
    path: str,
    default: Any,
) -> Any:
    """The file as it stands on the ref, or `default` when it is not there."""
    status, body = await _call("GET", f"/internal/tree/{org_id}/{head}/{path}")
    if status == 200 and "blob" in body:
        try:
            return json.loads(base64.b64decode(body["blob"]).decode())
        except (ValueError, UnicodeDecodeError) as exc:
            raise ApiError(
                422,
                "policy_invalid",
                f"{path} on this branch is not valid JSON, so it cannot be edited here.",
                {"path": path},
                remedy="An operator fixes the file with a push.",
            ) from exc
    if await _indexed(connection, org_id, node_path, path):
        raise ApiError(
            503,
            "definitions_unreadable",
            "The current contents of this file could not be read, so nothing was changed.",
            {"path": path},
            remedy="Try again in a moment.",
        )
    return default


def blob(body: Any) -> str:
    """A whole file, as `CommitRequest.changes[*].blob` wants it: base64."""
    text = json.dumps(body, indent=2, ensure_ascii=False) + "\n"
    return base64.b64encode(text.encode()).decode()


def refuse_secrets(body: Any, *, path: str) -> None:
    """Step 8 of 02 §7, mirrored: a value in a tree is refused at pre-receive,
    and a refusal there arrives as an opaque 400 the console cannot act on."""
    text = json.dumps(body)
    for pattern in SECRET_PATTERNS:
        found = pattern.search(text)
        if found:
            raise ApiError(
                422,
                "policy.secret_in_tree",
                f"{path} may not carry a secret, and `{found.group(0)}` looks like one.",
                {"path": path, "match": found.group(0)},
                remedy="Name the secret by its vault reference, not by its value.",
            )


async def commit(
    connection: Any,
    *,
    org_id: UUID,
    ref: str,
    changes: list[dict[str, Any]],
    message: str,
    reason: dict[str, Any],
    author: dict[str, str],
    actor_id: UUID,
    audit_unit: UUID,
    action: str,
    payload: dict[str, Any],
    expected_head: str | None = None,
) -> dict[str, Any]:
    """00 §8 D9, the whole of it: one `CommitRequest`, one audit event.

    `reason.kind` is 02 §5.3's vocabulary (`promote` · `accept` · `rollback` ·
    `admin-edit` · `grant` · `revoke`); `action` is one of 03 §6's strings and
    the payload is what that sentence needs. A policy change also revokes the
    sessions it affects — `definitions` does that from its post-receive
    (engine 04 §5.5), which is reached because this commit goes through it.
    """
    for change in changes:
        if ref.startswith("refs/heads/teams/") and change["path"] in ORG_ONLY:
            raise ApiError(
                403,
                "policy.org_only",
                f"{change['path']} belongs to the organization branch, "
                "so it cannot be written on a team's.",
                {"path": change["path"]},
            )
        if ref.startswith("refs/heads/users/") and change["path"].startswith("policy/"):
            raise ApiError(
                403,
                "policy.on_user_branch",
                "Policy is never held on a person's branch.",
                {"path": change["path"]},
            )
    head = expected_head or await head_of(connection, org_id, ref)
    status, body = await _call(
        "POST",
        "/internal/commit",
        {
            "org_id": str(org_id),
            "ref": ref,
            "expectedHead": head,
            "author": author,
            "message": message,
            "changes": changes,
            "reason": reason,
        },
    )
    if status == 409 and body.get("code") == "definitions.head_moved":
        raise ApiError(
            409,
            "definitions.head_moved",
            "This branch moved while you were deciding, so nothing was written.",
            {"head": body.get("head"), "ref": ref},
            remedy="Reload the page and try again.",
        )
    if status >= 300:
        raise ApiError(
            502 if status >= 500 else 422,
            body.get("code") or "definitions_refused",
            body.get("message")
            or "The definition service refused this change. Nothing was written.",
            {"ref": ref, "status": status},
        )
    sha = body.get("commit", "")
    await append_event(
        connection,
        org_unit_id=audit_unit,
        actor_type="user",
        actor_id=actor_id,
        event_class="authoritative",
        action=action,
        payload={**payload, "commit": sha, "ref": ref},
    )
    return {"commit": sha, "ref": ref}


async def write_file(
    connection: Any,
    *,
    who: Authority,
    node_path: str,
    path: str,
    body: Any,
    message: str,
    reason_kind: str,
    action: str,
    payload: dict[str, Any],
    request_id: str | None = None,
    expected_head: str | None = None,
) -> dict[str, Any]:
    """Commit one whole file back onto a node's ref. `body is None` deletes it.

    `expected_head` is the head `edit_file` read the file at, and every caller
    that read one passes it: reading at A and committing against a re-read B
    would take B's change away without anything refusing it.
    """
    ref = who.ref_for(node_path)
    if body is None:
        change: dict[str, Any] = {"path": path, "delete": True}
    else:
        refuse_secrets(body, path=path)
        change = {"path": path, "blob": blob(body)}
    reason: dict[str, Any] = {"kind": reason_kind}
    if request_id:
        reason["request"] = request_id
    return await commit(
        connection,
        org_id=who.org_id,
        ref=ref,
        changes=[change],
        message=message,
        reason=reason,
        author=who.author,
        actor_id=who.principal.auth_user_id,
        audit_unit=await unit_of(connection, node_path),
        action=action,
        payload=payload,
        expected_head=expected_head,
    )


async def edit_file(
    connection: Any,
    *,
    who: Authority,
    node_path: str,
    path: str,
    default: Any,
) -> tuple[Any, str]:
    """Read the file at the node's ref, ready to be edited and written back."""
    ref = who.ref_for(node_path)
    head = await head_of(connection, who.org_id, ref)
    current = await read_json(
        connection,
        org_id=who.org_id,
        node_path=node_path,
        head=head,
        path=path,
        default=default,
    )
    return current, head


# --- what the index already knows (validation inputs) ----------------------
#
# The file being rewritten is read from `definitions` (above). Everything a
# rule is checked *against* — the org's groups, the grants a team holds, where
# a harness lives — is read from the index, which is what every other read in
# `api` uses and costs no round trip.


async def policy_files(connection: Any, org_id: UUID, node_path: str) -> dict[str, Any]:
    rows = await connection.fetch(
        "select file, body from idx_policy where org=$1 and node_path=$2", org_id, node_path
    )
    return {row["file"]: row["body"] for row in rows}


def ancestors_of(node_path: str) -> list[str]:
    """`a`, `a.b`, `a.b.c` for `a.b.c` — root first, the node included."""
    parts = node_path.split(".")
    return [".".join(parts[: index + 1]) for index in range(len(parts))]


async def grants_reaching(connection: Any, org_id: UUID, node_path: str) -> list[dict[str, Any]]:
    """Every grant accumulated on the chain down to this node (01 §6 step 8):
    the org's, then each ancestor team's narrowed ones. A narrowed grant may
    itself be narrowed, so the node's own file is in the list too."""
    grants: list[dict[str, Any]] = []
    for path in ancestors_of(node_path):
        grants.extend((await policy_files(connection, org_id, path)).get("grants.json") or [])
    return grants


async def org_groups(connection: Any, org_id: UUID, org_path: str) -> dict[str, Any]:
    files = await policy_files(connection, org_id, org_path)
    return {group["name"]: group for group in (files.get("groups.json") or [])}


async def node_holding(
    connection: Any, org_id: UUID, file: str, matches: Any
) -> tuple[str, list[Any]] | None:
    """The node whose `policy/<file>` holds an entry the predicate accepts, and
    that file's rows as the index has them. Used to find a grant or a boundary
    by id without asking the console which node it is on."""
    rows = await connection.fetch(
        "select node_path, body from idx_policy where org=$1 and file=$2 order by node_path",
        org_id,
        file,
    )
    for row in rows:
        body = row["body"] or []
        if any(matches(entry) for entry in body):
            return row["node_path"], body
    return None


async def node_of_harness(connection: Any, org_id: UUID, harness_id: UUID) -> tuple[str, dict]:
    row = await connection.fetchrow(
        "select node_path, def from idx_harnesses where org=$1 and id=$2", org_id, harness_id
    )
    if row is None:
        raise ApiError(404, "harness_not_found", "No harness with that id is on your chain.")
    return row["node_path"], row["def"]


# --- the engine's own rules, checked before the commit ---------------------


def invalid(field: str, reason: str, code: str = "invalid_request") -> ApiError:
    return ApiError(422, code, reason, {"errors": [{"field": field, "reason": reason}]})


def validate_scope(scope: Any, *, field: str = "scope") -> dict[str, Any]:
    """engine 00 §4.3 `Scope`. A user path is never a scope target (04 §5.1)."""
    if not isinstance(scope, dict) or "teams" not in scope:
        raise invalid(field, "A scope names the teams it reaches.")
    teams = scope["teams"]
    if teams != "all" and not (isinstance(teams, list) and all(isinstance(t, str) for t in teams)):
        raise invalid(f"{field}.teams", "Teams are a list of dotted paths, or \"all\".")
    if "harnesses" in scope and scope["harnesses"] is not None:
        if not isinstance(scope["harnesses"], list):
            raise invalid(f"{field}.harnesses", "Harnesses are a list of ids.")
    return scope


def validate_group(group: dict[str, Any]) -> None:
    """engine 00 §4.3 `SecurityGroup`: the proxy needs alias, upstream and
    attachment, so an entry without all three is refused here (05 §6). A group
    is a named set, so it may be created with none: the first entry comes
    after (04 §8 *Create a group*)."""
    if not group.get("name"):
        raise invalid("name", "A security group needs a name.")
    if group.get("sources") not in ("vault", "vault-or-local"):
        raise invalid("sources", "Sources are `vault` or `vault-or-local`.")
    entries = group.get("entries")
    if not isinstance(entries, list):
        raise invalid("entries", "A security group's entries are a list.")
    for index, entry in enumerate(entries):
        where = f"entries.{index}"
        if not entry.get("alias"):
            raise invalid(f"{where}.alias", "An entry needs an alias.")
        secret = entry.get("secret") or {}
        if not secret.get("vault") or not secret.get("ref"):
            raise invalid(f"{where}.secret", "An entry names a vault and a reference in it.")
        if not entry.get("upstream"):
            raise invalid(f"{where}.upstream", "An entry names the origin it is used at.")
        attach = entry.get("attach") or {}
        if "header" not in attach or "prefix" not in attach:
            raise invalid(f"{where}.attach", "An entry says how the secret is attached.")


def validate_narrowed_grant(
    grant: dict[str, Any],
    *,
    node_path: str,
    source_grants: list[dict[str, Any]],
    groups: dict[str, Any],
) -> None:
    """engine 01 §6 step 9, clause for clause. `prd-v2` §6.4 as arithmetic:
    a team may only ever hand down less than it holds."""
    narrowed = grant.get("narrowedFrom") or {}
    source = next((g for g in source_grants if g.get("id") == narrowed.get("grant")), None)
    if source is None:  # (a)
        raise ApiError(
            422,
            "grant.source_unknown",
            f"No grant with id {narrowed.get('grant')!r} reaches {name_of(node_path)}.",
            {"clause": "a"},
        )
    teams = source["scope"].get("teams")
    covers_node = teams == "all" or any(
        node_path == team or node_path.startswith(team + ".") for team in teams
    )
    if not covers_node:  # (b)
        raise ApiError(
            422,
            "grant.not_held",
            f"{name_of(node_path)} does not hold the grant it is narrowing.",
            {"clause": "b"},
        )
    scope_teams = grant["scope"].get("teams")
    if scope_teams == "all" or not scope_teams or not all(
        team.startswith(node_path + ".") for team in scope_teams
    ):  # (c)
        raise ApiError(
            422,
            "grant.not_subset",
            f"A narrowed grant reaches sub-teams of {name_of(node_path)} and nothing else.",
            {"clause": "c"},
        )
    source_harnesses = source["scope"].get("harnesses")
    own_harnesses = grant["scope"].get("harnesses")
    if source_harnesses is not None and (
        own_harnesses is None or not set(own_harnesses) <= set(source_harnesses)
    ):  # (c)
        raise ApiError(
            422,
            "grant.not_subset",
            "A narrowed grant cannot reach a harness the grant it came from does not.",
            {"clause": "c"},
        )
    if not source.get("group"):  # (d)
        raise ApiError(
            422,
            "grant.not_narrowable",
            "A reach grant has no aliases to narrow.",
            {"clause": "d"},
        )
    aliases = narrowed.get("aliases") or []
    held = {entry["alias"] for entry in (groups.get(source["group"]) or {}).get("entries", [])}
    if not aliases or not set(aliases) <= held:  # (d)
        raise ApiError(
            422,
            "grant.not_subset",
            "A narrowed grant keeps some of the aliases the group holds, and no others.",
            {"clause": "d", "held": sorted(held)},
        )
    if grant.get("group") != source["group"]:  # (e)
        raise ApiError(
            422,
            "grant.not_subset",
            "A narrowed grant names the same security group it came from.",
            {"clause": "e"},
        )


def validate_boundary(boundary: dict[str, Any], *, node_path: str) -> None:
    """engine 00 §4.3 `Boundary`, plus C32's direction: a boundary set at a
    node reaches that node's subtree and nothing above it."""
    if boundary.get("kind") not in ("endpoint", "command", "filesystem", "capability"):
        raise invalid("kind", "A boundary is on an endpoint, a command, the filesystem "
                              "or a capability.")
    if boundary.get("holds") not in ("enforced", "intercepted"):
        raise invalid("holds", "A boundary is enforced or intercepted.")
    if not boundary.get("value"):
        raise invalid("value", "A boundary needs the value it holds against.")
    if not boundary.get("reason"):
        raise invalid("reason", "A boundary needs a reason; it is read by whoever hits it.")
    if boundary["kind"] == "command":
        validate_command_pattern(boundary)
    teams = boundary["scope"].get("teams")
    if teams != "all":
        outside = [team for team in teams
                   if not (team == node_path or team.startswith(node_path + "."))]
        if outside:
            raise ApiError(
                422,
                "boundary.outside_subtree",
                f"A boundary set at {name_of(node_path)} reaches {name_of(node_path)} "
                "and the teams inside it, and no others.",
                {"teams": outside},
            )


def validate_command_pattern(boundary: dict[str, Any]) -> None:
    """W6-D153. A boundary of kind `command` is the **runtime's** refusal, not
    the fence's: Pi's extension blocks the `bash` call and Claude Code's
    `permissions.deny` refuses it. Neither is a route that does not exist or a
    file that is not readable, so `enforced` would be a word the product cannot
    keep — a command boundary is `intercepted` and nothing else (engine 06 §13).

    The shape rule is `commandPatternProblem`'s, in `@harness/compose`: the
    console validates with it before the write and this is the same question
    asked again where it is authoritative, in the same sentence. There is no
    Python copy of the *matcher* — the rule is compiled once, in compose, and
    travels to the two runtimes through the plan (engine 07 §7, §8)."""
    if boundary.get("holds") != "intercepted":
        raise invalid(
            "holds",
            "A command boundary is intercepted: the runtime refuses the call as it is "
            "made. Nothing outside the runtime can enforce a command.",
        )
    pattern = str(boundary.get("value") or "").strip()
    if not pattern:
        raise invalid(
            "value",
            "A command boundary needs a pattern — the command line it holds against.",
        )
    if not pattern.replace("*", "").strip():
        raise invalid(
            "value",
            "A pattern of only * denies every command there is. Name the command you mean.",
        )


def validate_harness_provider(provider: dict[str, Any]) -> None:
    if provider.get("approval") not in ("approved", "beta", "not-approved"):
        raise invalid("approval", "A provider is approved, beta or not-approved.")
    pin = provider.get("pin") or {}
    if not (("repo" in pin and "commit" in pin) or ("binary" in pin and "minVersion" in pin)):
        raise invalid("pin", "A provider is pinned to a repo and commit, or a binary and "
                             "a minimum version.")
    if not isinstance(provider.get("speaks"), list) or not provider["speaks"]:
        raise invalid("speaks", "A provider names the wire formats it speaks.")
    if provider["approval"] != "approved" and not provider.get("reason"):
        raise invalid("reason", "Say why: the reason is shown to everyone it stops.")
    validate_scope(provider.get("scope"))


def validate_model_provider(provider: dict[str, Any]) -> None:
    endpoints = provider.get("endpoints")
    if not isinstance(endpoints, dict) or not endpoints:
        raise invalid("endpoints", "A model provider needs a base URL per wire format.")
    # An empty list is the seeded state (D30h): a preset is a row before anyone
    # has said which model to ask it for, and `POST …/setup` is where they do.
    if not isinstance(provider.get("models"), list):
        raise invalid("models", "A model provider names the models it serves.")
    credential = provider.get("credential")
    if credential is not None and not credential.get("alias"):
        raise invalid("credential.alias", "A credential is named by its alias.")


def validate_routing(routing: dict[str, Any]) -> None:
    for side in ("defaultFor", "approvedFor"):
        table = routing.get(side)
        if not isinstance(table, dict):
            raise invalid(side, "Routing has a table per target kind.")
        for key in ("teams", "harnesses", "providers"):
            if not isinstance(table.get(key, {}), dict):
                raise invalid(f"{side}.{key}", "Each target kind maps an id to its providers.")


def validate_harness(harness: dict[str, Any]) -> None:
    if not harness.get("name"):
        raise invalid("name", "A harness needs a name.")
    if not isinstance(harness.get("assets", []), list):
        raise invalid("assets", "A harness names asset ids.")
    icon = harness.get("icon")
    if icon is not None and not (
        isinstance(icon, dict) and isinstance(icon.get("rows"), list)
        and isinstance(icon.get("palette"), list)
    ):
        raise invalid("icon", "A drawing is 16 rows indexing a palette.")
    if harness.get("reach") is not None:
        validate_reach(harness["reach"], field="reach")


def validate_reach(reach: Any, *, field: str = "reach") -> dict[str, Any]:
    """D131's shape, the one place it is checked: a mode and a host list, where
    a host is an exact name or `*.suffix`. Narrowing is `definitions`' rule at
    the push (`definitions.reach_widens`), not a second copy here."""
    if not isinstance(reach, dict) or reach.get("mode") not in ("off", "allow", "on"):
        raise invalid(f"{field}.mode", "Reach is off, allow or on.")
    hosts = reach.get("hosts") or []
    if not isinstance(hosts, list) or any(not isinstance(host, str) for host in hosts):
        raise invalid(f"{field}.hosts", "Hosts are a list of names.")
    for host in hosts:
        if not HOST.fullmatch(host):
            raise invalid(f"{field}.hosts", f"{host!r} is not a host name or a `*.suffix`.")
    # `off` ignores the list, so it is not carried: the file says what it means.
    kept = [] if reach["mode"] == "off" else list(dict.fromkeys(hosts))
    return {"mode": reach["mode"], "hosts": kept}


# D133's matching rule, as the shape a person may type: an exact host, or
# `*.` and a suffix. No regex, no CIDR, no port (D77).
HOST = re.compile(r"(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")
