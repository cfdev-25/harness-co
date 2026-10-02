"""The console's read model (03 §4): one function per endpoint group.

Everything here is a read of `idx_*` or of a record table. Two rules shape
the module:

* **The index is flagged, never fetched around.** `console_index`'s three
  seams raise `IndexStale` because the broker fails closed; the console does
  not (03 D38, `stale_index_flags_not_refuses`), so these queries read `idx_*`
  directly and carry `stale: { since, refs }` alongside the answer.
* **File bytes, history and diffs come from `definitions`** through `api`
  (00 D8). Nothing here parses a repository; `api` parses unified-diff text
  into `DiffHunk[]` and no route calls `definitions` itself.
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from app.domain import broker, console_index, seed
from app.domain.audit import append_event, descendant_events
from app.domain.resolvers import BUNDLED, registry, resolver_for
from app.domain.sentences import (
    FAILURES,
    GIT_BACKED,
    HIDDEN,
    SENTENCES,
    UNANSWERED,
    sentence,
)
from app.errors import ApiError

# 03 §5: one label per `rel` in engine 02 §8.2, defined once. A rel without a
# label is a test failure (`every_rel_has_a_via_label`).
VIA: dict[str, str] = {
    "placed_on": "placed on",
    "includes": "includes",
    "needs_alias": "satisfied by",
    "entry": "has an entry for",
    "entry_secret": "holds",
    "entry_upstream": "reaches",
    "grants": "granted by",
    "reach": "gives reach beyond its entries",
    "scoped_to": "scoped to",
    "only_for": "only for",
    "narrowed_from": "narrowed from",
    "credential": "signs in with",
    "default_for": "routed to",
    "approved_for": "approved for",
    "speaks": "speaks",
    "exposes": "exposes",
}

DEFAULT_LIMIT, MAX_LIMIT = 50, 200
_ORG_POLICY_FILES = ("groups.json", "model-providers.json", "harness-providers.json",
                     "routing.json", "kinds.json", "always-loaded.json")
_EMPTY_ROUTING = {"defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
                  "approvedFor": {"teams": {}, "harnesses": {}, "providers": {}}}


def fail(code: str, **fields: Any) -> ApiError:
    """03 §11's table, raised as the one envelope. Every 403 names who decides."""
    status, message, remedy = FAILURES[code]
    return ApiError(status, code, message.format(**fields), remedy=remedy.format(**fields) or None)


def now() -> str:
    return datetime.now(UTC).isoformat()


def fact(value: Any, provenance: str, at: str | None = None, by: str | None = None) -> dict:
    return {"value": value, "provenance": provenance, "at": at, "by": by}


def related(unit: str, items: list[dict], all_of_them: bool = False) -> dict:
    return {"unit": unit, "items": items, "all": True if all_of_them else None}


def tag(scale: str, value: str) -> dict:
    return {"scale": scale, "value": value}


# --- pagination (03 §4, `pagination_cursor_is_opaque`) ----------------------


def encode_cursor(sort_key: Any, ident: Any) -> str:
    raw = f"{sort_key}\x1f{ident}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        key, ident = base64.urlsafe_b64decode(padded.encode()).decode().split("\x1f", 1)
    except Exception as error:
        raise ApiError(422, "invalid_request", "That cursor is not one we issued.",
                       {"errors": [{"field": "cursor", "reason": "not a cursor"}]}) from error
    return key, ident


def page(rows: list[dict], limit: int | None, cursor: str | None,
         key: Any = lambda row: (str(row.get("name") or ""), str(row.get("id") or ""))) -> dict:
    """Keyset over an ordered list. Index-backed lists are small enough to
    order in the query and slice here; the cursor is the same opaque pair."""
    size = min(max(limit or DEFAULT_LIMIT, 1), MAX_LIMIT)
    if cursor:
        after = decode_cursor(cursor)
        rows = [row for row in rows if key(row) > after]
    window, rest = rows[:size], rows[size:]
    return {"items": window, "next": encode_cursor(*key(window[-1])) if rest and window else None}


# --- the viewer, the scope, and `?as` (03 §4) -------------------------------


@dataclass
class Ctx:
    # One request's connection (`routes_console.viewer_of`), not the pool:
    # every read here runs on it in turn, so nothing may run two at once.
    pool: Any
    actor: UUID                      # the signed-in person
    actor_email: str
    viewer: UUID                     # the person the answer is computed for (`?as`)
    viewer_email: str
    unit_id: UUID                    # the viewer's user node
    org_id: UUID
    org_path: str
    chain: list[dict]
    role: dict
    scope: str
    scope_paths: list[str]           # nodes the scope's reads may see
    # The team `?scope=team:<path>` names. Not `scope_paths[1]`: those are
    # sorted, so a sub-team's scope would answer with its parent.
    scope_path: str
    scope_unit: UUID                 # the org_units row the scope walks down from
    # Whether the viewer administers the scope. Being *on* a team is enough to
    # read its index — grants, boundaries, harnesses apply to you — but not to
    # read other people's records: a member "reads every log about themselves"
    # (05 §4, `role`), so sessions, logs and endpoints narrow to their own.
    admin_here: bool
    visibility: dict
    staff: bool
    edition: str
    stale: dict | None = None
    as_user: UUID | None = None
    cache: dict = field(default_factory=dict)

    @property
    def own_records_only(self) -> bool:
        """The predicate every record-backed read shares."""
        return self.scope == "me" or not self.admin_here

    @property
    def teams(self) -> list[str]:
        return [node["path"] for node in self.chain if node["kind"] == "team"]

    @property
    def segment(self) -> str:
        """00 D2: scope is **one** route segment — `org`, `me`, or the dotted
        team path. Every link this module builds starts `/console/<segment>/`,
        so a person reading their own view is never sent to `/console/org/…`,
        which they may not open, and never to `/console/team/<path>`, which is
        not a route."""
        return self.scope_path if self.scope == "team" else self.scope

    def hidden(self, key: str) -> dict | None:
        """P10: at `me`, an org admin may have turned a view off. The response
        says so in place of the list; it is never a shorter list."""
        if self.scope == "me" and not self.visibility.get(key, True):
            return {key: HIDDEN[key]}
        return None


async def _member(connection: Any, auth_user_id: UUID) -> dict:
    row = await connection.fetchrow(
        """select u.id, u.path, m.deactivated_at, coalesce(a.email,'') email
             from org_unit_members m join org_units u on u.id=m.user_unit_id
             left join auth.users a on a.id=m.auth_user_id
            where m.auth_user_id=$1""",
        auth_user_id,
    )
    if row is None:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    return dict(row)


async def context(pool: Any, principal: Any, scope: str | None = None,
                  as_user: UUID | None = None, endpoint: str = "") -> Ctx:
    """Resolve the viewer, the scope and `?as` once per request.

    `?as` is allowed only to a team or org admin whose `role.at` is an ancestor
    of the member's user node, and the read is recorded (03 D33): the member is
    told, so the console cannot read a branch silently.

    Two round trips — the member with their chain, then every fact about the
    chain in one statement — because the database is a network away and each
    query is paid in full before the next can start.
    """
    actor, org_id, chain = await _member_chain(pool, principal.auth_user_id)
    org_path = chain[0]["path"] if chain else ""
    facts = await _facts(pool, principal.auth_user_id, org_id, org_path, chain)
    role = facts["role"]
    viewer, viewer_id, viewer_email = actor, principal.auth_user_id, actor["email"]
    if as_user is not None and as_user != principal.auth_user_id:
        if role["level"] == "member" or role["at"] is None:
            raise fail("console.as_forbidden", teams=_teams_of(chain))
        try:
            member = await _member(pool, as_user)
        except ApiError as unknown:      # not a person, so not a person you may read
            raise fail("console.as_forbidden", teams=_teams_of(chain)) from unknown
        if not _under(member["path"], role["at"]):
            raise fail("console.as_forbidden", teams=_teams_of(chain))
        viewer, viewer_id, viewer_email = member, as_user, member["email"]
        _, chain = await _chain(pool, member["id"], as_user)
        facts["visibility"] = await _visibility(pool, [node["path"] for node in chain])
        await _audit_read_as(pool, role["at"], principal.auth_user_id, as_user, endpoint)
    kind, paths, unit, admin, at = await _scope(
        pool, scope, chain, role, org_id, org_path, viewer)
    return Ctx(
        pool=pool, actor=principal.auth_user_id, actor_email=actor["email"], viewer=viewer_id,
        viewer_email=viewer_email, unit_id=viewer["id"], org_id=org_id, org_path=org_path,
        chain=chain, role=role, scope=kind, scope_paths=paths, scope_unit=unit,
        scope_path=at, admin_here=admin,
        visibility=facts["visibility"], staff=facts["staff"], edition=facts["edition"],
        stale=facts["stale"],
        as_user=as_user if as_user != principal.auth_user_id else None,
    )


# The walk up from a person's node — `broker.chain_for` and `broker._org_id`
# in one statement: root first, each ref with its indexed commit. `up` is the
# CTE the caller supplies: it starts the walk from the person's `org_units`
# row, found however the caller finds it.
_CHAIN_SQL = """
           union all
           select p.id, p.parent_id, p.role, p.path, u.depth+1
             from org_units p join up u on u.parent_id=p.id
         ), named as (
           select up.id, up.role, up.path, up.depth,
                  case up.role when 'org' then 'refs/heads/org'
                               when 'team' then 'refs/heads/teams/'||up.path
                               else 'refs/heads/users/'||$2::text end ref
             from up
         )
         select n.id, n.role, n.path, n.ref, coalesce(r.commit, '') commit{columns}
           from named n
           left join idx_refs r on r.ref = n.ref
                               and r.org = (select id from named where role='org' limit 1){joins}
          order by n.depth desc"""


def _chain_of(rows: list) -> tuple[UUID | None, list[dict]]:
    org_id = next((row["id"] for row in rows if row["role"] == "org"), None)
    chain = [{"kind": row["role"], "path": row["path"], "ref": row["ref"], "commit": row["commit"]}
             for row in rows]
    return org_id, chain


async def _chain(connection: Any, user_unit_id: UUID, auth_user_id: UUID
                 ) -> tuple[UUID | None, list[dict]]:
    rows = await connection.fetch(
        "with recursive up as (select id, parent_id, role, path, 0 depth from org_units where id=$1"
        + _CHAIN_SQL.format(columns="", joins=""),
        user_unit_id,
        str(auth_user_id),
    )
    return _chain_of(rows)


async def _member_chain(connection: Any, auth_user_id: UUID
                        ) -> tuple[dict, UUID | None, list[dict]]:
    """`_member` and `_chain` for the signed-in person in one round trip: the
    walk starts from their membership row, and every row of the chain carries
    the member's columns."""
    rows = await connection.fetch(
        """with recursive me as (
             select u.id, u.path, m.deactivated_at, coalesce(a.email,'') email
               from org_unit_members m join org_units u on u.id=m.user_unit_id
               left join auth.users a on a.id=m.auth_user_id
              where m.auth_user_id=$1
           ), up as (
             select o.id, o.parent_id, o.role, o.path, 0 depth
               from org_units o join me on o.id=me.id"""
        + _CHAIN_SQL.format(
            columns=", me.id member_id, me.path member_path, me.deactivated_at, me.email",
            joins=" cross join me"),
        auth_user_id,
        str(auth_user_id),
    )
    if not rows:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    member = {"id": rows[0]["member_id"], "path": rows[0]["member_path"],
              "deactivated_at": rows[0]["deactivated_at"], "email": rows[0]["email"]}
    return member, *_chain_of(rows)


async def _facts(connection: Any, auth_user_id: UUID, org_id: UUID | None, org_path: str,
                 chain: list[dict]) -> dict:
    """Everything `Ctx` carries that is a fact about the chain — the role
    (`broker.role_on_chain`), visibility (`_visibility`), staff, edition and
    the index's staleness (`staleness`) — as one statement's scalar columns."""
    paths = [node["path"] for node in chain]
    row = await connection.fetchrow(
        """select (select json_build_object('role', u.role, 'path', u.path)
                     from org_unit_admins a join org_units u on u.id=a.org_unit_id
                    where a.auth_user_id=$1 and u.path = any($2::text[])
                      and u.role in ('org', 'team')
                    order by length(u.path) limit 1) role,
                  (select coalesce(json_agg(b.policy), '[]'::json)
                     from org_unit_boundaries b join org_units u on u.id=b.org_unit_id
                    where u.path = any($3::text[])) policies,
                  exists(select 1 from platform_staff where auth_user_id=$1) staff,
                  exists(select 1 from org_units where role='team' and path like $4) enterprise,
                  (select coalesce(json_agg(json_build_object('ref', s.ref, 'at', s.at)
                                            order by s.at), '[]'::json)
                     from idx_stale s where s.org=$5) stale""",
        auth_user_id, [p for p in paths if p], paths, f"{org_path}.%", org_id,
    )
    # The pool decodes `json` columns; a bare connection (the tests') does not.
    role, policies, stale = (_json(row[column]) for column in ("role", "policies", "stale"))
    return {
        "role": {"level": "org-admin" if role["role"] == "org" else "team-admin",
                 "at": role["path"]} if role else {"level": "member", "at": None},
        "visibility": _visibility_of(policies),
        "staff": bool(row["staff"]),
        "edition": "enterprise" if row["enterprise"] else "personal",
        "stale": ({"since": stale[0]["at"], "refs": [one["ref"] for one in stale]}
                  if stale else None),
    }


def _teams_of(chain: list[dict]) -> str:
    return ", ".join(chain_teams(chain)) or "your teams"


def chain_teams(chain: list[dict]) -> list[str]:
    return [node["path"] for node in chain if node["kind"] == "team"]


def routing_paths(chain: list[dict]) -> list[str]:
    """The nodes `Routing.defaultFor.teams` may be keyed by, root first. The
    organization is one of them — 01 §4.2's own example keys `teams` by the org
    path and the broker reads `approvedFor` the same way (04 step 5) — and for
    a personal account (prd-v2 §12.1) it is the only one there is."""
    return [node["path"] for node in chain if node["kind"] in ("org", "team")]


async def setup_model(ctx: Ctx) -> str | None:
    """W7-D2, the `model` row of `setup_facts`: what the person's default model
    provider already is for them. `key` when a security group holds its key,
    `sign-in` when no key is held and a runtime this organization lists signs
    in to it itself, `None` when there is no default or it is neither — which
    is exactly when the Account list still has something to ask for."""
    built = await policy(ctx)
    default = routed_provider(built["routing"], "", routing_paths(ctx.chain), [])
    provider = built["modelProviders"].get(default or "")
    if provider is None:
        return None
    if not broker.needs_key(built["groups"], provider):
        return "key"
    return "sign-in" if signs_in_here(built, provider["id"]) else None


def _under(path: str, ancestor: str) -> bool:
    return path == ancestor or path.startswith(f"{ancestor}.")


async def _audit_read_as(connection: Any, at: str, actor: UUID, as_user: UUID,
                         endpoint: str) -> None:
    unit = await connection.fetchval("select id from org_units where path=$1", at)
    if unit is None:
        return
    async with connection.transaction():
        await append_event(connection, org_unit_id=unit, actor_type="user", actor_id=actor,
                           event_class="authoritative", action="console.read_as",
                           payload={"as": str(as_user), "endpoint": endpoint})


async def _scope(pool: Any, scope: str | None, chain: list[dict], role: dict, org_id: UUID,
                 org_path: str, viewer: dict) -> tuple[str, list[str], UUID, bool, str]:
    """`org` needs org-admin; `team:<path>` needs the team on the viewer's chain
    or `role.at` at or above it; `me` is the viewer (03 §4)."""
    scope = scope or "me"
    if scope == "me":
        return "me", [node["path"] for node in chain], viewer["id"], True, org_path
    if scope == "org":
        if role["level"] != "org-admin":
            raise fail("console.scope_forbidden", team="the organization")
        return "org", [org_path], org_id, True, org_path
    if scope.startswith("team:"):
        path = scope[5:]
        on_chain = path in {node["path"] for node in chain}
        administered = role["at"] is not None and _under(path, role["at"])
        unit = await pool.fetchval("select id from org_units where path=$1 and role='team'", path)
        if unit is None or not (on_chain or administered):
            raise fail("console.scope_forbidden", team=path.rsplit(".", 1)[-1] or path)
        ancestors = [node["path"] for node in chain if _under(path, node["path"])]
        return "team", sorted({*ancestors, org_path, path}), unit, administered, path
    raise fail("console.scope_forbidden", team=scope)


async def _visibility(pool: Any, paths: list[str]) -> dict:
    """PRD §16, default all true. Set at the org node (03 §4.1) and, per 04 §15,
    for a team or a person too — so the chain is read and any `false` wins."""
    rows = await pool.fetch(
        """select b.policy from org_unit_boundaries b join org_units u on u.id=b.org_unit_id
            where u.path = any($1::text[])""",
        paths,
    )
    return _visibility_of([row["policy"] for row in rows])


def _json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _visibility_of(policies: list) -> dict:
    # W5-D15 adds `store`: an organization may turn the Browse tab off, and a
    # personal account has it on because nobody is above the person to say
    # otherwise. Default true like the other two — a key nobody has written is
    # a view nobody has closed.
    out = {"boundaries": True, "logs": True, "store": True}
    for policy in policies:
        for key, value in ((policy or {}).get("visibility") or {}).items():
            if key in out and value is False:
                out[key] = False
    return out


async def staleness(connection: Any, org_id: UUID) -> dict | None:
    rows = await connection.fetch(
        "select ref, at from idx_stale where org=$1 order by at", org_id)
    if not rows:
        return None
    return {"since": rows[0]["at"].isoformat(), "refs": [row["ref"] for row in rows]}


async def setup_facts(ctx: Ctx) -> dict:
    """W7-D5: the four facts the Account screen's *Getting started* list reads.

    Each is *has this already happened*, derived and never stored, so the list
    cannot drift from the thing it describes and nothing has to be ticked off.

    * `installed` — a session has been opened from this account. The console
      cannot see a machine (D45), so the only evidence the CLI is installed is
      that it ran: one `harness_sessions` row for this person.
    * `loggedIn` — a personal access token exists, which is what `harness
      login` asks for and the only thing it leaves behind on the server.
    * `harness` — a harness exists on the chain. The seed writes none (D30h
      seeds policy files, never a harness), so any row at all is the person's.
    * `model` — W7-D2's `setup_model`: a key held for the default provider, or
      a runtime's own sign-in to it, or neither.

    One statement, not three: `/v1/console/me` is fetched on every navigation
    and `Ctx`'s reads run one at a time on a single connection.
    """
    row = await ctx.pool.fetchrow(
        """select exists(select 1 from harness_sessions
                          where owner_auth_user_id = $1) installed,
                  exists(select 1 from personal_access_tokens
                          where auth_user_id = $1) logged_in,
                  exists(select 1 from idx_harnesses
                          where org = $2 and node_path = any($3::text[])) harness""",
        ctx.viewer, ctx.org_id, [node["path"] for node in ctx.chain])
    return {"installed": row["installed"], "loggedIn": row["logged_in"],
            "model": await setup_model(ctx), "harness": row["harness"]}


# --- `definitions`, read-only (00 D8) ---------------------------------------


async def definitions(path: str, params: dict[str, Any]) -> dict:
    url = os.environ.get("DEFINITIONS_URL", "").rstrip("/")
    token = os.environ.get("HARNESS_SERVICE_TOKEN", "")
    if not url:
        raise fail("console.definitions_unavailable")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            answer = await client.get(f"{url}{path}", params=params,
                                      headers={"Authorization": f"Bearer {token}"})
        answer.raise_for_status()
        return answer.json()
    except ApiError:
        raise
    except Exception as error:
        raise fail("console.definitions_unavailable") from error


async def definitions_or_none(path: str, params: dict[str, Any]) -> dict | None:
    """For a lazily-filled cell (`lastEditor`, 03 D35): the cell degrades, the
    page does not 503."""
    try:
        return await definitions(path, params)
    except ApiError:
        return None


def parse_diff(text: str) -> list[dict]:
    """Unified text → `DiffHunk[]`. `api` parses; the console never does."""
    hunks: list[dict] = []
    for line in (text or "").splitlines():
        if line.startswith("@@"):
            hunks.append({"header": line, "lines": []})
        elif hunks and line[:1] in ("+", "-", " "):
            kind = {"+": "add", "-": "del", " ": "ctx"}[line[0]]
            hunks[-1]["lines"].append({"kind": kind, "text": line[1:]})
    return hunks


def tally(hunks: list[dict]) -> tuple[int, int]:
    added = sum(1 for hunk in hunks for line in hunk["lines"] if line["kind"] == "add")
    removed = sum(1 for hunk in hunks for line in hunk["lines"] if line["kind"] == "del")
    return added, removed


# --- the index, read directly (03 D38) --------------------------------------


async def policy(ctx: Ctx) -> dict:
    if "policy" in ctx.cache:
        return ctx.cache["policy"]
    rows = await ctx.pool.fetch(
        "select file, body from idx_policy where org=$1 and node_path=$2", ctx.org_id, ctx.org_path)
    files = {row["file"]: row["body"] for row in rows}
    built = {
        "groups": {group["name"]: group for group in files.get("groups.json", [])},
        "modelProviders": {p["id"]: p for p in files.get("model-providers.json", [])},
        "harnessProviders": {p["id"]: p for p in files.get("harness-providers.json", [])},
        "routing": files.get("routing.json") or _EMPTY_ROUTING,
        "kinds": files.get("kinds.json", []),
        # W5-D10's two lists. The indexer normalises the file, so a bare array
        # would only reach here from an index written before the split.
        **seed.always_loaded_lists(files.get("always-loaded.json")),
    }
    ctx.cache["policy"] = built
    return built


async def chain_policy(ctx: Ctx, file: str) -> list[tuple[str, dict]]:
    """Every entry of a policy file on the chain, tagged with the node that set
    it — the `setBy` a `BoundaryRow` carries (00 §4.7). Once per request."""
    if ("chain_policy", file) not in ctx.cache:
        ctx.cache[("chain_policy", file)] = await _chain_policy(ctx, file)
    return ctx.cache[("chain_policy", file)]


async def _chain_policy(ctx: Ctx, file: str) -> list[tuple[str, dict]]:
    rows = await ctx.pool.fetch(
        """select node_path, body from idx_policy
            where org=$1 and file=$2 and node_path = any($3::text[])""",
        ctx.org_id, file, [node["path"] for node in ctx.chain])
    order = {node["path"]: index for index, node in enumerate(ctx.chain)}
    out = [(row["node_path"], entry) for row in rows for entry in (row["body"] or [])]
    return sorted(out, key=lambda pair: order.get(pair[0], 99))


async def policy_commit(ctx: Ctx, node_path: str, file: str) -> dict | None:
    """Who last wrote a policy file on a node, and when (03 §4, *declared*:
    `by` is the commit author, read from the ref lazily). One call per (node,
    file) per request — the same cache `lastEditor` uses, so a page that shows
    twenty grants asks `definitions` once."""
    ref = (await nodes(ctx)).get(node_path, {}).get("ref")
    if not ref:
        return None
    commits = await commits_on(ctx, ref, f"policy/{file}", 1)
    if not commits:
        return None
    first = commits[0]
    return {"by": first["author"]["name"], "at": first["at"], "commit": first["commit"]}


async def grants_on_chain(ctx: Ctx) -> list[dict]:
    return [grant for _, grant in await chain_policy(ctx, "grants.json")]


async def nodes(ctx: Ctx) -> dict[str, dict]:
    if "nodes" not in ctx.cache:
        ctx.cache["nodes"] = {
            row["path"]: dict(row)
            for row in await ctx.pool.fetch(
                "select path, kind, ref, parent_path from idx_nodes where org=$1", ctx.org_id)}
    return ctx.cache["nodes"]


def node_label(path: str) -> str:
    """The last dotted segment of a **path**. Anything else goes through
    `label_for`, which knows what kind of id it is holding."""
    return path.rsplit(".", 1)[-1]


async def harness_names(ctx: Ctx) -> dict[str, str]:
    """id → name, once per request: a harness id is a uuid and must never be
    shown as one (`node_label_only_on_paths`)."""
    if "harness_names" not in ctx.cache:
        ctx.cache["harness_names"] = {
            str(row["id"]): row["name"] for row in await ctx.pool.fetch(
                "select id, name from idx_harnesses where org=$1", ctx.org_id)}
    return ctx.cache["harness_names"]


async def refs(ctx: Ctx) -> dict[str, str]:
    if "refs" not in ctx.cache:
        ctx.cache["refs"] = {
            row["ref"]: row["commit"]
            for row in await ctx.pool.fetch(
                "select ref, commit from idx_refs where org=$1", ctx.org_id)}
    return ctx.cache["refs"]


async def effective(ctx: Ctx, user_id: UUID) -> list[dict]:
    """The person's winning copy of every asset (02 §8.6). Once per request:
    a harness page asks for the card, the file rows and the loaded set."""
    if ("effective", user_id) not in ctx.cache:
        ctx.cache[("effective", user_id)] = await _effective(ctx, user_id)
    return ctx.cache[("effective", user_id)]


async def _effective(ctx: Ctx, user_id: UUID) -> list[dict]:
    rows = await ctx.pool.fetch(
        """select e.asset_id, a.kind, a.name, a.tree, a.sidecar, e.from_path, e.shadows_path
             from idx_effective e
             join idx_assets a on a.org=e.org and a.node_path=e.from_path and a.id=e.asset_id
            where e.org=$1 and e.user_id=$2 order by a.kind, a.name""",
        ctx.org_id, user_id)
    return [dict(row) for row in rows]


def owner_from_path(from_path: str, org_path: str, teams: list[str], viewer_path: str) -> str:
    """PRD §17.1's owner word, from the branch the winning copy came from."""
    if from_path == org_path:
        return "org"
    if from_path in teams:
        return "team"
    if from_path == viewer_path:
        return "you"
    return f"member:{node_label(from_path)}"


def differs(mine: dict[str, str], theirs: dict[str, str], composed: str | None) -> dict[str, str]:
    """03 D32, the classification the client renders in Differences. Computed
    here too so `differs_classification` has one implementation to test."""
    out: dict[str, str] = {}
    for asset_id in set(mine) | set(theirs):
        if asset_id not in theirs:
            out[asset_id] = "yours-only"
        elif asset_id not in mine:
            out[asset_id] = "theirs-only"
        elif mine[asset_id] == theirs[asset_id]:
            continue
        elif composed is not None and composed not in (mine[asset_id], theirs[asset_id]):
            out[asset_id] = "conflict"
        else:
            out[asset_id] = "both"
    return out


# --- harnesses (03 §4.2) ----------------------------------------------------


async def harness_rows(ctx: Ctx, harness_id: UUID | None = None) -> list[dict]:
    query = ("select id, name, def, node_path from idx_harnesses "
             "where org=$1 and node_path = any($2::text[])")
    args: list[Any] = [ctx.org_id, ctx.scope_paths]
    if harness_id is not None:
        query, args = (
            "select id, name, def, node_path from idx_harnesses where org=$1 and id=$2",
            [ctx.org_id, harness_id])
    return [dict(row) for row in await ctx.pool.fetch(query, *args)]


def level_of_node(ctx: Ctx, path: str) -> tuple[str, str]:
    """A node's level and its own URL segment (00 D2), from this viewer's seat:
    the organization, the viewer's own branch, or a team. The segment is what
    `/console/<segment>/…` takes, so a link to another level is built the same
    way `href` builds one to this one."""
    if path == ctx.org_path:
        return "org", "org"
    if path == ctx.chain[-1]["path"]:
        return "me", "me"
    return "team", path


async def cards(ctx: Ctx) -> list[dict]:
    held = {str(row["asset_id"]) for row in await effective(ctx, ctx.viewer)}
    own = set(ctx.teams)
    # One card per harness: the same id on several nodes of the chain (engine
    # 01 D3, extended to harnesses) is one harness, and the nearest copy is the
    # viewer's version of it — the same rule `harness_of` applies.
    depth = {node["path"]: at for at, node in enumerate(ctx.chain)}
    nearest: dict[str, dict] = {}
    # W5-D9: the copies that are *not* nearest are not dropped — they are the
    # card's *also at* links, so a person reading their own version can see
    # that the organization holds one too, and open it. Chain order (root
    # first), so the list reads organization → team → you.
    others: dict[str, list[str]] = {}
    opened = await last_opened(ctx)
    built = await policy(ctx)
    for row in await harness_rows(ctx):
        key = str(row["id"])
        nearer = depth.get(row["node_path"], -1) > depth.get(nearest[key]["node_path"], -1) \
            if key in nearest else True
        if nearer:
            nearest[key] = row
        others.setdefault(key, []).append(row["node_path"])
    out = []
    for row in nearest.values():
        definition, key = row["def"] or {}, str(row["id"])
        also = []
        for path in sorted(set(others[key]) - {row["node_path"]},
                           key=lambda at: depth.get(at, -1)):
            level, segment = level_of_node(ctx, path)
            also.append({"level": level, "label": node_label(path),
                         "href": f"/console/{segment}/harnesses/{key}"})
        out.append({
            "id": key, "name": row["name"],
            "description": definition.get("description", ""), "icon": definition.get("icon"),
            "team": {"path": row["node_path"], "name": node_label(row["node_path"])},
            # P11/C18: the count is what the viewer would actually load, so a
            # name that resolves to nothing is not counted.
            "fileCount": len([a for a in definition.get("assets", []) if a in held]),
            "alsoAt": also,
            # W5-D13: one launch button per runtime that could actually start
            # this harness for this viewer. The web does not derive it — the
            # rule is approval, scope and wire format, and all three live here.
            "runners": runners_for(built, ctx, key),
            # W5-D14: the folder the viewer's own last session with this
            # harness ran in, and the machine it ran on. `None` for everyone
            # else and under `?as` — nobody reads another person's paths.
            "lastWorkspace": opened.get(key, {}).get("workspace"),
            "lastHost": opened.get(key, {}).get("hostname"),
        })
    return sorted(out, key=lambda card: (card["team"]["path"] not in own, card["name"]))


async def last_opened(ctx: Ctx) -> dict[str, dict]:
    """W5-D14. Per harness, the viewer's own most recent session that recorded
    a workspace. Their own only, and nothing at all under `?as`: a team admin
    reading a member's console sees the member's harnesses, never the paths on
    the member's machine."""
    if ctx.as_user is not None:
        return {}
    rows = await ctx.pool.fetch(
        """select distinct on (harness_id) harness_id, workspace, hostname
             from harness_sessions
            where owner_auth_user_id = $1 and harness_id is not null and workspace is not null
            order by harness_id, created_at desc""", ctx.viewer)
    return {str(row["harness_id"]): {"workspace": row["workspace"],
                                     "hostname": row["hostname"]} for row in rows}


async def harness_of(ctx: Ctx, harness_id: UUID, version: str = "mine") -> dict:
    """The nearest copy on the chain wins (engine 01 D3, extended to harnesses):
    a person's version of a harness sits on their own node with the same id.
    `team` reads the nearest copy that is not the person's own."""
    depth = {node["path"]: at for at, node in enumerate(ctx.chain)}
    rows = [row for row in await harness_rows(ctx, harness_id) if row["node_path"] in depth]
    if version == "team":
        rows = [row for row in rows if row["node_path"] != ctx.chain[-1]["path"]]
    if not rows:
        # PRD harnesses invariant 6: off the chain, it does not exist for you.
        raise fail("console.harness_not_found")
    return max(rows, key=lambda row: depth[row["node_path"]])


def covering_grants(grants: list[dict], chain: list[dict], harness_id: str | None) -> list[dict]:
    return [grant for grant in grants if broker.covers(grant.get("scope") or {}, chain, harness_id)]


def routed_provider(routing: dict, harness_id: str, teams: list[str],
                    provider_ids: list[str]) -> str | None:
    """Precedence harness → provider → team (engine 00 D8). The team half is
    nearest-first up the chain, and the organization node is a key like any
    other — `approvedFor` is read that way by the broker (04 step 5) and 01
    §4.2's own example keys `teams` by the org path."""
    defaults = routing.get("defaultFor") or {}
    if harness_id in (defaults.get("harnesses") or {}):
        return defaults["harnesses"][harness_id]
    for provider in provider_ids:
        if provider in (defaults.get("providers") or {}):
            return defaults["providers"][provider]
    for team in reversed(teams):
        if team in (defaults.get("teams") or {}):
            return defaults["teams"][team]
    return None


def speaks_routed(built: dict, provider: dict, chain: list[dict], harness_id: str) -> bool:
    """`canRunOn` (prd-v2 §9.3), the wire-format half: this runtime speaks a
    format the model provider routed to *this* harness exposes. The routing is
    read per runtime (`[provider["id"]]`), because a default may be pinned to a
    runtime as well as to a harness or a team (engine 00 D8).

    One function, two readers: the Providers table's `canRun` column and the
    card's launch buttons (W5-D13). The card adds the approval half; the table
    shows approval in its own column and so does not.

    W6-D6: a model provider that *needs a key* routes nowhere. The broker
    refuses such a session with `broker.provider_needs_key`, so a runtime whose
    only routed model has no key is not a runtime that can start anything, and
    neither `canRun` nor a launch button may say otherwise.

    W7-D2: unless *this* runtime signs in to that provider itself. Then the
    broker allows the session (04 §5.3 step 5), it runs on the person's own
    sign-in and the launch button belongs here — the exclusion follows the
    broker exactly, as it did in Wave 6."""
    model_id = routed_provider(built["routing"], harness_id, routing_paths(chain),
                               [provider["id"]])
    model = built["modelProviders"].get(model_id or "")
    if model is None:
        return False
    if broker.needs_key(built["groups"], model) and not broker.signs_in(provider, model_id or ""):
        return False
    return bool(set(provider.get("speaks") or []) & set(model.get("endpoints", {})))


def runtime_name(provider: dict) -> str:
    """W6-D3: the word a person reads for a runtime. `HarnessProvider.name` is
    on the contract now, and the id is the fallback for a row written before
    it was (the preset and the seed carry both)."""
    return provider.get("name") or provider["id"]


def runners_for(built: dict, ctx: Ctx, harness_id: str) -> list[dict]:
    """W5-D13: the runtimes that can start *this* harness for *this* viewer —
    one launch button each. Approved (or beta) for the level, scoped to reach
    this chain and this harness, and speaking a format the routed model
    exposes. The same two clauses `harness_view` and the Providers table apply,
    so a button appears exactly where a session would be minted."""
    return [{"id": provider["id"], "name": runtime_name(provider)}
            for provider in built["harnessProviders"].values()
            if provider.get("approval") != "not-approved"
            and broker.covers(provider.get("scope") or {}, ctx.chain, harness_id)
            and speaks_routed(built, provider, ctx.chain, harness_id)]


def upwards(path: str) -> list[str]:
    """`a.b.c` → `[a, a.b, a.b.c]`, root first: the paths a routing or policy
    key may sit on for this node."""
    parts = path.split(".")
    return [".".join(parts[: index + 1]) for index in range(len(parts))]


def dry_check(assets: list[dict], model_provider: dict | None, providers: list[dict],
              grants: list[dict], groups: dict) -> bool:
    """03 P-1's three clauses, run over the index when no session proves the
    present. All three must hold (`preflight_dry_check_three_clauses`)."""
    exposes = set((model_provider or {}).get("endpoints", {}).keys())
    shared: set[str] = set()
    for provider in providers:
        if provider.get("approval") == "not-approved":
            continue
        shared |= set(provider.get("speaks") or []) & exposes
    if not shared:
        return False                                                      # (a)
    for asset in assets:
        wire = (asset.get("sidecar") or {}).get("format")
        if wire and wire not in shared:
            return False                                                  # (b)
    covered = {entry["alias"] for grant in grants
               for entry in (groups.get(grant.get("group") or "") or {}).get("entries", [])}
    for asset in assets:
        for need in (asset.get("sidecar") or {}).get("needs", []) or []:
            if need.get("kind") == "credential" and need.get("alias") not in covered:
                return False                                              # (c)
    return True


async def preflight_fact(ctx: Ctx, harness_id: UUID, dry: bool) -> dict:
    """03 D31: the last session's report counts only when the refs it ran on
    are the refs the index holds now. Commits equality, never a time window."""
    indexed = await refs(ctx)
    rows = await ctx.pool.fetch(
        """select preflight, commits, created_at from harness_sessions
            where owner_auth_user_id=$1 and harness_id=$2
            order by created_at desc limit 20""",
        ctx.viewer, harness_id)
    chain_refs = [node["ref"] for node in ctx.chain]
    for row in rows:
        commits = row["commits"] or {}
        if not commits or any(commits.get(ref) != indexed.get(ref) for ref in chain_refs):
            continue
        report = row["preflight"]
        if report is None:
            continue
        return fact("passing" if report.get("passing") else "failing", "derived",
                    at=(report.get("at") or row["created_at"].isoformat()))
    return fact("passing" if dry else "failing", "derived", at=now())


async def file_rows(ctx: Ctx, definition: dict, version: str, *, whole_library: bool = False,
                    with_editor: bool = True) -> list[dict]:
    """03 §4.2.1. `mine` is the viewer's effective set; `team` is the same
    composition without the viewer's own ref; `member:<id>` is that member's.

    Two rules that decide what the Differences and Files views can say:

    * **The team's copy of an override is the one it shadows.** Dropping the
      person's winning row would leave the team side empty and every override
      would read *yours only* (03 D32), so `idx_effective.shadows_path` is
      followed to the copy the person's ref is standing on.
    * **An assigned id nothing answers is a row** (engine C18, 04 §6): owner
      `null`, no editor, and the sentence in `note`. Hiding it would make a
      harness that names a missing file look complete.
    """
    user_id = ctx.viewer
    if version.startswith("member:"):
        user_id = UUID(version.split(":", 1)[1])
    assets = await effective(ctx, user_id)
    if version == "team":
        assets = await without_own_ref(ctx, assets, user_id)
    wanted = list(dict.fromkeys(definition.get("assets") or []))
    if not whole_library:
        assets = [asset for asset in assets if str(asset["asset_id"]) in set(wanted)]
    node_refs = {path: node["ref"] for path, node in (await nodes(ctx)).items()}
    commits = await refs(ctx)
    out = []
    for asset in assets:
        path = f"assets/{asset['kind']}/{asset['name']}"
        row = {
            "assetId": str(asset["asset_id"]), "kind": asset["kind"], "name": asset["name"],
            "path": path, "tree": asset["tree"],
            "owner": owner_from_path(asset["from_path"], ctx.org_path, ctx.teams,
                                     ctx.chain[-1]["path"]),
            # W5-D10: `required` · `recommended` · `on-request`. A harness file
            # row is `on-request` unless the organization says otherwise, which
            # is what `harness_view` fills in — `file_rows` is called for the
            # whole library too, where nothing is required by the harness.
            "lastEditor": None, "differs": None, "note": None, "loads": "on-request",
        }
        if with_editor:
            ref = node_refs.get(asset["from_path"])
            row["lastEditor"] = await last_editor(ctx, ref, commits.get(ref or "", ""), path)
        out.append(row)
    if not whole_library:
        held = {row["assetId"] for row in out}
        out += [await unanswered_row(ctx, asset_id)
                for asset_id in wanted if asset_id not in held]
    return out


async def without_own_ref(ctx: Ctx, assets: list[dict], user_id: UUID) -> list[dict]:
    """The composition without the person's own ref (engine 03 `view: "team"`).
    Where their copy won, the team's is the one it shadows."""
    own = ctx.chain[-1]["path"] if user_id == ctx.viewer else await _path_of(ctx, user_id)
    overrides = {str(asset["asset_id"]): asset["shadows_path"]
                 for asset in assets if asset["from_path"] == own}
    shadowed = {}
    if overrides:
        shadowed = {(str(row["id"]), row["node_path"]): dict(row) for row in await ctx.pool.fetch(
            """select id, node_path, kind, name, tree, sidecar from idx_assets
                where org=$1 and id = any($2::uuid[]) and node_path = any($3::text[])""",
            ctx.org_id, [UUID(key) for key in overrides],
            [path for path in overrides.values() if path])}
    out = []
    for asset in assets:
        if asset["from_path"] != own:
            out.append(asset)
            continue
        under = shadowed.get((str(asset["asset_id"]), overrides[str(asset["asset_id"])] or ""))
        if under is not None:
            out.append({**asset, **under, "asset_id": asset["asset_id"],
                        "from_path": under["node_path"], "shadows_path": None})
    return out


async def _path_of(ctx: Ctx, auth_user_id: UUID) -> str:
    return await ctx.pool.fetchval(
        """select u.path from org_unit_members m join org_units u on u.id=m.user_unit_id
            where m.auth_user_id=$1""", auth_user_id) or ""


async def unanswered_row(ctx: Ctx, asset_id: str) -> dict:
    """C18. The id is known to the harness and to nothing on this chain; the
    name is whatever the organization calls it elsewhere, if anything."""
    try:
        row = await ctx.pool.fetchrow(
            "select kind, name from idx_assets where org=$1 and id=$2 limit 1",
            ctx.org_id, UUID(asset_id))
    except ValueError:
        row = None      # a definition naming something that is not an id at all

    kind, name = (row["kind"], row["name"]) if row else ("", asset_id)
    return {"assetId": asset_id, "kind": kind, "name": name,
            "path": f"assets/{kind}/{name}" if row else "", "tree": "",
            "owner": None, "lastEditor": None, "differs": None, "note": UNANSWERED}


async def last_editor(ctx: Ctx, ref: str | None, commit: str, path: str) -> dict | None:
    """03 D35: the last commit touching the asset's directory, fetched lazily
    and cached for this request only. Recorded in a commit, so *declared*."""
    if not ref or not commit:
        return None
    key = ("log", ref, path)
    if key not in ctx.cache:
        answer = await definitions_or_none(
            "/internal/log", {"org": str(ctx.org_id), "ref": ref, "path": path, "limit": 1})
        commits = (answer or {}).get("commits") or []
        ctx.cache[key] = (
            {"name": commits[0]["author"]["name"], "at": commits[0]["at"],
             "note": commits[0]["message"]} if commits else None)
    return ctx.cache[key]


# --- the edge walk (03 §5) --------------------------------------------------

_WALK = """
with recursive walk(kind, id, via, depth, path) as (
  select $2::text, $3::text, null::text, 0, array[$2::text || ':' || $3::text]
  union all
  select case when $4 then e.to_kind else e.from_kind end,
         case when $4 then e.to_id   else e.from_id   end,
         e.rel, w.depth + 1,
         w.path || (case when $4 then e.to_kind || ':' || e.to_id
                         else e.from_kind || ':' || e.from_id end)
    from walk w join idx_edges e
      on e.org = $1
     and (($4 and e.from_kind = w.kind and e.from_id = w.id)
       or (not $4 and e.to_kind = w.kind and e.to_id = w.id))
   where w.depth < 2
     and not ((case when $4 then e.to_kind || ':' || e.to_id
                    else e.from_kind || ':' || e.from_id end) = any(w.path))
)
select distinct kind, id, via, depth from walk where depth > 0 order by depth, kind, id
"""


async def walk(ctx: Ctx, kind: str, ident: str, out: bool) -> list[dict]:
    rows = await ctx.pool.fetch(_WALK, ctx.org_id, kind, ident, out)
    names = await harness_names(ctx)
    seen, found = set(), []
    for row in rows:
        if (row["kind"], row["id"]) in seen:
            continue
        seen.add((row["kind"], row["id"]))
        found.append({"kind": row["kind"], "id": row["id"],
                      "label": label_for(row["kind"], row["id"], names),
                      "via": VIA.get(row["via"], row["via"])})
    if not out:
        # 03 §5, the secret row: *rotate this and these stop*. A grant reached
        # by walking in is terminal there, because `scoped_to` and `only_for`
        # leave it — so the teams and harnesses it reaches are read out of it.
        for node in [item for item in found if item["kind"] == "grant"]:
            for edge in await ctx.pool.fetch(
                    """select distinct to_kind, to_id, rel from idx_edges
                        where org=$1 and from_kind='grant' and from_id=$2
                          and rel in ('scoped_to','only_for')""", ctx.org_id, node["id"]):
                if (edge["to_kind"], edge["to_id"]) in seen:
                    continue
                seen.add((edge["to_kind"], edge["to_id"]))
                found.append({"kind": edge["to_kind"], "id": edge["to_id"],
                              "label": label_for(edge["to_kind"], edge["to_id"], names),
                              "via": VIA[edge["rel"]]})
    return found


async def edge_walk(ctx: Ctx, kind: str, ident: str) -> dict:
    """Both directions from the same rows, read opposite ways, never merged."""
    return {
        "from": {"kind": kind, "id": ident,
                 "label": label_for(kind, ident, await harness_names(ctx))},
        "restsOn": await walk(ctx, kind, ident, True),
        "restedOnBy": await walk(ctx, kind, ident, False),
    }


async def edges_to(ctx: Ctx, rel: str, to_kind: str, to_id: str) -> list[str]:
    return (await _edges(ctx, rel, "to_kind", to_kind, "to_id", "from_id")).get(to_id, [])


async def edges_from(ctx: Ctx, rel: str, from_kind: str, from_id: str) -> list[str]:
    return (await _edges(ctx, rel, "from_kind", from_kind, "from_id", "to_id")).get(from_id, [])


async def _edges(ctx: Ctx, rel: str, kind_column: str, kind: str, key: str, value: str
                 ) -> dict[str, list[str]]:
    """Every edge of one relation and kind, read once per request: a listing
    asks for each of its rows' edges, and the org's edge table is small, so
    the whole slice is one round trip and the rows are answered from it."""
    cache_key = ("edges", rel, kind_column, kind)
    if cache_key not in ctx.cache:
        rows = await ctx.pool.fetch(
            f"""select distinct {key} k, {value} v from idx_edges
                 where org=$1 and rel=$2 and {kind_column}=$3 order by 1, 2""",
            ctx.org_id, rel, kind)
        found: dict[str, list[str]] = {}
        for row in rows:
            found.setdefault(row["k"], []).append(row["v"])
        ctx.cache[cache_key] = found
    return ctx.cache[cache_key]


def href(ctx: Ctx, *parts: Any) -> str:
    """00 D2. The scope segment is the viewer's, not a hardcoded `org`."""
    return "/".join(["/console", ctx.segment, *[str(part) for part in parts]])


def team_related(paths: list[str]) -> dict:
    if "all" in paths:
        return related("teams", [], True)          # P4: *All teams*, never a list
    # A team's own scope segment is its path (D2), so this is its landing page.
    return related("teams", [{"id": path, "label": node_label(path),
                              "href": f"/console/{path}"} for path in sorted(set(paths))])


def link_related(ctx: Ctx, unit: str, ids: list[str], *parts: Any,
                 labels: dict[str, str] | None = None) -> dict:
    return related(unit, [{"id": i, "label": (labels or {}).get(i) or node_label(i),
                           "href": href(ctx, *parts, i)} for i in sorted(set(ids))])


def label_for(kind: str, ident: str, names: dict[str, str]) -> str:
    """The word a relationship cell shows. `node_label` is the last dotted
    segment, which is right for a path and wrong for everything else: an
    origin would render as its top-level domain and a harness as its uuid.
    Dispatch on the kind the edge carries (02 §8.2), never on the shape."""
    if kind in ("node", "team", "user", "org"):
        return node_label(ident)
    if kind == "harness":
        return names.get(ident) or ident
    if kind in ("origin", "upstream"):
        return urlsplit(ident).hostname or ident
    if kind == "secret":
        return ident.split(":", 1)[-1]
    return ident


# --- logs and endpoints (03 §4.7, §6) ---------------------------------------


async def log_rows(ctx: Ctx, category: str, cursor: str | None, limit: int) -> dict:
    after = int(decode_cursor(cursor)[1]) if cursor else None
    wanted = {action for action in _actions_in(category)}
    items, last = [], None
    # `descendant_events` is the existing downward walk: a unit's audit view is
    # the subtree it governs. A category filter can empty a page, so read on.
    while len(items) < limit:
        batch = await descendant_events(ctx.pool, ctx.scope_unit, after=after, limit=limit * 4)
        if not batch:
            break
        for row in batch:
            after = last = row["id"]
            if row["action"] not in wanted:
                continue
            if ctx.own_records_only and not _about(row, ctx.viewer):
                continue
            items.append(await log_row(ctx, row))
            if len(items) >= limit:
                break
        if len(batch) < limit * 4:
            break
    return {"items": items, "next": encode_cursor("id", last) if last and len(items) >= limit
            else None}


def _actions_in(category: str) -> list[str]:
    return [action for action, (cat, _) in SENTENCES.items() if cat == category]


def _about(row: dict, viewer: UUID) -> bool:
    payload = row.get("payload") or {}
    return row.get("actor_id") == viewer or str(viewer) in {
        str(payload.get(key)) for key in ("as", "person", "owner", "user_id")}


async def log_row(ctx: Ctx, row: dict) -> dict:
    payload = dict(row.get("payload") or {})
    actor = await _name_of(ctx, row.get("actor_id"))
    team = await _team_of(ctx, row["org_unit_id"])
    fields = {**payload, "actor": actor, "team": (team or {}).get("name")}
    if row["action"] == "session.refuse":
        codes = payload.get("blockers") or []
        fields["blocker"] = broker.BLOCKERS[codes[0]][1] if codes and codes[0] in broker.BLOCKERS \
            else None
    if row["action"] == "session.close":
        fields["n"] = len(payload.get("endpoints_tally") or [])
        fields["refused"] = sum(item.get("refused", 0)
                                for item in payload.get("endpoints_tally") or [])
    if row["action"] in ("session.open", "session.refuse", "session.revoke"):
        fields["model"] = " · ".join(payload.get("model") or []) or None
        fields["harness"] = await _harness_name(ctx, payload.get("harness"))
    if row["action"] == "harness.add_assets":
        # W5-D15. The payload carries the id, as every harness payload does;
        # the sentence says the name, which is this one place's job.
        fields["harness"] = await _harness_name(ctx, payload.get("harness"))
    if row["action"] in ("definitions.push", "definitions.commit"):
        fields["n"] = len(payload.get("paths") or [])
    return {
        "id": str(row["id"]), "at": row["created_at"].isoformat(),
        "actor": {"id": str(row.get("actor_id") or ""), "name": actor},
        "team": team, "action": row["action"],
        "sentence": sentence(row["action"], fields),
        "ref": ({"ref": payload["ref"], "commit": payload.get("new") or payload.get("commit", "")}
                if payload.get("ref") else None),
        "diff": None,
    }


async def _name_of(ctx: Ctx, actor_id: Any) -> str | None:
    if actor_id is None:
        return None
    key = ("name", str(actor_id))
    if key not in ctx.cache:
        ctx.cache[key] = await ctx.pool.fetchval(
            "select email from auth.users where id=$1", actor_id)
    return ctx.cache[key]


async def _harness_defs(ctx: Ctx) -> list:
    if "harness_defs" not in ctx.cache:
        ctx.cache["harness_defs"] = await ctx.pool.fetch(
            "select id, def from idx_harnesses where org=$1", ctx.org_id)
    return ctx.cache["harness_defs"]


async def _harness_name(ctx: Ctx, harness_id: Any) -> str | None:
    if not harness_id:
        return None
    key = ("harness", str(harness_id))
    if key not in ctx.cache:
        ctx.cache[key] = await ctx.pool.fetchval(
            "select name from idx_harnesses where org=$1 and id=$2",
            ctx.org_id, UUID(str(harness_id)))
    return ctx.cache[key]


async def _team_of(ctx: Ctx, unit_id: Any) -> dict | None:
    key = ("team", str(unit_id))
    if key not in ctx.cache:
        row = await ctx.pool.fetchrow(
            """with recursive up as (
                 select id, parent_id, role, path, name from org_units where id=$1
                 union all select p.id, p.parent_id, p.role, p.path, p.name
                   from org_units p join up on up.parent_id=p.id)
               select path, name from up where role='team' order by length(path) desc limit 1""",
            unit_id)
        ctx.cache[key] = {"path": row["path"], "name": row["name"]} if row else None
    return ctx.cache[key]


async def log_diff(ctx: Ctx, log_id: int) -> list[dict]:
    row = await ctx.pool.fetchrow(
        "select action, payload from audit_log where id=$1", log_id)
    payload = (row or {}).get("payload") or {}
    if row is None or row["action"] not in GIT_BACKED or not payload.get("ref"):
        return []                       # not a git-backed row: nothing to show
    answer = await definitions("/internal/diff", {
        "org": str(ctx.org_id), "a": payload.get("old") or "", "b": payload.get("new") or "",
        **({"path": payload["path"]} if payload.get("path") else {})})
    return parse_diff(answer.get("diff", ""))


async def _reach_files(ctx: Ctx, paths: list[str]) -> dict[str, dict]:
    """Each node's own `policy/reach.json`, for the paths asked about. Absent
    is not `off` written down (C32), so a node with no file has no key."""
    return {row["node_path"]: row["body"] for row in await ctx.pool.fetch(
        """select node_path, body from idx_policy
            where org=$1 and file='reach.json' and node_path = any($2::text[])""",
        ctx.org_id, paths)}


def _walk_reach(said: dict[str, dict], paths: list[str]) -> dict:
    """D131's walk, root first: the first path starts it and each one below
    may only narrow. One implementation, shared by the Reach section and the
    harness page (`console_index.start_reach`/`narrow_reach` are the rule)."""
    reach = console_index.start_reach(said.get(paths[0]) if paths else None,
                                      paths[0] if paths else "")
    for path in paths[1:]:
        body = said.get(path)
        if body is not None:
            reach = console_index.narrow_reach(reach, body, path)
    return reach


async def chain_reach(ctx: Ctx, harness_id: UUID | None = None,
                      definition: dict | None = None) -> dict:
    """D131 for the viewer's own chain, narrowed by a harness's own step —
    what a session of theirs running this harness may reach (W5-D7).

    The walk is read off `idx_policy` here rather than through
    `console_index.effective_for`, which would fetch every effective asset a
    second time and turn a stale index into a 500 on a page that reports
    staleness instead (`Ctx.stale`). The rule is the same two functions.
    """
    paths = [node["path"] for node in ctx.chain if node["kind"] != "user"]
    reach = _walk_reach(await _reach_files(ctx, paths), paths)
    said = (definition or {}).get("reach")
    if said and harness_id is not None:
        # A harness may take one more step down, never up (01 §6 step 10a).
        reach = console_index.narrow_reach(reach, said, f"harness:{harness_id}")
    return reach


async def reach_view(ctx: Ctx) -> dict:
    """D131 for one scope: what this node's sessions can reach, every step of
    the walk that made it, and the starter list the screen offers.

    `chain` is the walk root first, one entry per node above and including the
    scope, each with what that node's own file says — so the screen can show
    *inherited* above *yours* without a second request. A node with no file has
    no entry: absent is not `off` written down (C32)."""
    at = ctx.org_path if ctx.scope in ("me", "org") else ctx.scope_path
    paths = [".".join(at.split(".")[:n + 1]) for n in range(len(at.split(".")))]
    said = await _reach_files(ctx, paths)
    effective = console_index.start_reach(said.get(paths[0]), paths[0])
    chain = []
    for path in paths:
        body = said.get(path)
        if body is None:
            continue
        if path != paths[0]:
            effective = console_index.narrow_reach(effective, body, path)
        chain.append({"node": path, "name": node_label(path),
                      "mode": body.get("mode", "off"), "hosts": list(body.get("hosts") or []),
                      "when": ((await policy_commit(ctx, path, "reach.json")) or {}).get("at")})
    return {
        "scope": at, "effective": effective, "chain": chain,
        # W5-D5's one-click adds. One copy, in the presets, read by the seed too.
        "suggested": seed.presets("reach-suggested.json"),
        "canEdit": ctx.admin_here and (ctx.scope != "me" or ctx.edition == "personal"),
    }


def _outcome(status: str) -> str:
    """Three outcomes, not two: a request that went with a capability taken out
    of it is neither reached nor refused (D134)."""
    if status == "stripped":
        return "stripped"
    return "reached" if status.isdigit() else "refused"


async def endpoint_rows(ctx: Ctx, since: datetime) -> list[dict]:
    root = ctx.unit_id if ctx.own_records_only else ctx.scope_unit
    units = [row["id"] for row in await ctx.pool.fetch(
        """with recursive tree as (select id from org_units where id=$1
             union all select o.id from org_units o join tree t on o.parent_id=t.id)
           select id from tree""", root)]
    # W5-D4: one row per (host, outcome, reason) — the same host refused for
    # two reasons is two rows, because they are two things to do something
    # about. `setBy` rides along: it is the node the Allow action writes to.
    rows = await ctx.pool.fetch(
        """select (payload->>'host') host, (payload->>'port')::int port,
                  payload->>'alias' alias,
                  case when (payload->>'status') = 'stripped' then 'stripped'
                       when (payload->>'status') ~ '^[0-9]+$' then 'reached'
                       else 'refused' end outcome,
                  coalesce(payload->>'reason', '') reason,
                  coalesce(payload->>'setBy', '') set_by,
                  count(*) as count,
                  min(created_at) first_at, max(created_at) last_at,
                  count(distinct payload->>'session') sessions,
                  array_remove(array_agg(distinct payload->>'session'), null) session_ids
             from audit_log
            where action = 'session.endpoint' and org_unit_id = any($1::uuid[])
              and created_at >= $2
            group by 1, 2, 3, 4, 5, 6 order by last_at desc""", units, since)
    every = sorted({str(item) for row in rows for item in row["session_ids"]})
    harness_of = {str(item["session"]): item for item in await ctx.pool.fetch(
        """select s.id session, h.name, h.id from harness_sessions s
             join idx_harnesses h on h.org=$2 and h.id=s.harness_id
            where s.id::text = any($1::text[])""", every, ctx.org_id)}
    opened = await _opened_by(ctx, every)
    # The Allow action needs the file of every node that refused something, and
    # the organization's for the rows that name no node (below). One read, the
    # same helper the Reach section walks with.
    reach = await _reach_files(ctx, sorted(
        {row["set_by"] for row in rows
         if row["set_by"] and not row["set_by"].startswith("harness:")} | {ctx.org_path}))
    out = []
    for row in rows:
        ids = [str(item) for item in row["session_ids"]]
        names = {str(item["id"]): item for item in map(harness_of.get, ids) if item}.values()
        out.append({
            "host": row["host"], "port": row["port"], "alias": row["alias"],
            "outcome": row["outcome"],
            "reason": row["reason"] or None,
            "setBy": row["set_by"] or None,
            "count": row["count"],
            # Kept for the session record's shape: `refused` is this row's own
            # count when the row is a refusal, and 0 when it is not.
            "refused": row["count"] if row["outcome"] == "refused" else 0,
            "firstAt": row["first_at"].isoformat(), "lastAt": row["last_at"].isoformat(),
            "sessions": row["sessions"],
            # PRD §19, the join between the two screens: the sessions this
            # traffic came from, and the log row that explains it.
            "sessionIds": sorted(ids),
            "logId": next((log for session, log in opened.items() if session in ids), None),
            "harnesses": related("harnesses", [
                {"id": str(item["id"]), "label": item["name"],
                 "href": href(ctx, "harnesses", item["id"])} for item in names]),
            **_allow_action(ctx, row["host"], row["outcome"], row["set_by"], reach,
                            row["reason"]),
        })
    return out


def _private_address(host: str) -> bool:
    """`127.0.0.1`, `10.…`, `::1` and friends — an IP literal that never
    names anything outside the machine or its network."""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return host == "localhost"
    return address.is_private or address.is_loopback or address.is_link_local


def _already_reachable(host: str, file: dict) -> bool:
    """The same question `POST /v1/reach/hosts` answers with
    `409 reach.host_present`: writing this host to this node would change
    nothing. Exact names, like the write — `*.suffix` entries are matched by
    the fence, not by this list, and a host the suffix already covers is not
    a host the fence refused."""
    hosts = file.get("hosts") or []
    if file.get("mode") == "allow":
        return host in hosts
    return host not in hosts  # mode `on`: a deny-list it is not on


def _allow_action(ctx: Ctx, host: str, outcome: str, set_by: str,
                  reach: dict[str, dict], reason: str | None = None) -> dict:
    """W5-D4. A refused row offers **Allow** to a viewer who administers the
    node in `setBy`; otherwise it says who does, in one sentence.

    Four ways it is not offered: the row is not a refusal; the viewer does not
    administer that node; reach there is `off`, where there is no list to put a
    host on and the remedy is the Reach section itself; or the host is on the
    list already, where the button would only earn a `409` — the refusal is a
    session that started before the list changed, and the next one will not
    make it.

    A row from before `setBy` existed names no node. The organization is the
    only node that could have refused it then, so an org admin is offered the
    organization's list and anyone else is told whose decision it is."""
    if outcome != "refused":
        return {"allow": None}
    # A refusal reach did not make — a wrong proxy secret, a port that is not
    # 443 — is not cured by a list, and a private address is never a host the
    # harness reaches: allowing either would be a lie the next session exposes.
    if reason in ("bad-secret", "port") or _private_address(host):
        return {"allow": {"can": False,
                          "why": "Not a reach decision: a list cannot allow this."}}
    if set_by.startswith("harness:"):
        return {"allow": {"can": False,
                          "why": "This harness sets its own reach; change it on the harness page."}}
    node = set_by or ctx.org_path
    administers = (ctx.role["level"] == "org-admin" if not set_by
                   else ctx.role["at"] is not None and _under(set_by, ctx.role["at"]))
    if not administers:
        return {"allow": {"can": False,
                          "why": f"{node_label(node)}'s admins decide what it can reach."}}
    # Absent is not `off` written down (C32), but it is the same thing to this
    # action: there is no list at that node to put a host on.
    file = reach.get(node) or {}
    if file.get("mode", "off") == "off":
        return {"allow": {"can": False,
                          "why": f"Reach is off for {node_label(node)}; "
                                 "turn it on under Boundaries → Reach."}}
    if _already_reachable(host, file):
        return {"allow": {"can": False,
                          "why": "Already allowed; the next session can reach it."}}
    return {"allow": {"can": True, "scope": "org" if node == ctx.org_path
                      else f"team:{node}", "why": None}}


async def _opened_by(ctx: Ctx, session_ids: list[str]) -> dict[str, str]:
    """Each session's `session.open` row — *this is why that endpoint is new*
    (PRD §19) — keyed by session id, in the order the sessions opened, so the
    first key a row holds is its earliest session's. The join is on owner and
    time because `session.open`'s payload does not carry the session id
    (engine 04 §8); when it does, this becomes an equality on one column.
    """
    if not session_ids:
        return {}
    rows = await ctx.pool.fetch(
        """select distinct on (s.id) s.id session, a.id, s.created_at
             from harness_sessions s
             join audit_log a on a.action = 'session.open'
              and a.actor_id = s.owner_auth_user_id and a.created_at >= s.created_at
            where s.id::text = any($1::text[])
            order by s.id, a.created_at""", session_ids)
    return {str(row["session"]): str(row["id"])
            for row in sorted(rows, key=lambda row: row["created_at"])}


# --- sessions (03 §4.4) -----------------------------------------------------


async def session_scope(ctx: Ctx) -> tuple[str, list[Any]]:
    # 03 §4.4: `team:<path>` is the subtree's sessions *and the viewer is admin
    # over it*; a member of the team reads their own and no one else's.
    if ctx.own_records_only:
        return "s.owner_auth_user_id = $1", [ctx.viewer]
    if ctx.scope == "org":
        return "u.path = $1 or u.path like $1 || '.%'", [ctx.org_path]
    return "u.path = $1 or u.path like $1 || '.%'", [ctx.scope_path]


async def session_rows(ctx: Ctx, person: UUID | None, harness: UUID | None,
                       status: str | None) -> list[dict]:
    where, args = await session_scope(ctx)
    if person is not None:
        args.append(person)
        where += f" and s.owner_auth_user_id = ${len(args)}"
    if harness is not None:
        args.append(harness)
        where += f" and s.harness_id = ${len(args)}"
    if status is not None:
        args.append(status)
        where += f" and s.status = ${len(args)}"
    rows = await ctx.pool.fetch(
        f"""select s.*, coalesce(a.email,'') email, u.path unit_path
              from harness_sessions s join org_units u on u.id = s.org_unit_id
              left join auth.users a on a.id = s.owner_auth_user_id
             where {where} order by s.last_active_at desc limit 200""", *args)
    return [await session_row(ctx, dict(row)) for row in rows]


async def session_row(ctx: Ctx, row: dict) -> dict:
    tally_rows = row.get("endpoints_tally")
    if tally_rows is None and row["status"] == "active":
        live = await ctx.pool.fetchrow(
            """select count(*) filter (where payload->>'status' ~ '^[0-9]+$') reached,
                      count(*) filter (where payload->>'status' !~ '^[0-9]+$'
                                         and payload->>'status' <> 'stripped') refused
                 from audit_log where action='session.endpoint'
                  and payload->>'session' = $1 and created_at >= $2""",
            str(row["id"]), row["created_at"])
        reached, refused = (live["reached"], live["refused"]) if live else (0, 0)
    else:
        reached = sum(item.get("count", 0) for item in tally_rows or [])
        refused = sum(item.get("refused", 0) for item in tally_rows or [])
    return {
        "id": str(row["id"]),
        "person": {"id": str(row["owner_auth_user_id"]), "name": row.get("email") or ""},
        "harness": ({"id": str(row["harness_id"]),
                     "name": await _harness_name(ctx, row["harness_id"]) or ""}
                    if row["harness_id"] else None),
        "provider": {"id": row["provider_id"], "version": row["provider_version"]},
        "model": {"provider": row["model_provider"] or "", "model": row["model"] or ""},
        "status": row["status"], "startedAt": row["created_at"].isoformat(),
        "lastActiveAt": row["last_active_at"].isoformat(),
        # 0036 added the column the broker's `close` sets; a closed session
        # that says it closed at nothing is a session the log cannot explain.
        "closedAt": row["closed_at"].isoformat() if row.get("closed_at") else None,
        "endpoints": {"reached": reached, "refused": refused},
    }


async def session_view(ctx: Ctx, session_id: UUID) -> dict:
    where, args = await session_scope(ctx)
    row = await ctx.pool.fetchrow(
        f"""select s.*, coalesce(a.email,'') email from harness_sessions s
              join org_units u on u.id = s.org_unit_id
              left join auth.users a on a.id = s.owner_auth_user_id
             where ({where}) and s.id = ${len(args) + 1}""", *args, session_id)
    if row is None:
        raise fail("session.not_visible")
    base = await session_row(ctx, dict(row))
    report = row["preflight"] or None
    plan = (report or {}).get("plan") or {}
    return base | {
        "commits": row["commits"] or {},
        "slots": session_slots(row["slots"] or {}, report),
        "preflight": report, "endpointsTally": row["endpoints_tally"] or [],
        "revokedReason": row["revoked_reason"],
        # 00 §4.5's `SpawnPlan`, as posted with the report (03 §5.10): what the
        # fence was told to allow and to deny. Derived from nothing here — it
        # is the plan the session actually ran under, or nothing at all.
        "hosts": plan.get("hosts"), "deny": plan.get("deny") or [],
        # W5-D14: the folder and the machine the session ran on, to the owner
        # and nobody else — never to an admin, never under `?as`. The same
        # rule the card's `lastWorkspace` follows.
        **({"workspace": row["workspace"], "host": row["hostname"]}
           if ctx.as_user is None and row["owner_auth_user_id"] == ctx.actor
           else {"workspace": None, "host": None}),
        # W6-D9: what a boundary refused during this session.
        "refusals": await session_refusals(ctx, session_id),
    }


async def session_refusals(ctx: Ctx, session_id: UUID) -> list[dict]:
    """W6-D9 — the tool calls a boundary refused in this session.

    A command boundary is `intercepted`: the runtime refuses the call as it is
    made, which means the only record of it is the spool line the runtime
    wrote. So the session page shows those lines and no others. Not every
    `tool.call` — a session makes hundreds and none of the rest is a *record*
    of anything a person has to look up; the refusals are, because a refusal
    you cannot look up is indistinguishable from a bug (P17).

    `refused` is `boundary:<node path>/<id>`, the composed id, so the row can
    name the boundary that did it and the person can go and read its reason on
    Boundaries → Commands."""
    rows = await ctx.pool.fetch(
        """select payload->>'tool' tool, payload->>'plain_sentence' said,
                  payload->>'refused' refused, created_at
             from audit_log
            where action = 'tool.call' and payload ? 'refused'
              and payload->>'session' = $1 order by created_at""",
        str(session_id))
    return [{"tool": row["tool"] or "", "said": row["said"] or "",
             "boundary": (row["refused"] or "").removeprefix("boundary:"),
             "at": row["created_at"].isoformat()} for row in rows]


def session_slots(record: dict, report: dict | None) -> list[dict]:
    """03 §4.4, verbatim — and each slot keeps its **real** need.

    The record is keyed by alias because the broker mints credentials and
    nothing else (engine 04 §6), so rebuilding `need` from the key labels a
    login or an asset slot as a credential. The posted report carries the whole
    `Slot[]` (00 §4.6), needs included, so it decides the need and contributes
    the slots the broker never saw. The record still decides provenance: it is
    what the broker wrote, and B6 keeps it value-free.
    """
    reported = {_need_key(slot.get("need") or {}): slot
                for slot in ((report or {}).get("slots") or []) if isinstance(slot, dict)}
    out = []
    for alias, slot in record.items():
        named = reported.pop(alias, None)
        need = (named or {}).get("need") or {"kind": "credential", "alias": alias}
        out.append({"need": need, **slot})
    # Login and asset slots (03 §5.5): satisfied or not, they are the Account
    # screen's *logins present*, so the positive ones must survive too.
    out += [slot for slot in reported.values() if slot.get("need")]
    return out


def _need_key(need: dict) -> str:
    return str(need.get("alias") or need.get("tool") or need.get("id") or "")


# --- people and teams (03 §4.8) ---------------------------------------------


async def person_rows(ctx: Ctx) -> list[dict]:
    root = ctx.scope_path
    if ctx.scope == "me":
        root = ctx.chain[-1]["path"]
    rows = await ctx.pool.fetch(
        """select m.auth_user_id, m.deactivated_at, u.path, coalesce(a.email,'') email,
                  (select max(last_active_at) from harness_sessions s
                    where s.owner_auth_user_id = m.auth_user_id) last_active
             from org_unit_members m join org_units u on u.id = m.user_unit_id
             left join auth.users a on a.id = m.auth_user_id
            where u.path = $1 or u.path like $1 || '.%' order by u.path""", root)
    admins = {(row["auth_user_id"], row["path"]) for row in await ctx.pool.fetch(
        """select d.auth_user_id, u.path from org_unit_admins d
             join org_units u on u.id = d.org_unit_id""")}
    out = []
    for row in rows:
        teams = [part for part in _ancestors(row["path"]) if part != ctx.org_path]
        level = "org-admin" if (row["auth_user_id"], ctx.org_path) in admins else (
            "team-admin" if any((row["auth_user_id"], team) in admins for team in teams)
            else "member")
        out.append({
            "id": str(row["auth_user_id"]), "name": person_name(row["email"]),
            "email": row["email"],
            "team": row["path"].rsplit(".", 1)[0], "unit": row["path"],
            "teams": team_related(teams), "role": tag("role", level),
            "lastActive": row["last_active"].isoformat() if row["last_active"] else None,
            "state": "deactivated" if row["deactivated_at"] else "active",
            "invite": None,
        })
    invited = await ctx.pool.fetch(
        """select i.id, i.email, u.path from org_invites i
             join org_units u on u.id = i.team_unit_id
            where i.accepted_at is null and (u.path = $1 or u.path like $1 || '.%')""", root)
    # An invite names a team and no person yet, so there is no unit to remove
    # from or hide — as with `id`, the empty string is *not yet*. What the row
    # does have is the invite, which is what withdrawing it names.
    out += [{"id": "", "invite": str(row["id"]),
             "name": person_name(row["email"]), "email": row["email"],
             "team": row["path"], "unit": "",
             "teams": team_related([row["path"]]), "role": tag("role", "member"),
             "lastActive": None, "state": "invited"} for row in invited]
    return sorted(out, key=lambda person: person["name"])


def person_name(email: str) -> str:
    """Records hold an email and no name (there is no name column to read), so
    the name is the address\'s local part — *jo*, never *jo@acme.co* twice in
    one row. An address with no local part falls back to the address."""
    return (email or "").split("@")[0] or email


def _ancestors(path: str) -> list[str]:
    parts = path.split(".")
    return [".".join(parts[: index + 1]) for index in range(len(parts) - 1)]


async def person_detail(ctx: Ctx, person_id: UUID) -> dict:
    rows = [row for row in await person_rows(ctx) if row["id"] == str(person_id)]
    if not rows:
        raise fail("console.not_found", what="person")
    member = await _member(ctx.pool, person_id)
    grants = await _grants_for(ctx, member["path"])
    sessions = await ctx.pool.fetchval(
        "select count(*) from harness_sessions where owner_auth_user_id=$1", person_id)
    admins = await ctx.pool.fetch(
        """select coalesce(a.email,'') email, u.path from org_unit_admins d
             join org_units u on u.id = d.org_unit_id
             left join auth.users a on a.id = d.auth_user_id
            where $1 = u.path or $1 like u.path || '.%'""", member["path"])
    return rows[0] | {
        "sessions": sessions,
        # The switch on this screen sets *this person's* visibility (04 §15),
        # so the row carries theirs and not the viewer's.
        "visibility": await _visibility(ctx.pool, [*_ancestors(member["path"]), member["path"]]),
        "groups": link_related(ctx, "groups", [g["group"] for g in grants if g.get("group")],
                               "groups"),
        # The honesty line's data (PRD §18): who can open this person's branch.
        "readableBy": related("people", [{"id": row["email"], "label": row["email"],
                                          "href": href(ctx, "people")} for row in admins]),
    }


async def _grants_for(ctx: Ctx, user_path: str) -> list[dict]:
    chain = [{"kind": "team", "path": path} for path in _ancestors(user_path)]
    rows = await ctx.pool.fetch(
        """select body from idx_policy where org=$1 and file='grants.json'""", ctx.org_id)
    return [grant for row in rows for grant in (row["body"] or [])
            if broker.covers(grant.get("scope") or {}, chain, None)]


async def removal_preview(ctx: Ctx, person_id: UUID) -> dict:
    person = await person_detail(ctx, person_id)
    member = await _member(ctx.pool, person_id)
    grants = await _grants_for(ctx, member["path"])
    groups = (await policy(ctx))["groups"]
    # PRD §12: membership is one leaf, so every covering grant is lost.
    loses = [{"group": grant["group"], "via": grant["id"]}
             for grant in grants if grant.get("group")]
    rotate = [{"ref": entry["secret"]["ref"], "group": grant["group"]}
              for grant in grants if grant.get("group")
              for entry in (groups.get(grant["group"]) or {}).get("entries", [])
              if entry["secret"]["vault"] == BUNDLED]
    return {"person": person, "loses": loses, "sharedKeysToRotate": rotate}


async def team_rows(ctx: Ctx) -> list[dict]:
    rows = await ctx.pool.fetch(
        """select path, parent_path from idx_nodes
            where org=$1 and kind='team' order by path""", ctx.org_id)
    # The index is keyed by path; the write routes (`/v1/org-units/{id}/…`,
    # 00 §4.11) are keyed by the record's id, so a row carries both.
    ids = {row["path"]: str(row["id"]) for row in await ctx.pool.fetch(
        "select id, path from org_units where role='team'")}
    counts = {row["path"]: row["people"] for row in await ctx.pool.fetch(
        """select u.path, count(m.auth_user_id) people from org_units u
             left join org_units c on c.parent_id = u.id
             left join org_unit_members m on m.user_unit_id = c.id
            where u.role='team' group by u.path""")}
    admins: dict[str, list[str]] = {}
    for row in await ctx.pool.fetch(
            """select u.path, coalesce(a.email,'') email from org_unit_admins d
                 join org_units u on u.id = d.org_unit_id
                 left join auth.users a on a.id = d.auth_user_id"""):
        admins.setdefault(row["path"], []).append(row["email"])
    out = []
    for row in rows:
        children = [item["path"] for item in rows if item["parent_path"] == row["path"]]
        out.append({
            "id": ids.get(row["path"]), "path": row["path"], "name": node_label(row["path"]),
            "parent": row["parent_path"], "children": team_related(children),
            "people": counts.get(row["path"], 0),
            "groups": link_related(ctx, "groups",
                                   await edges_to(ctx, "scoped_to", "team", row["path"]),
                                   "groups"),
            "admins": related("people", [{"id": email, "label": email,
                                          "href": href(ctx, "people")}
                                         for email in admins.get(row["path"], [])]),
        })
    return out


# --- vaults (03 §4.6) — the only observed reads on the console --------------


async def vault_rows(ctx: Ctx) -> list[dict]:
    groups = (await policy(ctx))["groups"]
    by_vault: dict[str, list[tuple[str, str]]] = {}
    for name, group in groups.items():
        for entry in group.get("entries", []):
            by_vault.setdefault(entry["secret"]["vault"], []).append((name, entry["secret"]["ref"]))
    ids = sorted({BUNDLED, *registry, *by_vault})
    # The bundled vault's probe is a read on the request's one connection,
    # which takes a query at a time; the others are network calls and run
    # together, after it.
    probed = {BUNDLED: await _probe(ctx, BUNDLED, by_vault.get(BUNDLED, []))}
    others = [vault for vault in ids if vault != BUNDLED]
    probed.update(zip(others, await asyncio.gather(*[
        _probe(ctx, vault, by_vault.get(vault, [])) for vault in others]), strict=True))
    probes = [probed[vault] for vault in ids]
    rows = [{
        "id": vault, "handsUs": "stored" if vault == BUNDLED else "minted",
        "issues": "stored" if vault == BUNDLED else "temporary",
        "contents": "listable" if vault == BUNDLED else "not listable",
        "reachable": reachable,
        "groups": link_related(ctx, "groups", [name for name, _ in by_vault.get(vault, [])],
                               "groups"),
    } for vault, reachable in zip(ids, probes, strict=True)]
    # PRD §6.2: the person's machine is a row, so no row has a blank provider.
    # We cannot observe it from here, so its `reachable` has no value at all
    # rather than a `false` we did not check.
    rows.append({"id": "your machine", "handsUs": "stored", "issues": "stored",
                 "contents": "not listable", "reachable": fact(None, "observed", now()),
                 "groups": related("groups", [])})
    return rows


async def _probe(ctx: Ctx, vault: str, entries: list[tuple[str, str]]) -> dict:
    """03 D34: three seconds, in parallel, and a timeout is `false` — never an
    error page. Observed, and stored nowhere (P2)."""
    async def run() -> bool:
        resolver = resolver_for(vault, ctx.pool)
        if not entries:
            return True
        return bool((await resolver.probe(entries[0][1]))["ready"])
    try:
        return fact(await asyncio.wait_for(run(), 3), "observed", now())
    except Exception:
        return fact(False, "observed", now())


async def secret_rows(ctx: Ctx, vault: str) -> list[dict]:
    groups = (await policy(ctx))["groups"]
    named: dict[str, list[str]] = {}
    for name, group in groups.items():
        for entry in group.get("entries", []):
            if entry["secret"]["vault"] == vault:
                named.setdefault(entry["secret"]["ref"], []).append(name)
    listed = set()
    if vault == BUNDLED:
        listed = {row["ref"] for row in await ctx.pool.fetch(
            """select k.ref from api_keys k join org_units u on u.id = k.org_unit_id
                where u.path = $1 or u.path like $1 || '.%'""", ctx.org_path)}
    out = []
    for ref in sorted(set(named) | listed):
        ready = await _probe(ctx, vault, [("", ref)]) if ref in listed or named.get(ref) \
            else fact(False, "observed", now())
        last = await ctx.pool.fetchval(
            """select max(created_at) from audit_log
                where action='session.open' and payload::text like '%' || $1 || '%'""", ref)
        out.append({
            "ref": ref, "group": vault,
            "groups": link_related(ctx, "groups", named.get(ref, []), "groups"),
            "ready": ready, "lastUsed": last.isoformat() if last else None,
            # PRD §6.7's two findings, from the join and nothing else.
            "uncovered": ref in listed and not named.get(ref),
            "dangling": bool(named.get(ref)) and vault == BUNDLED and ref not in listed,
        })
    return out


# --- providers, routing, groups, grants, boundaries, assets -----------------


async def group_rows(ctx: Ctx) -> list[dict]:
    built = await policy(ctx)
    grants = await _scope_grants(ctx)
    names = await harness_names(ctx)
    out = []
    for name, group in built["groups"].items():
        covering = [grant for grant in grants if grant.get("group") == name]
        if ctx.scope != "org" and not covering:
            continue
        out.append({
            "name": name,
            # Verbatim (03 §4.5): the console renders the vault, the ref and
            # the attachment, and hands the list back whole on a `PATCH`.
            "entries": group.get("entries", []),
            "sources": group.get("sources", "vault"),
            # 03 §4.5 asks for a `tier` ScaleTag; no scale in the registry (05
            # §4) has tiers, and K4 makes an unregistered value a bug, so the
            # field is present and empty until the PRD names the scale.
            "tier": None,
            "teams": team_related([team for grant in covering
                                   for team in _scope_teams(grant)]),
            "harnesses": link_related(ctx, "harnesses",
                                      [h for grant in covering
                                       for h in (grant.get("scope") or {}).get("harnesses") or []],
                                      "harnesses", labels=names),
            "narrowed": link_related(ctx, "groups",
                                     [grant["narrowedFrom"]["grant"] for grant in covering
                                      if grant.get("narrowedFrom")], "groups"),
        })
    return sorted(out, key=lambda row: row["name"])


def _scope_teams(grant: dict) -> list[str]:
    teams = (grant.get("scope") or {}).get("teams")
    return ["all"] if teams == "all" else list(teams or [])


async def _scope_grants(ctx: Ctx) -> list[dict]:
    rows = await ctx.pool.fetch(
        "select node_path, body from idx_policy where org=$1 and file='grants.json'", ctx.org_id)
    grants = [{**grant, "_node": row["node_path"]}
              for row in rows for grant in (row["body"] or [])]
    if ctx.scope == "org":
        return grants
    chain = [{"kind": "team", "path": path}
             for path in (ctx.teams if ctx.scope == "me" else
                          [p for p in ctx.scope_paths if p != ctx.org_path])]
    return [grant for grant in grants if broker.covers(grant.get("scope") or {}, chain, None)]


async def grant_rows(ctx: Ctx) -> list[dict]:
    built, names = await policy(ctx), await harness_names(ctx)
    out = []
    for grant in await _scope_grants(ctx):
        written = await policy_commit(ctx, grant.get("_node") or ctx.org_path, "grants.json")
        group = built["groups"].get(grant.get("group") or "") or {}
        entries = group.get("entries", [])
        out.append({
            "id": grant["id"], "group": grant.get("group"),
            "gives": "reach" if grant.get("reach") else "entries",
            "entryCount": len(entries), "sources": group.get("sources"),
            "teams": team_related(_scope_teams(grant)),
            "harnesses": link_related(ctx, "harnesses",
                                      (grant.get("scope") or {}).get("harnesses") or [],
                                      "harnesses", labels=names),
            "narrowedFrom": (grant.get("narrowedFrom") or {}).get("grant"),
            # The file declares its author; the commit says when, and says who
            # when the file does not (03 §4.5: both are *declared*).
            "by": grant.get("by") or (written or {}).get("by"),
            "at": (written or {}).get("at"),
        })
    return sorted(out, key=lambda row: (row["group"] or "", row["id"]))


async def boundary_rows(ctx: Ctx) -> list[dict]:
    known, commits = await nodes(ctx), await refs(ctx)
    out = []
    for path, boundary in await chain_policy(ctx, "boundaries.json"):
        node = known.get(path) or {}
        written = await policy_commit(ctx, path, "boundaries.json")
        out.append(boundary | {
            # PRD §16 asks for the source of each line: the node, by name, and
            # the moment it was written — both of which the ref can answer.
            "setBy": {"kind": node.get("kind", "org"), "path": path,
                      "name": node_label(path), "ref": node.get("ref", ""),
                      "commit": (written or {}).get("commit")
                      or commits.get(node.get("ref", ""), "")},
            "when": (written or {}).get("at")})
    # PRD §15: org-wide rows first, then the rest, and never repeated per harness.
    return sorted(out, key=lambda row: (row["setBy"]["path"] != ctx.org_path,
                                        row.get("value", "")))


async def suggested_commands(ctx: Ctx) -> dict:
    """W6-D10 — the starter set of command boundaries, offered as one-click
    adds under *Set here* on Boundaries → Commands.

    Never seeded (`managed: suggested`, engine 01 §4.2): a default that denies
    something is a decision, and the organization makes it. `present` is the
    one fact the preset file cannot hold — whether this level, or anything
    above it, already has that pattern — so a suggestion is never offered
    twice, the way Reach's already are (`suggestions` in `lib/views/reach.ts`).
    """
    held = {row.get("value") for row in await boundary_rows(ctx) if row.get("kind") == "command"}
    return {
        "suggested": [entry | {"present": entry["value"] in held}
                      for entry in seed.presets("command-boundaries.json")],
        "canEdit": ctx.admin_here and ctx.scope != "me",
    }


async def harness_provider_rows(ctx: Ctx) -> list[dict]:
    built = await policy(ctx)
    out = []
    for provider in built["harnessProviders"].values():
        can_run = [str(row["id"]) for row in await _harness_defs(ctx)
                   if speaks_routed(built, provider, ctx.chain, str(row["id"]))]
        out.append(provider | {
            "teams": team_related(_scope_teams(provider)),
            "canRun": link_related(ctx, "harnesses", can_run, "harnesses",
                                   labels=await harness_names(ctx)),
        })
    return out


async def model_provider_rows(ctx: Ctx) -> list[dict]:
    built = await policy(ctx)
    routing = built["routing"]
    providers = list(built["modelProviders"].values())
    status = await asyncio.gather(*[_status(built, provider) for provider in providers])
    out = []
    for provider, state in zip(providers, status, strict=True):
        alias = (provider.get("credential") or {}).get("alias")
        out.append(provider | {
            "status": state,
            "credential": alias,
            "groups": link_related(ctx, "groups",
                                   await edges_to(ctx, "entry", "alias", alias or ""), "groups"),
            "defaultFor": {key: [subject for subject, value
                                 in (routing.get("defaultFor") or {}).get(key, {}).items()
                                 if value == provider["id"]]
                           for key in ("teams", "harnesses", "providers")},
            "approvedFor": {key: [subject for subject, value
                                  in (routing.get("approvedFor") or {}).get(key, {}).items()
                                  if provider["id"] in (value or [])]
                            for key in ("teams", "harnesses", "providers")},
        })
    return out


async def _status(built: dict, provider: dict) -> str:
    """W6-D6's three values, and W7-D2's fourth. *needs-key* is read off the
    composed policy: no alias, or an alias no group entry in a connected vault
    holds. Only a held key is probed — three seconds, observed, stored nowhere
    (P2, 03 D34) — and a provider that does not answer is *unreachable*, not
    keyless: the two are different problems with different people to go to.

    W7-D2: a keyless provider a runtime this organization lists signs in to
    *itself* is *sign-in*, not *needs-key* — nothing is missing, the person's
    own login runs it. A runtime that is `not-approved` cannot sign anybody in,
    so it does not make the row read that way. Still no probe: the endpoint a
    native session reaches is the provider's own, not ours."""
    if broker.needs_key(built["groups"], provider):
        return "sign-in" if signs_in_here(built, provider["id"]) else "needs-key"
    return "set-up" if await _answers(provider) else "unreachable"


def signs_in_here(built: dict, model_provider_id: str) -> bool:
    """W7-D2: some runtime this organization may actually run has its own
    sign-in for this model provider. One reader of `broker.signs_in` over the
    organization's runtimes, so Status and the viewer's `setup.model` cannot
    disagree about what *your sign-in* means."""
    return any(
        runtime.get("approval") != "not-approved" and broker.signs_in(runtime, model_provider_id)
        for runtime in built["harnessProviders"].values()
    )


async def _answers(provider: dict) -> bool:
    urls = list((provider.get("endpoints") or {}).values())

    async def run() -> bool:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.head(urls[0])
        return True
    try:
        return await asyncio.wait_for(run(), 3) if urls else False
    except Exception:
        return False


async def routing_matrix(ctx: Ctx) -> dict:
    built = await policy(ctx)
    routing = built["routing"]
    teams = [row["path"] for row in await ctx.pool.fetch(
        "select path from idx_nodes where org=$1 and kind='team' order by path", ctx.org_id)]
    # 03 §4.6: one row per team, keyed by its path, resolved as that team
    # would resolve it — a default set at the organization is that team's
    # default until something nearer says otherwise.
    resolved = {team: fact(routed_provider(routing, "", upwards(team), []), "derived", now())
                for team in teams}
    return {"defaultFor": routing.get("defaultFor") or {},
            "approvedFor": routing.get("approvedFor") or {}, "resolved": resolved,
            "subjects": await _routing_subjects(ctx, built, teams)}


async def _routing_subjects(ctx: Ctx, built: dict, teams: list[str]) -> dict:
    """W6-D5: what *Set default…* and *Approve for…* may pick, with the word a
    person reads for each — a harness id is a uuid and a runtime has a name on
    the contract now, so neither is ever drawn as its id
    (`node_label_only_on_paths`). The organization is a subject too: a key set
    under the org path is everyone's default until a team says otherwise
    (engine 00 D30i)."""
    names = await harness_names(ctx)
    return {
        "teams": [{"id": ctx.org_path, "label": node_label(ctx.org_path)}]
        + [{"id": team, "label": node_label(team)} for team in teams],
        "harnesses": [{"id": harness, "label": label} for harness, label in sorted(
            names.items(), key=lambda pair: pair[1])],
        "providers": [{"id": provider["id"], "label": runtime_name(provider)}
                      for provider in built["harnessProviders"].values()],
    }


def scope_node(ctx: Ctx) -> str:
    """The one node a scope's own copies sit on (W5-D9). Not `ctx.scope_path`:
    at `me` that is the organization (the scope reads the whole chain), and a
    person's own copies are on their user node — the last node of the chain,
    the same one `harness_of` calls theirs."""
    if ctx.scope == "me":
        return ctx.chain[-1]["path"]
    return ctx.scope_path if ctx.scope == "team" else ctx.org_path


def scope_nodes(ctx: Ctx) -> list[str]:
    """The nodes whose own copies a scope shows — one, except at *You* on a
    personal account.

    There the organization **is** the person (07 §1 rule 3): the seed writes
    the authoring skill and the brief on the org branch, and a personal
    account has no org scope to go and look at them on, so *Nothing on your
    own branch yet* was the screen hiding the only assets the person had. Both
    nodes, root first, and every row says which one it came from.
    """
    node = scope_node(ctx)
    if ctx.scope == "me" and ctx.edition == "personal" and node != ctx.org_path:
        return [ctx.org_path, node]
    return [node]


async def asset_rows(ctx: Ctx) -> list[dict]:
    """W5-D9: one screen at every level, showing that level's own copies — at
    `me` the person's, at a team the team's, at the organization the org's.
    On a personal account *You* shows the organization's too (`scope_nodes`)."""
    built = await policy(ctx)
    # W5-D10's three states. `required` is in every session's load set and
    # cannot be deleted; `recommended` seeds every new harness; the rest load
    # only when a harness asks for them.
    always = set(built["required"])
    suggested = set(built["recommended"])
    here = scope_nodes(ctx)
    rows = await ctx.pool.fetch(
        """select id, kind, name, tree, sidecar, node_path from idx_assets
            where org=$1 and node_path = any($2::text[])
            order by kind, name, node_path""", ctx.org_id, here)
    # *Last change* is the asset directory's own last commit on the ref of the
    # node the copy is on — the index holds no timestamp, and the branch is the
    # record (03 §4: declared, read lazily, like `lastEditor`). One call per
    # asset, but they are `definitions` over HTTP and not the request's one
    # connection, so a listing of forty asks once and waits once rather than
    # forty times.
    known = await nodes(ctx)

    async def last_change(row) -> list[dict]:
        ref = known.get(row["node_path"], {}).get("ref")
        if not ref:
            return []
        return await commits_on(ctx, ref, f"assets/{row['kind']}/{row['name']}", 1)

    logs = await asyncio.gather(*[last_change(row) for row in rows])
    out = []
    for row, commits in zip(rows, logs, strict=True):
        asset_id = str(row["id"])
        loaded = asset_id in always or row["name"] in always
        loads = "required" if loaded else "recommended" if asset_id in suggested else "on-request"
        needs = [need["alias"] for need in (row["sidecar"] or {}).get("needs", []) or []
                 if need.get("kind") == "credential"]
        groups: list[str] = []
        for alias in needs:
            groups += await edges_to(ctx, "entry", "alias", alias)
        out.append({
            "id": asset_id, "kind": row["kind"], "name": row["name"], "tree": row["tree"],
            "sidecar": row["sidecar"], "loads": tag("loads", loads),
            # Which node this copy is on, the same word `browse_rows` uses.
            # One value at every scope but *You* on a personal account, where
            # it is what tells the seeded copy from one the person has edited.
            "level": level_of_node(ctx, row["node_path"])[0],
            # PRD §15: always loaded means every harness, rendered as one word.
            "harnesses": related("harnesses", [], True) if loaded else link_related(
                ctx, "harnesses", await edges_to(ctx, "includes", "asset", asset_id),
                "harnesses", labels=await harness_names(ctx)),
            "teams": team_related(await edges_from(ctx, "placed_on", "asset", asset_id)),
            "groups": link_related(ctx, "groups", groups, "groups"),
            "at": commits[0]["at"] if commits else None,
        })
    return out


# --- the store (W5-D15) -----------------------------------------------------


def needed_environment(sidecar: Any) -> str | None:
    """W5-D15. The environment a tool's sidecar names, if it names one. One
    function, because the browse row, the add route and the console all have
    to read the same key out of the same place (engine 01 §5)."""
    for need in (sidecar or {}).get("needs") or []:
        if isinstance(need, dict) and need.get("kind") == "environment" and need.get("name"):
            return str(need["name"])
    return None


def preset_catalogue() -> list[dict]:
    """The bundled assets, read from the directory the seed reads (`seed.PRESETS`,
    the only copy). A second built-in asset is a directory there, not a line
    here — the same rule `seed.preset_assets` is written to."""
    out = []
    for directory, bodies in seed.preset_assets().items():
        sidecar = json.loads(bodies[f"{directory}/asset.json"])
        _, kind, name = directory.split("/", 2)
        out.append({"id": str(sidecar["id"]), "kind": kind, "name": name, "sidecar": sidecar})
    return sorted(out, key=lambda row: (row["kind"], row["name"]))


async def browse_rows(ctx: Ctx) -> list[dict]:
    """W5-D15. Everything the viewer can use, in one list: the winning copy of
    every asset on their chain — the organization's, each team's, their own —
    and the bundled presets the organization does not hold yet.

    Not `asset_rows`, which is one node's own copies: the store is the other
    question. The copies come from `idx_effective`, so a shadowed copy is not
    offered twice and the row names the branch the person would actually get
    (`from_path`); the presets are deduped against the same ids, so one the
    person has already added shows as theirs and not twice.
    """
    own = ctx.chain[-1]["path"]
    out: list[dict] = []
    seen: set[str] = set()
    for asset in await effective(ctx, ctx.viewer):
        asset_id = str(asset["asset_id"])
        seen.add(asset_id)
        level, segment = level_of_node(ctx, asset["from_path"])
        sidecar = asset["sidecar"] or {}
        out.append({
            "id": asset_id, "kind": asset["kind"], "name": asset["name"],
            "description": str(sidecar.get("description") or ""),
            "level": level,
            # The node's own name, for the levels that have one. *You* and
            # *preset* are words the console writes (02 rule 26), so the row
            # carries the level and no invented label for them.
            "from": "" if level == "me" else node_label(asset["from_path"]),
            "href": f"/console/{segment}/assets/{asset_id}",
            # Holding a copy is having it on your **own** branch: everything in
            # this list reaches the viewer, and the column says what is theirs.
            "held": asset["from_path"] == own,
            "preset": False,
            "needsEnvironment": needed_environment(sidecar),
        })
    for row in preset_catalogue():
        if row["id"] in seen:
            continue
        out.append({
            "id": row["id"], "kind": row["kind"], "name": row["name"],
            "description": str(row["sidecar"].get("description") or ""),
            "level": "preset", "from": "", "href": None, "held": False, "preset": True,
            "needsEnvironment": needed_environment(row["sidecar"]),
        })
    # By name, which is the key the page's cursor is taken on (`_by("name")`):
    # a list ordered one way and paged another drops rows.
    return sorted(out, key=lambda row: (row["name"], row["id"]))


# --- search (03 §4.9) -------------------------------------------------------


async def search(ctx: Ctx, query: str) -> list[dict]:
    like = f"{query}%"
    found: list[dict] = []
    for row in await ctx.pool.fetch(
            """select id, name from idx_harnesses
                where org=$1 and node_path = any($2::text[]) and name ilike $3 limit 8""",
            ctx.org_id, ctx.scope_paths, like):
        found.append({"kind": "harness", "id": str(row["id"]), "label": row["name"],
                      "href": href(ctx, "harnesses", row["id"])})
    held = {str(asset["asset_id"]): asset for asset in await effective(ctx, ctx.viewer)}
    for asset_id, asset in list(held.items())[:200]:
        if asset["name"].lower().startswith(query.lower()) and len(found) < 64:
            # W5-D15 fix: the asset page is one node's own copies (W5-D9), so
            # the hit must carry the level that **holds** the copy and not the
            # level the viewer happens to be on — at *You*, an organization
            # asset linked as `/console/me/assets/<id>` is a 404.
            _, segment = level_of_node(ctx, asset["from_path"])
            found.append({"kind": "asset", "id": asset_id, "label": asset["name"],
                          "href": f"/console/{segment}/assets/{asset_id}"})
    built = await policy(ctx)
    found += [{"kind": "group", "id": name, "label": name,
               "href": href(ctx, "groups", name)}
              for name in sorted(built["groups"]) if name.lower().startswith(query.lower())][:8]
    found += [{"kind": "boundary", "id": row["id"], "label": row.get("value", ""),
               "href": href(ctx, "boundaries")}
              for _, row in await chain_policy(ctx, "boundaries.json")
              if str(row.get("value", "")).lower().startswith(query.lower())][:8]
    for row in await ctx.pool.fetch(
            """select coalesce(a.email,'') email, m.auth_user_id from org_unit_members m
                 join org_units u on u.id = m.user_unit_id
                 left join auth.users a on a.id = m.auth_user_id
                where u.path like $1 || '.%' and a.email ilike $2 limit 8""",
            ctx.org_path if ctx.role["level"] == "org-admin" else ctx.chain[-2]["path"], like):
        found.append({"kind": "person", "id": str(row["auth_user_id"]), "label": row["email"],
                      "href": href(ctx, "people", row["auth_user_id"])})
    for row in await ctx.pool.fetch(
            """select r.id, r.title from requests r join org_units u on u.id = r.org_unit_id
                where r.state='open' and r.title ilike $2
                  and (u.path = any($1::text[])) limit 8""", ctx.scope_paths, like):
        found.append({"kind": "request", "id": str(row["id"]), "label": row["title"],
                      "href": href(ctx, "requests", row["id"])})
    return found


# --- the harness page, the file page, and requests (03 §4.2, §4.3) ----------


async def harness_view(ctx: Ctx, harness_id: UUID, version: str) -> dict:
    row = await harness_of(ctx, harness_id, version)
    definition, built = row["def"] or {}, await policy(ctx)
    grants = covering_grants(await grants_on_chain(ctx), ctx.chain, str(harness_id))
    approved = [provider for provider in built["harnessProviders"].values()
                if broker.covers(provider.get("scope") or {}, ctx.chain, str(harness_id))
                and provider.get("approval") != "not-approved"]
    model_id = routed_provider(built["routing"], str(harness_id), routing_paths(ctx.chain),
                               [provider["id"] for provider in approved])
    model = built["modelProviders"].get(model_id or "")
    # prd-v2 §5.2, W5-D10: required assets reach every session whether or not
    # the harness names them, so the page lists them too, marked — what Pi
    # shows in its [Skills] panel and the console show the same set. A
    # recommended id is only here because this harness lists it (it was copied
    # in at creation), so it is marked but never added.
    named = set(definition.get("assets") or [])
    always = [asset_id for asset_id in built["required"] if asset_id not in named]
    recommended = set(built["recommended"])
    listed = [*(definition.get("assets") or []), *always]
    files = await file_rows(ctx, {**definition, "assets": listed}, version)
    required = set(built["required"])
    for file in files:
        file["loads"] = (
            "required" if file["assetId"] in required
            else "recommended" if file["assetId"] in recommended
            else "on-request"
        )
    loaded = [asset for asset in await effective(ctx, ctx.viewer)
              if str(asset["asset_id"]) in set(definition.get("assets") or [])]
    hidden = ctx.hidden("boundaries")
    return {
        "def": definition,
        "team": {"path": row["node_path"], "name": node_label(row["node_path"])},
        "header": {
            "preflight": await preflight_fact(
                ctx, harness_id,
                dry_check(loaded, model, approved, grants, built["groups"])),
            "modelProvider": fact(model_id, "derived", now()),
            "groups": fact(sorted({grant["group"] for grant in grants if grant.get("group")}),
                           "derived", now()),
            # 03 §4.2: what the viewer would actually load, so a C18 row —
            # an id nothing answers — is listed and not counted.
            "fileCount": len([file for file in files if file["owner"] is not None]),
        },
        # W5-D7, D131: what a session of this harness may reach. It replaces
        # the header's outside-endpoints cell, which read `Grant.reach` —
        # retired by W5-D1b, so that cell had become a constant `prohibited`.
        "reach": await chain_reach(ctx, harness_id, definition),
        "versions": await versions_for(ctx, row["node_path"]),
        "files": files,
        "groups": [{"name": grant["group"], "grant": grant["id"]}
                   for grant in grants if grant.get("group")],
        "boundaries": [] if hidden else await boundary_rows(ctx),
        "hidden": hidden,
    }


async def versions_for(ctx: Ctx, team_path: str) -> list[dict]:
    """PRD §18: an admin over the team may read each member's own two."""
    options = [{"id": "mine", "label": "Mine"}, {"id": "team", "label": "The team's"}]
    if ctx.as_user is not None or ctx.role["at"] is None or not _under(team_path, ctx.role["at"]):
        return options
    for row in await ctx.pool.fetch(
            """select m.auth_user_id, coalesce(a.email,'') email from org_unit_members m
                 join org_units u on u.id = m.user_unit_id
                 left join auth.users a on a.id = m.auth_user_id
                where u.path like $1 || '.%' and m.auth_user_id <> $2 order by a.email""",
            team_path, ctx.viewer):
        options.append({"id": f"member:{row['auth_user_id']}", "label": row["email"]})
    return options


async def version_node(ctx: Ctx, version: str) -> dict:
    """The chain node a version reads from: the viewer's own, the team's (the
    node above the person — the organization when there is no team, prd-v2
    §12.1), or a named member's."""
    if version == "team":
        return ctx.chain[max(len(ctx.chain) - 2, 0)]
    if version.startswith("member:"):
        path = await _path_of(ctx, UUID(version.split(":", 1)[1]))
        node = (await nodes(ctx)).get(path)
        if node is not None:
            return {"path": path, "ref": node["ref"]}
    return ctx.chain[-1]


async def file_view(ctx: Ctx, harness_id: UUID, asset_id: str, version: str = "mine") -> dict:
    """03 §4.2.1. `content.mine` is the **selected** version's copy (`?version`
    follows the compare control, 04 §6) and `content.team` the team's."""
    row = await harness_of(ctx, harness_id)
    definition = row["def"] or {}
    mine = {item["assetId"]: item for item in await file_rows(
        ctx, definition, version, whole_library=True)}
    theirs = {item["assetId"]: item for item in await file_rows(
        ctx, definition, "team", whole_library=True, with_editor=False)}
    assigned = asset_id in set(definition.get("assets") or [])
    if asset_id not in mine and asset_id not in theirs and not assigned:
        raise fail("console.file_not_found", path=asset_id)
    # C18: an assigned id nothing answers is the page saying so, not a 404.
    here = mine.get(asset_id) or theirs.get(asset_id) or await unanswered_row(ctx, asset_id)
    known, commits = await nodes(ctx), await refs(ctx)
    sides: dict[str, str | None] = {}
    history: list[dict] = []
    left = await version_node(ctx, version)
    right = await version_node(ctx, "team")
    for branch, rows, node in (("mine", mine, left), ("team", theirs, right)):
        ref = known.get(node["path"], {}).get("ref") or node["ref"]
        commit = commits.get(ref, "")
        sides[branch] = await _blob(ctx, commit, here["path"]) \
            if rows.get(asset_id) and here["path"] else None
        if not here["path"]:
            continue
        for entry in await commits_on(ctx, ref, here["path"], 20):
            history.append({"commit": entry["commit"], "branch": branch,
                            "who": entry["author"]["name"], "at": entry["at"],
                            "message": entry["message"]})
    hunks = None
    if sides["mine"] is not None and sides["team"] is not None:
        answer = await definitions_or_none("/internal/diff", {
            "org": str(ctx.org_id),
            "a": commits.get(known.get(right["path"], {}).get("ref", ""), ""),
            "b": commits.get(known.get(left["path"], {}).get("ref", ""), ""),
            "path": here["path"]})
        hunks = parse_diff((answer or {}).get("diff", ""))
    request = await ctx.pool.fetchrow(
        """select id, state from requests where harness_id=$1
             and subject->'paths' ? $2 order by state, created_at desc limit 1""",
        harness_id, here["path"])
    return {"row": here, "content": sides, "diff": hunks,
            "history": sorted(history, key=lambda item: item["at"], reverse=True),
            "request": ({"id": str(request["id"]), "state": request["state"]}
                        if request else None)}


async def commits_on(ctx: Ctx, ref: str, path: str, limit: int) -> list[dict]:
    """`definitions:/internal/log`, cached per (ref, path) for this request."""
    key = ("commits", ref, path, limit)
    if key not in ctx.cache:
        answer = await definitions_or_none(
            "/internal/log",
            {"org": str(ctx.org_id), "ref": ref, "path": path, "limit": limit})
        ctx.cache[key] = (answer or {}).get("commits") or []
    return ctx.cache[key]


async def harness_history(ctx: Ctx, harness_id: UUID, version: str, limit: int) -> list[dict]:
    """`GET /harnesses/{id}/history?version=` — the commits behind one harness
    on the selected version's composition (04 §5's History view).

    A harness's history is not one branch's: its files come from the whole
    chain, so every ref the composition reads is logged and the rows are
    filtered to the harness's own directories — its definition and the asset
    directories it names. `branch` is the owner word (*org* · *team* · *you* ·
    *member:<id>*), which is what the version control shows.
    """
    row = await harness_of(ctx, harness_id)
    definition = row["def"] or {}
    files = await file_rows(ctx, definition, version, with_editor=False)
    wanted = [f"{file['path']}/" for file in files if file["path"]]
    wanted.append(f"harnesses/{harness_id}.json")
    known = await nodes(ctx)
    chain = ctx.chain if version != "team" else ctx.chain[:-1]
    if version.startswith("member:"):
        chain = [*ctx.chain[:-1], await version_node(ctx, version)]
    out, seen = [], set()
    for node in chain:
        path = node["path"]
        ref = known.get(path, {}).get("ref") or node.get("ref", "")
        owner = owner_from_path(path, ctx.org_path, ctx.teams, ctx.chain[-1]["path"])
        for entry in await commits_on(ctx, ref, "", limit):
            touched = [p for p in entry.get("paths") or []
                       if any(p.startswith(prefix) for prefix in wanted)]
            if not touched or entry["commit"] in seen:
                continue
            seen.add(entry["commit"])
            out.append({"commit": entry["commit"], "branch": owner,
                        "who": entry["author"]["name"], "at": entry["at"],
                        "message": entry["message"], "paths": touched})
    return sorted(out, key=lambda item: item["at"], reverse=True)


async def _blob(ctx: Ctx, commit: str, path: str) -> str | None:
    """An asset is a directory, so the file page shows its primary document:
    `SKILL.md` when there is one, else the first blob that is not the sidecar."""
    if not commit:
        return None
    listing = await definitions_or_none(f"/internal/tree/{ctx.org_id}/{commit}/{path}", {})
    entries = [entry for entry in (listing or {}).get("entries", []) if entry["kind"] == "blob"]
    if not entries:
        return None
    pick = next((entry for entry in entries if entry["name"].upper().startswith("SKILL")),
                next((entry for entry in entries if entry["name"] != "asset.json"), entries[0]))
    blob = await definitions_or_none(
        f"/internal/tree/{ctx.org_id}/{commit}/{path}/{pick['name']}", {})
    raw = (blob or {}).get("blob")
    return base64.b64decode(raw).decode("utf-8", "replace") if raw else None


async def request_views(ctx: Ctx, harness_id: UUID | None, state: str,
                        request_id: UUID | None = None) -> list[dict]:
    where, args = "r.state = $1", [state]
    if harness_id is not None:
        args.append(harness_id)
        where += f" and r.harness_id = ${len(args)}"
    if request_id is not None:
        args = [request_id]
        where = "r.id = $1"
    rows = await ctx.pool.fetch(
        f"""select r.*, u.path team_path, u.name team_name, coalesce(a.email,'') author_email
              from requests r join org_units u on u.id = r.org_unit_id
              left join auth.users a on a.id = r.author_auth_user_id
             where {where} order by r.created_at desc limit 200""", *args)
    return [await _request_view(ctx, dict(row)) for row in rows]


async def _request_view(ctx: Ctx, row: dict) -> dict:
    subject = row["subject"] or {}
    admin = ctx.role["at"] is not None and _under(row["team_path"], ctx.role["at"])
    verbs = []
    if admin and row["state"] == "open":
        verbs += ["accept", "decline"]
    if row["author_auth_user_id"] == ctx.viewer and row["state"] == "open":
        verbs.append("withdraw")
    if row["team_path"] in {node["path"] for node in ctx.chain} or admin:
        verbs.append("comment")
    files = []
    head = (await refs(ctx)).get(f"refs/heads/teams/{row['team_path']}", "")
    for path in subject.get("paths") or []:
        answer = await definitions_or_none("/internal/diff", {
            "org": str(ctx.org_id), "a": row["base_commit"] or "",
            "b": subject.get("commit") or "", "path": path})
        hunks = parse_diff((answer or {}).get("diff", ""))
        added, removed = tally(hunks)
        files.append({"assetId": path, "path": path, "added": added, "removed": removed,
                      # PRD §17.3: stale when the team ref moved under the offer.
                      "stale": bool(head and row["base_commit"] and head != row["base_commit"]),
                      "diff": hunks})
    discussion = [{"id": str(item["id"]), "who": item["email"], "at": item["at"].isoformat(),
                   "text": item["text"]} for item in await ctx.pool.fetch(
        """select c.id, c.text, c.created_at at, coalesce(a.email,'') email
             from request_comments c left join auth.users a on a.id = c.author_auth_user_id
            where c.request_id = $1 order by c.created_at""", row["id"])]
    return {
        "id": str(row["id"]),
        "harness": ({"id": str(row["harness_id"]),
                     "name": await _harness_name(ctx, row["harness_id"]) or ""}
                    if row["harness_id"] else None),
        "team": {"path": row["team_path"], "name": row["team_name"]},
        "subject": subject, "title": row["title"], "reasoning": row["reasoning"],
        "author": {"id": str(row["author_auth_user_id"]), "name": row["author_email"]},
        "at": row["created_at"].isoformat(), "state": row["state"],
        "outcome": ({"decision": row["decision"], "by": str(row["decided_by"]),
                     "at": row["decided_at"].isoformat() if row["decided_at"] else "",
                     "reason": row["reason"] or ""} if row["state"] == "closed" else None),
        "files": files, "discussion": discussion, "verbs": verbs,
    }
