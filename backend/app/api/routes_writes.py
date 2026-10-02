"""The writes the console uses (console 00 §4.11), one route per row.

Two rules hold across this file and are the reason it is one file:

* **Every "commit on a ref" write goes through `domain/writes.py`** (00 D9):
  the route decides *who may*, edits the object, and hands the whole file to
  `writes.write_file`, which commits it through `definitions:/internal/commit`
  and appends the one audit event. No route here calls `definitions` and no
  route here appends an event of its own for a ref write.
* **Every refusal names who decides** (03 §8.4, P13). The sentences are 04's
  *Verbs by role* tables, verbatim, and appear in `content/` on the web side.

A policy change revokes the sessions it affects; that happens because these
commits go through `definitions`, whose post-receive calls
`/v1/internal/policy-changed` (engine 04 §5.5). Nothing here revokes a session
by hand.

03 §8.9 names this helper `domain/commits.py commit_on_ref`; it landed as
`domain/writes.py commit` / `write_file`, which is the same one function.
"""

import base64
import json
from datetime import datetime
from types import SimpleNamespace
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api import routes_org_units
from app.api.deps import current_principal
from app.config import get_settings
from app.db import get_pool, transaction
from app.domain import broker, console, console_index, seed, writes
from app.domain.api_keys import key_ref, rotate
from app.domain.audit import append_event
from app.domain.console_models import OrgAssetRow
from app.domain.resolvers import BUNDLED
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["writes"])

Who = Annotated[Principal, Depends(current_principal)]
Json = dict[str, Any]

# 04's *Verbs by role* refusals, verbatim. Each names who decides (P13).
GROUP_IS_ORG_ADMINS = (
    "Creating a security group, or adding an entry to one, is an organisation "
    "admin's decision. Narrowing what {team} already holds covers most of what "
    "people ask for."
)
NARROW_IS_TEAM_ADMINS = "Narrowing a group into a sub-team is a team admin's decision."
REVOKE_GRANT_IS_ORG_ADMINS = (
    "Taking back a grant the organisation made is an organisation admin's decision. "
    "{team}'s admins revoke only what {team} narrowed."
)
BOUNDARY_ADD_IS_TEAM_ADMINS = "Adding a boundary is a team admin's decision."
BOUNDARY_LIFT_IS_NOBODY = (
    "Lifting an organisation boundary is nobody's decision below the organisation. "
    "Boundaries only ever tighten on the way down."
)
BOUNDARY_LIFT_IS_THEIRS = (
    "A boundary is lifted where it was set, so {team}'s admins decide this one. "
    "Boundaries only ever tighten on the way down."
)
PROVIDER_IS_ORG_ADMINS = (
    "Approving a runtime is an organisation admin's decision: it decides whose "
    "program holds a credential in memory."
)
VAULTS_ARE_ORG_ADMINS = "Key vaults are an organisation admin's screen."
LOADS_IS_ORG_ADMINS = (
    "How an organisation asset loads is an organisation admin's decision."
)
HARNESS_IS_TEAM_ADMINS = "Changing a team harness is a team admin's decision."
ASSET_IS_ADMINS = (
    "Editing or deleting an asset is an admin's decision for the node that holds "
    "it. Your own copy is always yours to change."
)
APPOINT_IS_ORG_ADMINS = (
    "Appointing a team admin is an organisation admin's decision. Anyone may ask; "
    "the request appears above."
)
INVITE_IS_TEAM_ADMINS = "Inviting is a team admin's decision."
REMOVE_IS_TEAM_ADMINS = "Removing someone from a team is a team admin's decision."
PEOPLE_IS_ORG_ADMINS = "Deactivating a person is an organisation admin's decision."
VISIBILITY_IS_ORG_ADMINS = "Turning a view off is an organisation admin's decision."
CUSTOMER_VAULT_IS_THEIRS = (
    "We never write to a customer's vault: paste and rotate belong to {vault}'s own "
    "console."
)


def _forbidden(message: str, code: str, detail: Json | None = None, remedy: str = "") -> ApiError:
    return ApiError(403, code, message, detail or {}, remedy=remedy or None)


class CommitResult(BaseModel):
    """What a ref write answers with: the commit it made, on which ref."""

    model_config = ConfigDict(extra="allow")
    commit: str
    ref: str


class RequestRow(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    title: str
    subject: Json
    subjectKind: str
    team: str
    author: str
    state: str
    decision: str | None = None
    at: str


class RequestPage(BaseModel):
    items: list[RequestRow]
    next: str | None = None


# --- grants (00 §4.11 rows 4 and 12; engine 01 §6) --------------------------


class GrantIn(BaseModel):
    # D132 retired `reach: "outside-endpoints"`: reach is `policy/reach.json`,
    # written by the four routes below, and a grant is a security group only.
    group: str | None = None
    scope: Json
    narrowedFrom: str | Json | None = None
    aliases: list[str] | None = None
    at: str | None = None  # the node whose ref carries it; derived when absent
    id: str | None = None


@router.post("/grants", status_code=status.HTTP_201_CREATED, response_model=CommitResult)
async def create_grant(body: GrantIn, request: Request, principal: Who) -> Json:
    """A grant on the org branch, or a narrowed grant on a team's (01 §4.2)."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        scope = writes.validate_scope(body.scope)
        source_id = (
            body.narrowedFrom.get("grant")
            if isinstance(body.narrowedFrom, dict)
            else body.narrowedFrom
        )
        aliases = body.aliases or (
            body.narrowedFrom.get("aliases") if isinstance(body.narrowedFrom, dict) else None
        )
        if source_id:
            node_path = body.at or _parent_of(scope, who)
            role = await who.administers(node_path)
            if role is None:
                raise _forbidden(
                    NARROW_IS_TEAM_ADMINS,
                    "grant.not_yours",
                    {"team": node_path},
                    f"Ask an admin of {writes.name_of(node_path)}.",
                )
            grant = {
                "id": body.id or f"g-{uuid4().hex[:12]}",
                "scope": scope,
                "group": body.group,
                "narrowedFrom": {"grant": source_id, "aliases": aliases or []},
                "by": principal.email or str(principal.auth_user_id),
            }
            writes.validate_narrowed_grant(
                grant,
                node_path=node_path,
                source_grants=await writes.grants_reaching(connection, who.org_id, node_path),
                groups=await writes.org_groups(connection, who.org_id, who.org_path),
            )
            action, payload = "grant.narrow", {
                "group": body.group,
                "team": writes.name_of(node_path),
                "aliases": ", ".join(aliases or []),
                "grant": grant["id"],
            }
        else:
            if not who.is_org_admin:
                raise _forbidden(
                    GROUP_IS_ORG_ADMINS.format(team=writes.name_of(who.at or who.org_path)),
                    "grant.org_admin_required",
                    remedy="Narrow a grant your team already holds instead.",
                )
            if body.group and body.group not in await writes.org_groups(
                connection, who.org_id, who.org_path
            ):
                raise writes.invalid("group", f"No security group is named {body.group!r}.")
            if not body.group:
                raise writes.invalid("group", "A grant carries a security group.")
            node_path = who.org_path
            grant = {
                "id": body.id or f"g-{uuid4().hex[:12]}",
                "scope": scope,
                "group": body.group,
                "by": principal.email or str(principal.auth_user_id),
            }
            action, payload = "grant.create", {
                "group": body.group,
                "teams": _teams_words(scope),
                "grant": grant["id"],
            }
        return await _append_grant(
            connection, who=who, node_path=node_path, grant=grant, action=action, payload=payload
        )


async def _append_grant(
    connection: Any, *, who: writes.Authority, node_path: str, grant: Json,
    action: str, payload: Json,
) -> Json:
    """One grant onto a node's `policy/grants.json`, read-then-write (01 §6).

    Two routes write a grant: this one's own `POST /v1/grants`, and
    `POST /v1/harnesses` when the first-harness modal names a group (W7-D4).
    The second reaches the same file, so it reaches it through the same six
    lines rather than a copy that would stop refusing a duplicate id.
    """
    current, head = await writes.edit_file(
        connection, who=who, node_path=node_path, path="policy/grants.json", default=[]
    )
    if any(entry.get("id") == grant["id"] for entry in current):
        raise ApiError(409, "grant.exists", f"A grant with id {grant['id']} is already here.")
    return await writes.write_file(
        connection,
        who=who,
        expected_head=head,
        node_path=node_path,
        path="policy/grants.json",
        body=[*current, grant],
        message=f"grant {grant['id']}",
        reason_kind="grant",
        action=action,
        payload=payload,
    )


def _parent_of(scope: Json, who: writes.Authority) -> str:
    """The node a narrowed grant is written on: the parent of the sub-teams it
    reaches (01 §6 step 9 clause c), or the team the viewer administers."""
    teams = scope.get("teams")
    if isinstance(teams, list) and teams and "." in teams[0]:
        return teams[0].rsplit(".", 1)[0]
    if who.at:
        return who.at
    raise writes.invalid("scope.teams", "Say which sub-teams the narrowed grant reaches.")


def _teams_words(scope: Json) -> str:
    teams = scope.get("teams")
    return "all teams" if teams == "all" else ", ".join(teams or [])


@router.delete("/grants/{grant_id}", response_model=CommitResult)
async def remove_grant(grant_id: str, request: Request, principal: Who) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        found = await writes.node_holding(
            connection, who.org_id, "grants.json", lambda e: e.get("id") == grant_id
        )
        if found is None:
            raise ApiError(404, "grant_not_found", "This grant could not be found.")
        node_path, _ = found
        role = await who.administers(node_path)
        grant = next(
            entry
            for entry in (await writes.policy_files(connection, who.org_id, node_path))[
                "grants.json"
            ]
            if entry.get("id") == grant_id
        )
        if role is None or (role == "team-admin" and not grant.get("narrowedFrom")):
            raise _forbidden(
                REVOKE_GRANT_IS_ORG_ADMINS.format(team=writes.name_of(node_path)),
                "grant.not_yours",
            )
        current, head = await writes.edit_file(
            connection, who=who, node_path=node_path, path="policy/grants.json", default=[]
        )
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=node_path,
            path="policy/grants.json",
            body=[entry for entry in current if entry.get("id") != grant_id],
            message=f"revoke grant {grant_id}",
            reason_kind="revoke",
            action="grant.remove",
            payload={
                "group": grant.get("group") or "outside endpoints",
                "teams": _teams_words(grant.get("scope") or {}),
                "grant": grant_id,
            },
        )


# --- reach (any node; narrowing only, engine 01 §6 step 10a) ----------------
#
# D131. Four routes over one file, because the Boundaries screen has four
# verbs: set the mode and the list, add a host, take one away — and the
# Endpoints tab's **Allow** is the third of those, aimed at the node the
# refused row named in `setBy`. Whether a step narrows is `definitions`' rule
# at the push (`definitions.reach_widens`); nothing is checked twice here.

REACH_IS_TEAM_ADMINS = (
    "Setting how far a session can reach is an admin's decision at the node that "
    "holds it, so {team}'s admins decide this one. Reach only ever narrows on the "
    "way down."
)
REACH_IS_OFF = (
    "Reach is off for {team}; turn it on under Boundaries → Reach before adding a host."
)


class ReachIn(BaseModel):
    mode: Literal["off", "allow", "on"]
    hosts: list[str] = Field(default_factory=list, max_length=500)


class HostIn(BaseModel):
    host: str = Field(min_length=1, max_length=253)


def _reach_node(who: writes.Authority, scope: str | None) -> str:
    """`?scope=` as the console spells it (03 §4) — `org`, `team:<path>`, `me` —
    as the node whose branch carries `policy/reach.json`.

    `me` is the organisation: 01 §4.2 holds no policy on a person's branch, and
    at `me` the only account with a Reach screen is a personal one, where the
    person *is* the organisation admin (prd-v2 §12.1). An enterprise member
    asking at `me` is refused by the admin check, as they should be.
    """
    if scope in (None, "me", "org"):
        return who.org_path
    if scope.startswith("team:"):
        return scope[5:]
    raise writes.invalid("scope", "A scope is `org`, `me`, or `team:<path>`.")


async def _reach_at(connection: Any, who: writes.Authority, scope: str | None
                    ) -> tuple[str, Json, str]:
    """The node, its current `reach.json`, and the head it was read at — after
    refusing anyone who does not administer that node."""
    node_path = _reach_node(who, scope)
    if await who.administers(node_path) is None:
        raise _forbidden(
            REACH_IS_TEAM_ADMINS.format(team=writes.name_of(node_path)),
            "reach.not_yours",
            {"team": node_path},
            f"Ask an admin of {writes.name_of(node_path)}.",
        )
    current, head = await writes.edit_file(
        connection, who=who, node_path=node_path, path="policy/reach.json",
        default={"mode": "off", "hosts": []},
    )
    return node_path, current, head


async def _write_reach(connection: Any, *, who: writes.Authority, node_path: str, head: str,
                       reach: Json, action: str, payload: Json, message: str) -> Json:
    return await writes.write_file(
        connection,
        who=who,
        expected_head=head,
        node_path=node_path,
        path="policy/reach.json",
        body=reach,
        message=message,
        reason_kind="admin-edit",
        action=action,
        payload=payload,
    )


@router.put("/reach", response_model=CommitResult)
async def set_reach(body: ReachIn, request: Request, principal: Who,
                    scope: Annotated[str | None, Query()] = None) -> Json:
    """The whole file, because the screen sets the whole thing: three radio
    choices and one list."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path, _, head = await _reach_at(connection, who, scope)
        reach = writes.validate_reach(body.model_dump())
        return await _write_reach(
            connection, who=who, node_path=node_path, head=head, reach=reach,
            action="reach.set", message=f"reach {reach['mode']} at {node_path}",
            payload={"team": writes.name_of(node_path), "mode": reach["mode"],
                     "n": len(reach["hosts"])},
        )


@router.post("/reach/hosts", status_code=status.HTTP_201_CREATED, response_model=CommitResult)
async def allow_host(body: HostIn, request: Request, principal: Who,
                     scope: Annotated[str | None, Query()] = None) -> Json:
    """The Endpoints tab's **Allow**, and the Reach screen's *add*: one host
    reachable at this node. Under `allow` that is a name added to the list;
    under `on` it is a name taken off the deny-list — the same wish, and the
    person should not have to know which mode they are in. Under `off` there is
    no list to put it on, so the action says so (W5-D4)."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path, current, head = await _reach_at(connection, who, scope)
        reach = writes.validate_reach(current)
        host = writes.validate_reach({"mode": "allow", "hosts": [body.host]})["hosts"][0]
        if reach["mode"] == "off":
            raise _forbidden(
                REACH_IS_OFF.format(team=writes.name_of(node_path)), "reach.off",
                {"team": node_path},
                "Set reach to an allow-list first; the suggested hosts are one click each.",
            )
        hosts = list(dict.fromkeys(
            [*reach["hosts"], host] if reach["mode"] == "allow"
            else [one for one in reach["hosts"] if one != host]))
        if hosts == reach["hosts"]:
            raise ApiError(409, "reach.host_present", f"{host} is already reachable here.")
        return await _write_reach(
            connection, who=who, node_path=node_path, head=head,
            reach={"mode": reach["mode"], "hosts": hosts},
            action="reach.allow_host", message=f"reach {host} from {node_path}",
            payload={"team": writes.name_of(node_path), "host": host},
        )


@router.delete("/reach/hosts/{host}", response_model=CommitResult)
async def deny_host(host: str, request: Request, principal: Who,
                    scope: Annotated[str | None, Query()] = None) -> Json:
    """The inverse: off an allow-list, onto a deny-list."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path, current, head = await _reach_at(connection, who, scope)
        reach = writes.validate_reach(current)
        host = writes.validate_reach({"mode": "allow", "hosts": [host]})["hosts"][0]
        if reach["mode"] == "off":
            raise ApiError(409, "reach.host_absent", f"{host} is not reachable here anyway.")
        hosts = list(dict.fromkeys(
            [one for one in reach["hosts"] if one != host] if reach["mode"] == "allow"
            else [*reach["hosts"], host]))
        if hosts == reach["hosts"]:
            raise ApiError(409, "reach.host_absent", f"{host} is not reachable here anyway.")
        return await _write_reach(
            connection, who=who, node_path=node_path, head=head,
            reach={"mode": reach["mode"], "hosts": hosts},
            action="reach.deny_host", message=f"stop reaching {host} from {node_path}",
            payload={"team": writes.name_of(node_path), "host": host},
        )


# --- security groups (org branch only) --------------------------------------


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    entries: list[Json]
    sources: Literal["vault", "vault-or-local"] = "vault"
    mint: Json | None = None


class GroupPatch(BaseModel):
    entries: list[Json] | None = None
    sources: Literal["vault", "vault-or-local"] | None = None
    mint: Json | None = None


async def _org_admin_or_refuse(who: writes.Authority, message: str, code: str) -> None:
    if not who.is_org_admin:
        raise _forbidden(message, code)


@router.post("/groups", status_code=status.HTTP_201_CREATED, response_model=CommitResult)
async def create_group(body: GroupIn, request: Request, principal: Who) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(
            who,
            GROUP_IS_ORG_ADMINS.format(team=writes.name_of(who.at or who.org_path)),
            "group.org_admin_required",
        )
        group = body.model_dump(exclude_none=True)
        writes.validate_group(group)
        current, head = await writes.edit_file(
            connection, who=who, node_path=who.org_path, path="policy/groups.json", default=[]
        )
        if any(entry.get("name") == body.name for entry in current):
            raise ApiError(409, "group.exists", f"A security group named {body.name} is here.")
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=who.org_path,
            path="policy/groups.json",
            body=[*current, group],
            message=f"security group {body.name}",
            reason_kind="admin-edit",
            action="group.create",
            payload={"group": body.name, "n": len(body.entries)},
        )


@router.patch("/groups/{name}", response_model=CommitResult)
async def edit_group(name: str, body: GroupPatch, request: Request, principal: Who) -> Json:
    """The group's name is its key — grants name it — so it never changes."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(
            who,
            GROUP_IS_ORG_ADMINS.format(team=writes.name_of(who.at or who.org_path)),
            "group.org_admin_required",
        )
        current, head = await writes.edit_file(
            connection, who=who, node_path=who.org_path, path="policy/groups.json", default=[]
        )
        index = next((i for i, entry in enumerate(current) if entry.get("name") == name), None)
        if index is None:
            raise ApiError(404, "group_not_found", f"No security group named {name}.")
        group = {**current[index], **body.model_dump(exclude_none=True), "name": name}
        writes.validate_group(group)
        current[index] = group
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=who.org_path,
            path="policy/groups.json",
            body=current,
            message=f"security group {name}",
            reason_kind="admin-edit",
            action="group.create",
            payload={"group": name, "n": len(group["entries"])},
        )


# --- boundaries (any node; union only, engine 01 §6 step 7) -----------------


class BoundaryIn(BaseModel):
    scope: Json
    kind: Literal["endpoint", "command", "filesystem", "capability"]
    value: str = Field(min_length=1, max_length=400)
    holds: Literal["enforced", "intercepted"] = "enforced"
    reason: str = Field(min_length=1, max_length=400)
    at: str | None = None
    id: str | None = None


@router.post("/boundaries", status_code=status.HTTP_201_CREATED, response_model=CommitResult)
async def add_boundary(body: BoundaryIn, request: Request, principal: Who) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path = body.at or who.at or who.org_path
        if await who.administers(node_path) is None:
            raise _forbidden(
                BOUNDARY_ADD_IS_TEAM_ADMINS,
                "boundary.not_yours",
                {"team": node_path},
                f"Ask an admin of {writes.name_of(node_path)}.",
            )
        boundary = {
            "id": body.id or f"b-{uuid4().hex[:12]}",
            "scope": writes.validate_scope(body.scope),
            "kind": body.kind,
            "value": body.value,
            "holds": body.holds,
            "reason": body.reason,
        }
        writes.validate_boundary(boundary, node_path=node_path)
        current, head = await writes.edit_file(
            connection, who=who, node_path=node_path, path="policy/boundaries.json", default=[]
        )
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=node_path,
            path="policy/boundaries.json",
            body=[*current, boundary],
            message=f"boundary {boundary['id']}",
            reason_kind="admin-edit",
            action="boundary.set",
            payload={
                "scope": _teams_words(boundary["scope"]),
                "value": body.value,
                "team": writes.name_of(node_path),
            },
        )


@router.delete("/boundaries/{boundary_id:path}", response_model=CommitResult)
async def remove_boundary(boundary_id: str, request: Request, principal: Who) -> Json:
    """The console holds the composed id, `<node path>/<id>` (01 §6 step 7)."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path, own_id = (
            boundary_id.split("/", 1) if "/" in boundary_id else (None, boundary_id)
        )
        if node_path is None:
            found = await writes.node_holding(
                connection, who.org_id, "boundaries.json", lambda e: e.get("id") == own_id
            )
            if found is None:
                raise ApiError(404, "boundary_not_found", "This boundary could not be found.")
            node_path = found[0]
        role = await who.administers(node_path)
        if role is None:
            raise _forbidden(
                BOUNDARY_LIFT_IS_NOBODY
                if node_path == who.org_path
                else BOUNDARY_LIFT_IS_THEIRS.format(team=writes.name_of(node_path)),
                "boundary.not_yours",
                {"at": node_path},
            )
        current, head = await writes.edit_file(
            connection, who=who, node_path=node_path, path="policy/boundaries.json", default=[]
        )
        boundary = next((entry for entry in current if entry.get("id") == own_id), None)
        if boundary is None:
            raise ApiError(404, "boundary_not_found", "This boundary could not be found.")
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=node_path,
            path="policy/boundaries.json",
            body=[entry for entry in current if entry.get("id") != own_id],
            message=f"lift boundary {own_id}",
            reason_kind="admin-edit",
            action="boundary.remove",
            payload={
                "scope": _teams_words(boundary.get("scope") or {}),
                "value": boundary.get("value"),
                "team": writes.name_of(node_path),
            },
        )


# --- providers and routing (org branch) -------------------------------------


class HarnessProviderIn(BaseModel):
    approval: Literal["approved", "beta", "not-approved"]
    scope: Json = {"teams": "all"}
    pin: Json
    speaks: list[str]
    reason: str | None = None
    # W6-D3: `HarnessProvider.name` is on the contract, and this is a whole-row
    # write — a field the body cannot carry is a field the next approval toggle
    # deletes, so the name rides back with the row like the pin and the scope.
    name: str | None = None


class ModelProviderIn(BaseModel):
    endpoints: dict[str, str]
    models: list[str]
    credential: Json | None = None
    # Same whole-row rule: the presets carry `attach` (engine 00 §4.3), and a
    # body without it would drop it the first time a row was edited.
    attach: Json | None = None


class RoutingIn(BaseModel):
    defaultFor: Json = Field(default_factory=lambda: {"teams": {}, "harnesses": {},
                                                      "providers": {}})
    approvedFor: Json = Field(default_factory=lambda: {"teams": {}, "harnesses": {},
                                                       "providers": {}})


# 00 §4.10: the one group *Set up* writes into, named in console 04 §10 and
# 07 §2. `my-keys` (D73) is the person's own and is never written by a verb.
MODEL_KEYS = "model-keys"

PROVIDER_ACTION = {
    "approved": "provider.approve",
    "beta": "provider.beta",
    "not-approved": "provider.decline",
}


@router.put("/providers/harness/{provider_id}", response_model=CommitResult)
async def put_harness_provider(
    provider_id: str, body: HarnessProviderIn, request: Request, principal: Who
) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, PROVIDER_IS_ORG_ADMINS, "provider.org_admin_required")
        provider = {"id": provider_id, **body.model_dump(exclude_none=True)}
        writes.validate_harness_provider(provider)
        current, head = await writes.edit_file(
            connection,
            who=who,
            node_path=who.org_path,
            path="policy/harness-providers.json",
            default=[],
        )
        rows = [entry for entry in current if entry.get("id") != provider_id]
        action = PROVIDER_ACTION[body.approval]
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=who.org_path,
            path="policy/harness-providers.json",
            body=[*rows, provider],
            message=f"{body.approval} {provider_id}",
            reason_kind="admin-edit",
            action=action,
            payload={
                "provider": provider_id,
                "scope": _teams_words(provider["scope"]),
                # 04 §9: beta and not-approved carry the reason into the log row
                # and onto the provider page, which is the whole point of asking.
                "reason": body.reason,
            },
        )


@router.put("/providers/model/{provider_id}", response_model=CommitResult)
async def put_model_provider(
    provider_id: str, body: ModelProviderIn, request: Request, principal: Who
) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, PROVIDER_IS_ORG_ADMINS, "provider.org_admin_required")
        provider = {"id": provider_id, **body.model_dump(exclude_none=True)}
        writes.validate_model_provider(provider)
        current, head = await writes.edit_file(
            connection,
            who=who,
            node_path=who.org_path,
            path="policy/model-providers.json",
            default=[],
        )
        rows = [entry for entry in current if entry.get("id") != provider_id]
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=who.org_path,
            path="policy/model-providers.json",
            body=[*rows, provider],
            message=f"model provider {provider_id}",
            reason_kind="admin-edit",
            action="provider.approve",
            payload={"provider": provider_id, "scope": "the organisation"},
        )


@router.delete("/providers/model/{provider_id}", response_model=CommitResult)
async def delete_model_provider(
    provider_id: str,
    request: Request,
    principal: Who,
    scope: Annotated[str | None, Query()] = None,
) -> Json:
    """W6-D5: a model provider is `recommended`, not `required` — the
    organisation's to remove (W6-D1). The file is on the org branch, so `scope`
    only ever names the organisation and the authority is an org admin's.

    Refused `provider.in_use` while anything still points at it: a routing cell
    (a team, a harness or a runtime) or a security group entry attached to its
    credential. Deleting those for the admin would be the console making a
    decision it was not asked for — the refusal names them instead, and the two
    screens that own them are where they go."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, PROVIDER_IS_ORG_ADMINS, "provider.org_admin_required")
        current, head = await writes.edit_file(
            connection,
            who=who,
            node_path=who.org_path,
            path="policy/model-providers.json",
            default=[],
        )
        provider = next((row for row in current if row.get("id") == provider_id), None)
        if provider is None:
            raise ApiError(
                404,
                "model_provider_unknown",
                f"{provider_id} is not a model provider this organisation holds.",
                {"provider": provider_id},
            )
        routing = await writes.read_json(
            connection, org_id=who.org_id, node_path=who.org_path, head=head,
            path="policy/routing.json", default={},
        )
        routed = sorted(_providers_named(routing).get(provider_id, set()))
        alias = (provider.get("credential") or {}).get("alias")
        groups = sorted(
            group["name"]
            for group in await writes.read_json(
                connection, org_id=who.org_id, node_path=who.org_path, head=head,
                path="policy/groups.json", default=[],
            )
            if alias and any(entry.get("alias") == alias
                             for entry in group.get("entries") or [])
        )
        if routed or groups:
            parts = []
            if routed:
                # One subject, once: a team that both defaults to it and
                # approves it is two cells and one name to go and change.
                parts.append("routed to by " + ", ".join(
                    sorted({cell.split(".", 2)[2] for cell in routed})))
            if groups:
                parts.append("held by the security group " + ", ".join(groups))
            raise ApiError(
                409,
                "provider.in_use",
                f"{provider_id} is still {' and '.join(parts)}.",
                {"routing": routed, "groups": groups, "provider": provider_id},
                remedy="Take those away first: routing on Model providers, entries on "
                       "Security groups.",
            )
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=who.org_path,
            path="policy/model-providers.json",
            body=[row for row in current if row.get("id") != provider_id],
            message=f"remove model provider {provider_id}",
            reason_kind="admin-edit",
            action="provider.delete",
            payload={"provider": provider_id, "scope": "the organisation"},
        )


class SetupIn(BaseModel):
    """*Set up* on a model provider row: paste the key, pick a default model."""

    key: str = Field(min_length=8)
    model: str | None = None


class SetupResult(CommitResult):
    """Whether this key became the organisation's default (D30i) — the modal
    says so, so the browser is generated with the field and not `unknown`."""

    default: bool


# 00 §4.3: the entry names the origin and how the secret is attached. The
# preset says how; a provider an admin added themselves is read off its own
# wire format, which is the rule the migration exporter already applies.
def _attach_for(provider_id: str, wire_format: str) -> Json:
    preset = seed.preset_attach(provider_id)
    if preset:
        return preset
    header = "x-api-key" if wire_format == "anthropic-messages" else "Authorization"
    return {"header": header, "prefix": "" if header == "x-api-key" else "Bearer "}


@router.post("/providers/model/{provider_id}/setup", response_model=SetupResult)
async def set_up_model_provider(
    provider_id: str, body: SetupIn, request: Request, principal: Who
) -> Json:
    """00 §4.10's *connect a key*, and the one place four policy files move
    together (console 04 §10, 07 §2): the value into the bundled vault, then
    **one** commit carrying the group entry, its grant, the provider's
    credential and — only when nothing is set there — the organisation's
    routing default (D30i). The key is never in the commit, the payload or a
    refusal; what is written is a reference to it.
    """
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, PROVIDER_IS_ORG_ADMINS, "provider.org_admin_required")
        # One head for all four files: read at A and commit against a re-read B
        # and the four would not be one change (00 D9).
        head = await writes.head_of(connection, who.org_id, writes.ORG_REF)

        async def read(path: str, default: Any) -> Any:
            return await writes.read_json(
                connection, org_id=who.org_id, node_path=who.org_path,
                head=head, path=path, default=default,
            )

        providers = await read("policy/model-providers.json", [])
        provider = next((row for row in providers if row.get("id") == provider_id), None)
        if provider is None:
            raise ApiError(
                404,
                "model_provider_unknown",
                f"{provider_id} is not a model provider this organisation holds.",
                {"provider": provider_id},
                remedy="Add a model provider first, then set it up.",
            )
        writes.validate_model_provider(provider)
        # 00 §4.10: a second alias for the same provider would tie in the
        # broker's precedence (04 §5.4). Refused before the vault is written,
        # so a refusal leaves no orphan secret behind.
        if provider.get("credential"):
            raise ApiError(
                409,
                "provider.credential_exists",
                f"{provider_id} already has a key. Rotate it on Key vaults, "
                f"or add a provider under another id.",
                {"provider": provider_id},
            )
        wire_format, base_url = next(iter(provider["endpoints"].items()))

        ref = f"model-keys/{who.org_path}/{provider_id}"
        await _store_secret(
            connection, who, name=f"model-keys/{provider_id}", ref=ref,
            env_var="HARNESS_SECRET", value=body.key,
        )

        groups = await read("policy/groups.json", [])
        group = next((row for row in groups if row.get("name") == MODEL_KEYS), None)
        if group is None:
            group = {"name": MODEL_KEYS, "entries": [], "sources": "vault"}
            groups = [*groups, group]
        group["entries"] = [
            *(entry for entry in group["entries"] if entry.get("alias") != provider_id),
            {
                "alias": provider_id,
                "secret": {"vault": BUNDLED, "ref": ref},
                # The model's own endpoint comes from `endpoints[wireFormat]`;
                # `upstream` is the origin the proxy attaches the key at (00 §4.2).
                "upstream": "/".join(base_url.split("/")[:3]),
                "attach": _attach_for(provider_id, wire_format),
            },
        ]
        writes.validate_group(group)

        provider["credential"] = {"alias": provider_id}
        if body.model and body.model not in provider["models"]:
            provider["models"] = [*provider["models"], body.model]

        changes = [
            {"path": "policy/groups.json", "blob": writes.blob(groups)},
            {"path": "policy/model-providers.json", "blob": writes.blob(providers)},
        ]

        # W7-D3: the grant is the other half of *one Set up is the whole model
        # story*. `teams: "all"` covers a personal chain, which has no team
        # node at all (`broker.covers` row 1), so the person this organisation
        # was made for holds the key the moment it is pasted.
        grants = await read("policy/grants.json", [])
        if not any(grant.get("group") == MODEL_KEYS for grant in grants):
            grants = [*grants, {"id": MODEL_KEYS, "scope": {"teams": "all"},
                                "group": MODEL_KEYS, "by": who.author["email"]}]
            changes.append({"path": "policy/grants.json", "blob": writes.blob(grants)})

        # D30i: one key under the organisation's path is the default for
        # everyone, and a team's own line still overrides it. A second provider
        # connected later does not take the first one's place.
        #
        # W7-D3: on a personal account it does. D30i protects an organisation's
        # standing choice from the next admin who pastes a key; a personal
        # account has one person, no teams and nowhere else to set a default,
        # so *Set up* is that choice being made — the provider just set up is
        # the default and is approved, every time, and nothing else is needed.
        # The edition is derived, not stored: a personal account is an
        # organisation with zero teams (prd-v2 §12.1, D30f). Read from
        # `idx_nodes` — the definition plane — and not from `org_units`,
        # because the records hold a team row for a personal account that
        # nothing composes: `org_units_role_order` refuses a user whose parent
        # is not a team, so `POST /v1/org-units` makes one and then creates no
        # branch for it (routes_org_units, D30f). `idx_nodes` is the chain the
        # broker walks and `routing_paths` keys by, so this answer and the
        # routing key written below are the same fact.
        personal = not await connection.fetchval(
            "select exists(select 1 from idx_nodes where org=$1 and kind='team')", who.org_id
        )
        routing = await read("policy/routing.json", {
            "defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
            "approvedFor": {"teams": {}, "harnesses": {}, "providers": {}},
        })
        defaults = routing["defaultFor"]["teams"]
        approved = routing["approvedFor"]["teams"].setdefault(who.org_path, [])
        default = personal or who.org_path not in defaults
        if default:
            defaults[who.org_path] = provider_id
        newly_approved = provider_id not in approved
        if newly_approved:
            approved.append(provider_id)
        if default or newly_approved:
            writes.validate_routing(routing)
            changes.append({"path": "policy/routing.json", "blob": writes.blob(routing)})

        committed = await writes.commit(
            connection,
            org_id=who.org_id,
            ref=writes.ORG_REF,
            changes=changes,
            message=f"connected a key for {provider_id}",
            reason={"kind": "admin-edit"},
            author=who.author,
            actor_id=principal.auth_user_id,
            audit_unit=who.org_id,
            action="provider.key_setup",
            payload={"provider": provider_id, "default": default,
                     "scope": "the organisation"},
            expected_head=head,
        )
        return {**committed, "default": default}


@router.put("/routing", response_model=CommitResult)
async def put_routing(body: RoutingIn, request: Request, principal: Who) -> Json:
    """Org admin: any cell. Team admin: their own team's default, and only to a
    provider that is already approved for them (04 §9, D42)."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        routing = body.model_dump()
        writes.validate_routing(routing)
        current, head = await writes.edit_file(
            connection,
            who=who,
            node_path=who.org_path,
            path="policy/routing.json",
            default={"defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
                     "approvedFor": {"teams": {}, "harnesses": {}, "providers": {}}},
        )
        if not who.is_org_admin:
            _check_team_routing(who, current, routing)
        await _check_needs_key(connection, who, head, current, routing)
        changed = _routing_change(current, routing)
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=who.org_path,
            path="policy/routing.json",
            body=routing,
            message="routing",
            reason_kind="admin-edit",
            action="routing.change",
            payload=changed,
        )


def _check_team_routing(who: writes.Authority, current: Json, next_: Json) -> None:
    if who.at is None:
        raise _forbidden(
            "Choosing a default model provider is a team admin's decision.",
            "routing.not_yours",
        )
    allowed = {who.at, *(path for path in writes.ancestors_of(who.at))}
    for side in ("defaultFor", "approvedFor"):
        for kind in ("teams", "harnesses", "providers"):
            before = (current.get(side) or {}).get(kind) or {}
            after = (next_.get(side) or {}).get(kind) or {}
            for key in set(before) | set(after):
                if before.get(key) == after.get(key):
                    continue
                own = key == who.at or key.startswith(who.at + ".")
                if side != "defaultFor" or kind != "teams" or not own:
                    raise _forbidden(
                        "Setting this is an organisation admin's decision; a team admin "
                        f"sets {writes.name_of(who.at)}'s own default.",
                        "routing.not_yours",
                        {"cell": f"{side}.{kind}.{key}"},
                    )
                approved = (current.get("approvedFor") or {}).get("teams", {})
                permitted = {
                    provider
                    for path in allowed
                    for provider in (approved.get(path) or [])
                }
                if after.get(key) and after[key] not in permitted:
                    raise _forbidden(
                        f"{after[key]} is not approved for {writes.name_of(who.at)}, so it "
                        "cannot be its default. An organisation admin approves it.",
                        "routing.not_approved",
                        {"approved": sorted(permitted)},
                    )


def _providers_named(routing: Json) -> dict[str, set[str]]:
    """provider id → the cells that name it, as `side.kind.subject`."""
    named: dict[str, set[str]] = {}
    for side in ("defaultFor", "approvedFor"):
        for kind in ("teams", "harnesses", "providers"):
            for subject, value in ((routing.get(side) or {}).get(kind) or {}).items():
                for provider in [value] if isinstance(value, str) else (value or []):
                    named.setdefault(provider, set()).add(f"{side}.{kind}.{subject}")
    return named


async def _check_needs_key(
    connection: Any, who: writes.Authority, head: str, current: Json, next_: Json
) -> None:
    """W6-D6: a model provider that needs a key cannot become a default or an
    approval. Only what this write *adds* is checked — a cell that already
    names a keyless provider is a state to be fixed, not a reason to refuse the
    unrelated cell being set — and *held* is read off the same branch the
    routing is written to, so the two cannot disagree.

    W7-D2: a provider some runtime this organisation lists signs in to itself
    is not keyless — it is *your sign-in* — and may be a default and an
    approval, because that is exactly the session the broker now allows."""
    before, after = _providers_named(current), _providers_named(next_)
    added = sorted(
        provider for provider, cells in after.items() if cells - before.get(provider, set())
    )
    if not added:
        return
    rows = await writes.read_json(
        connection, org_id=who.org_id, node_path=who.org_path, head=head,
        path="policy/model-providers.json", default=[],
    )
    groups = {
        group["name"]: group
        for group in await writes.read_json(
            connection, org_id=who.org_id, node_path=who.org_path, head=head,
            path="policy/groups.json", default=[],
        )
    }
    runtimes = await writes.read_json(
        connection, org_id=who.org_id, node_path=who.org_path, head=head,
        path="policy/harness-providers.json", default=[],
    )
    providers = {row["id"]: row for row in rows if row.get("id")}
    keyless = [
        provider for provider in added
        if provider in providers
        and broker.needs_key(groups, providers[provider])
        and not any(
            runtime.get("approval") != "not-approved" and broker.signs_in(runtime, provider)
            for runtime in runtimes
        )
    ]
    if keyless:
        raise ApiError(
            409,
            "provider.needs_key",
            f"{', '.join(keyless)} needs a key before anything can be routed to it.",
            {"providers": keyless},
            remedy="Connect one with *Set up* on Providers → Model providers.",
        )


def _routing_change(current: Json, next_: Json) -> Json:
    """The sentence 03 §6 wants: *set {model_provider} as default for {target}*."""
    before = (current.get("defaultFor") or {}).get("teams") or {}
    after = (next_.get("defaultFor") or {}).get("teams") or {}
    for key in after:
        if before.get(key) != after[key]:
            return {"model_provider": after[key], "target": key}
    return {"model_provider": "", "target": "the organisation"}


# --- key vaults (records; the org branch only names them) -------------------


class VaultIn(BaseModel):
    id: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    provider: str = Field(min_length=1, max_length=60)
    auth: Json | None = None
    lists_secrets: bool = False


class SecretIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    value: str = Field(min_length=1)
    env_var: str = Field(default="HARNESS_SECRET", pattern=r"^[A-Z_][A-Z0-9_]*$")


class RotateIn(BaseModel):
    value: str = Field(min_length=1)


@router.get("/vaults")
async def list_vaults(request: Request, principal: Who) -> Json:
    """A read-only re-seat of what `POST /v1/vaults` connected; the console's
    own vault screen is `GET /v1/console/vaults`, which adds the probes."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, VAULTS_ARE_ORG_ADMINS, "vault.org_admin_required")
        rows = await connection.fetch(
            "select id, provider, lists_secrets, connected_at from vaults where org_unit_id=$1"
            " order by id",
            who.org_id,
        )
        return {"items": [dict(row) for row in rows], "next": None}


@router.post("/vaults", status_code=status.HTTP_201_CREATED)
async def connect_vault(body: VaultIn, request: Request, principal: Who) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, VAULTS_ARE_ORG_ADMINS, "vault.org_admin_required")
        exists = await connection.fetchval(
            "select 1 from vaults where org_unit_id=$1 and id=$2", who.org_id, body.id
        )
        if exists:
            raise ApiError(409, "vault.exists", f"A vault named {body.id} is already connected.")
        await connection.execute(
            """insert into vaults(org_unit_id, id, provider, auth, lists_secrets, connected_by)
               values($1,$2,$3,$4,$5,$6)""",
            who.org_id,
            body.id,
            body.provider,
            json.dumps(body.auth or {}),
            body.lists_secrets,
            principal.auth_user_id,
        )
        await append_event(
            connection,
            org_unit_id=who.org_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="vault.connect",
            payload={"vault": body.id, "provider": body.provider},
        )
        return {"id": body.id, "provider": body.provider}


@router.delete("/vaults/{vault_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_vault(vault_id: str, request: Request, principal: Who) -> Response:
    """Refused while a security group still names it (00 §4.11): the groups
    would resolve to nothing at the next mint, and the console would have no
    way to say why."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, VAULTS_ARE_ORG_ADMINS, "vault.org_admin_required")
        groups = await writes.org_groups(connection, who.org_id, who.org_path)
        holding = sorted(
            name
            for name, group in groups.items()
            if any(entry["secret"]["vault"] == vault_id for entry in group.get("entries", []))
        )
        if holding:
            raise ApiError(
                409,
                "vault.in_use",
                f"{vault_id} is named by {', '.join(holding)}, so disconnecting it would stop "
                "those groups resolving.",
                {"groups": holding},
                remedy="Change those groups' entries first.",
            )
        deleted = await connection.fetchval(
            "delete from vaults where org_unit_id=$1 and id=$2 returning id", who.org_id, vault_id
        )
        if deleted is None:
            raise ApiError(404, "vault_not_found", "This vault is not connected.")
        await append_event(
            connection,
            org_unit_id=who.org_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="vault.connect",
            payload={"vault": vault_id, "state": "disconnected"},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _bundled_only(who: writes.Authority, vault_id: str) -> None:
    await _org_admin_or_refuse(who, VAULTS_ARE_ORG_ADMINS, "vault.org_admin_required")
    if vault_id != BUNDLED:
        raise _forbidden(
            CUSTOMER_VAULT_IS_THEIRS.format(vault=vault_id),
            "vault.not_writable",
            {"vault": vault_id},
            remedy=f"Rotate it in {vault_id} and the next session picks it up.",
        )


async def _store_secret(
    connection: Any, who: writes.Authority, *, name: str, ref: str, env_var: str, value: str
) -> Json:
    """One new secret in the bundled vault: the row, then its first version.

    No audit event: `provider.key_setup` writes one commit *after* this, and an
    event appended first would hold the org's chain while `definitions` calls
    back for it (cutover.md §5.6). Each caller appends its own, last.
    """
    if await connection.fetchval("select 1 from api_keys where ref=$1", ref):
        raise ApiError(409, "secret.exists", f"{ref} is already in the bundled vault.")
    key = await connection.fetchrow(
        """insert into api_keys(org_unit_id,name,ref,kind,env_var,created_by)
           values($1,$2,$3,'static_api_key',$4,$5) returning *""",
        who.org_id,
        name,
        ref,
        env_var,
        who.principal.auth_user_id,
    )
    version = await rotate(
        connection, key["id"], value, master_key=get_settings().harness_master_key
    )
    return {"ref": ref, "version": version["version"], "last4": version["last4"]}


@router.post("/vaults/{vault_id}/secrets", status_code=status.HTTP_201_CREATED)
async def paste_secret(
    vault_id: str, body: SecretIn, request: Request, principal: Who
) -> Json:
    """The bundled vault's *paste a key* (PRD §6.2), re-seated from
    `POST /v1/api-keys` under the name the console uses."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _bundled_only(who, vault_id)
        ref = key_ref(who.org_path, body.name)
        stored = await _store_secret(
            connection, who, name=body.name, ref=ref, env_var=body.env_var, value=body.value
        )
        await append_event(
            connection,
            org_unit_id=who.org_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="api_key.create",
            payload={"name": body.name, "ref": ref, "vault": vault_id},
        )
        return stored


@router.post("/vaults/{vault_id}/secrets/{secret_ref:path}/rotate")
async def rotate_secret(
    vault_id: str, secret_ref: str, body: RotateIn, request: Request, principal: Who
) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _bundled_only(who, vault_id)
        key = await connection.fetchrow("select * from api_keys where ref=$1", secret_ref)
        if key is None:
            raise ApiError(404, "secret_not_found", f"{secret_ref} is not in the bundled vault.")
        version = await rotate(
            connection, key["id"], body.value, master_key=get_settings().harness_master_key
        )
        # 04 §5.6: rotating retires the alias on every live session holding it.
        await broker.retire_for_key(connection, key["id"])
        await append_event(
            connection,
            org_unit_id=key["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="api_key.rotate",
            payload={"name": key["name"], "ref": secret_ref, "version": version["version"]},
        )
        return {"ref": secret_ref, "version": version["version"], "last4": version["last4"]}


# --- organisation assets: how one loads (prd-v2 §5.2) -----------------------


class LoadsIn(BaseModel):
    # W5-D10's three states. `always` and `chosen` are the two words this route
    # took before the split and are accepted for one release, so the console can
    # move at its own pace; both are written as the state they mean.
    loads: Literal["required", "recommended", "on-request", "always", "chosen"]


_LOADS_ALIASES = {"always": "required", "chosen": "on-request"}
_LOADS_SAID = {
    "required": "required — every session loads it",
    "recommended": "recommended — every new harness starts with it",
    "on-request": "loaded when a harness asks for it",
}


@router.put("/assets/{asset_id}/loads", response_model=CommitResult)
async def set_asset_loads(
    asset_id: UUID, body: LoadsIn, request: Request, principal: Who
) -> Json:
    """W5-D10. `required` is in every session's load set and cannot be removed
    from a harness or deleted; `recommended` is copied into a new harness at
    creation and is an ordinary entry of it from then on; `on-request` is
    neither. The file is always written in the two-list shape."""
    loads = _LOADS_ALIASES.get(body.loads, body.loads)
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        await _org_admin_or_refuse(who, LOADS_IS_ORG_ADMINS, "asset.org_admin_required")
        asset = await connection.fetchrow(
            "select kind, name, node_path from idx_assets where org=$1 and id=$2",
            who.org_id,
            asset_id,
        )
        if asset is None:
            raise ApiError(404, "asset_not_found", "This asset could not be found.")
        if asset["node_path"] != who.org_path:
            # compose step 12: a listed id must win on the org node.
            raise writes.invalid(
                "loads",
                "Only an asset on the organisation branch can be required or recommended.",
            )
        current, head = await writes.edit_file(
            connection,
            who=who,
            node_path=who.org_path,
            path="policy/always-loaded.json",
            default=[],
        )
        required, recommended = _always_loaded_lists(current)
        required = [entry for entry in required if entry != str(asset_id)]
        recommended = [entry for entry in recommended if entry != str(asset_id)]
        if loads == "required":
            required.append(str(asset_id))
        elif loads == "recommended":
            recommended.append(str(asset_id))
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=who.org_path,
            path="policy/always-loaded.json",
            body={"required": required, "recommended": recommended},
            message=f"{asset['name']} loads {loads}",
            reason_kind="admin-edit",
            action="asset.status",
            payload={
                "kind": asset["kind"],
                "name": asset["name"],
                "status": _LOADS_SAID[loads],
            },
        )


# --- editing and deleting an asset's own copy (00 §4.11, WS3a) --------------
#
# `?scope=` is read exactly as the console's own reads take it (00 §4.10):
# `org`, `team:<path>`, or `me` (the default) — the node whose copy is being
# changed, not the viewer's own scope. Authority is the node's admin, except a
# person's own branch, which is always theirs to change.


async def _asset_node(who: writes.Authority, scope: str | None) -> str:
    scope = scope or "me"
    if scope == "me":
        return who.user_path
    node_path = (
        who.org_path if scope == "org"
        else scope[5:] if scope.startswith("team:")
        else scope
    )
    if node_path != who.user_path and await who.administers(node_path) is None:
        raise _forbidden(ASSET_IS_ADMINS, "asset.not_yours", {"at": node_path})
    return node_path


async def _asset_at(connection: Any, who: writes.Authority, node_path: str, asset_id: UUID) -> Json:
    row = await connection.fetchrow(
        "select kind, name, tree, sidecar from idx_assets where org=$1 and node_path=$2 and id=$3",
        who.org_id,
        node_path,
        asset_id,
    )
    if row is None:
        raise ApiError(404, "asset_not_found", "This asset could not be found here.")
    return dict(row)


def _always_loaded_lists(body: Any) -> tuple[list[str], list[str]]:
    """W5-D10's `{ required, recommended }`, and a bare array read as the
    required list — the file's older shape, which an organisation keeps until
    an admin next changes it. One normalisation, shared with the seed, so this
    module and `engine/compose` cannot disagree about what a bare array means."""
    lists = seed.always_loaded_lists(body)
    return lists["required"], lists["recommended"]


async def _asset_row(
    connection: Any,
    who: writes.Authority,
    node_path: str,
    asset_id: UUID,
    *,
    kind: str,
    name: str,
    tree: str,
    sidecar: Json,
) -> Json:
    """`OrgAssetRow` for one asset at one node — a rename or a description
    change touches none of the relationships below (harness membership is by
    id, not name; team placement and credential needs are unchanged), so they
    are read from the index as it stands, reusing `domain/console.py`'s own
    edge helpers against a stand-in for its `Ctx` (they only ever read
    `.pool`, `.org_id`, `.cache` and `.segment` off it)."""
    asset_id_str = str(asset_id)
    loads = "on-request"
    if node_path == who.org_path:
        always, _ = await writes.edit_file(
            connection,
            who=who,
            node_path=who.org_path,
            path="policy/always-loaded.json",
            default=[],
        )
        required, recommended = _always_loaded_lists(always)
        loads = (
            "required" if asset_id_str in required
            else "recommended" if asset_id_str in recommended
            else "on-request"
        )
    loaded = loads == "required"
    org_here = node_path == who.org_path
    segment = "org" if org_here else "me" if node_path == who.user_path else node_path
    shim = SimpleNamespace(pool=connection, org_id=who.org_id, cache={}, segment=segment)
    needs = [
        need["alias"] for need in (sidecar.get("needs") or [])
        if need.get("kind") == "credential"
    ]
    groups: list[str] = []
    for alias in needs:
        groups += await console.edges_to(shim, "entry", "alias", alias)
    harness_ids = await console.edges_to(shim, "includes", "asset", asset_id_str)
    team_paths = await console.edges_from(shim, "placed_on", "asset", asset_id_str)
    return {
        "id": asset_id_str,
        "kind": kind,
        "name": name,
        "tree": tree,
        "sidecar": sidecar,
        "loads": console.tag("loads", loads),
        "harnesses": console.related("harnesses", [], True) if loaded else console.link_related(
            shim, "harnesses", harness_ids, "harnesses", labels=await console.harness_names(shim)
        ),
        "teams": console.team_related(team_paths),
        "groups": console.link_related(shim, "groups", groups, "groups"),
    }


class AssetPatchIn(BaseModel):
    description: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)


def _invalid_asset_name(name: str) -> str | None:
    """A name becomes one directory segment of a `CommitRequest` path (engine
    02 §5.3); refused here, with the field named, rather than reaching git as
    an opaque `definitions_refused`."""
    if name != name.strip() or any(character.isspace() for character in name):
        return "A name carries no whitespace."
    if "/" in name or "\\" in name:
        return "A name is one path segment, not a path."
    if ".." in name or name.startswith("."):
        return "A name may not start with a dot or contain `..`."
    return None


@router.patch("/assets/{asset_id}", response_model=OrgAssetRow)
async def edit_asset(
    asset_id: UUID,
    body: AssetPatchIn,
    request: Request,
    principal: Who,
    scope: Annotated[str | None, Query()] = None,
) -> Json:
    """`description` is written into the sidecar; a rename moves the whole
    directory in one tree copy against this same commit's parent (engine 02
    §5.3's `{path, from}`, which already copies a tree — no new internal
    capability needed) and rewrites nothing in a harness definition, because
    those list ids, not names."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path = await _asset_node(who, scope)
        asset = await _asset_at(connection, who, node_path, asset_id)
        kind, old_name = asset["kind"], asset["name"]
        new_name = body.name or old_name
        if body.name is not None:
            problem = _invalid_asset_name(body.name)
            if problem:
                raise writes.invalid("name", problem)
        old_path = f"assets/{kind}/{old_name}"
        new_path = f"assets/{kind}/{new_name}"
        ref = who.ref_for(node_path)
        head = await writes.head_of(connection, who.org_id, ref)
        sidecar = dict(asset["sidecar"] or {})
        if body.description is not None:
            sidecar["description"] = body.description
        changes: list[Json] = []
        if new_name != old_name:
            taken = await connection.fetchval(
                "select 1 from idx_assets where org=$1 and node_path=$2 and kind=$3 and name=$4",
                who.org_id,
                node_path,
                kind,
                new_name,
            )
            if taken:
                raise ApiError(
                    409,
                    "asset.name_taken",
                    f"{kind}/{new_name} already exists here.",
                    {"path": new_path},
                    remedy="Pick another name.",
                )
            changes.append({"path": new_path, "from": {"commit": head, "path": old_path}})
            changes.append({"path": old_path, "delete": True})
        if body.description is not None:
            # A pure rename's tree copy already carries `asset.json` unchanged;
            # only a description change needs it rewritten.
            writes.refuse_secrets(sidecar, path=f"{new_path}/asset.json")
            changes.append({"path": f"{new_path}/asset.json", "blob": writes.blob(sidecar)})
        if changes:
            message = (
                f"rename {kind}/{old_name} to {new_name}"
                if new_name != old_name
                else f"edit {kind}/{new_name}"
            )
            await writes.commit(
                connection,
                org_id=who.org_id,
                ref=ref,
                changes=changes,
                message=message,
                reason={"kind": "admin-edit"},
                author=who.author,
                actor_id=who.principal.auth_user_id,
                audit_unit=await writes.unit_of(connection, node_path),
                action="asset.edit",
                payload={"kind": kind, "name": new_name},
                expected_head=head,
            )
        return await _asset_row(
            connection, who, node_path, asset_id,
            kind=kind, name=new_name, tree=asset["tree"], sidecar=sidecar,
        )


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: UUID,
    request: Request,
    principal: Who,
    scope: Annotated[str | None, Query()] = None,
) -> Response:
    """Removes `assets/<kind>/<name>` from the node holding the copy, drops
    the id from every harness on that node that lists it, and from the org's
    required/recommended list if it is on it — one commit. Refused
    `asset.required` when the id is required: that is what makes the built-in
    `harness-authoring` skill undeletable (engine 00 D30j; WS4's split lands
    the two lists this already reads for)."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path = await _asset_node(who, scope)
        asset = await _asset_at(connection, who, node_path, asset_id)
        kind, name = asset["kind"], asset["name"]
        always, always_head = await writes.edit_file(
            connection,
            who=who,
            node_path=who.org_path,
            path="policy/always-loaded.json",
            default=[],
        )
        required, recommended = _always_loaded_lists(always)
        if str(asset_id) in required:
            raise ApiError(
                403,
                "asset.required",
                f"{name} is required: every session loads it, so it cannot be deleted.",
                {"kind": kind, "name": name},
                remedy="An organisation admin decides what is required.",
            )
        ref = who.ref_for(node_path)
        # On the org node this is the same ref `always` was just read at:
        # reuse that head rather than read it again (`write_file`'s own rule —
        # read at A, commit against B would clobber B's change to the file).
        head = always_head if node_path == who.org_path else await writes.head_of(
            connection, who.org_id, ref
        )
        changes: list[Json] = [{"path": f"assets/{kind}/{name}", "delete": True}]
        for row in await connection.fetch(
            "select id, def from idx_harnesses where org=$1 and node_path=$2",
            who.org_id,
            node_path,
        ):
            members = (row["def"] or {}).get("assets") or []
            if str(asset_id) in members:
                kept = [i for i in members if i != str(asset_id)]
                updated = {**row["def"], "assets": kept}
                path = f"harnesses/{row['id']}.json"
                changes.append({"path": path, "blob": writes.blob(updated)})
        if node_path == who.org_path and str(asset_id) in recommended:
            changes.append({
                "path": "policy/always-loaded.json",
                "blob": writes.blob({
                    "required": required,
                    "recommended": [i for i in recommended if i != str(asset_id)],
                }),
            })
        await writes.commit(
            connection,
            org_id=who.org_id,
            ref=ref,
            changes=changes,
            message=f"remove {kind}/{name}",
            reason={"kind": "admin-edit"},
            author=who.author,
            actor_id=who.principal.auth_user_id,
            audit_unit=await writes.unit_of(connection, node_path),
            action="asset.delete",
            payload={"kind": kind, "name": name},
            expected_head=head,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- harnesses on a ref (engine 01 §4.2) ------------------------------------


class HarnessGrantIn(BaseModel):
    """W7-D4's *Outside keys*: a security group, scoped to the new harness."""

    group: str


class HarnessIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    icon: Json | None = None
    assets: list[str] = Field(default_factory=list)
    # D2's vocabulary: `me`, `org`, or a dotted team path.
    scope: str = "me"
    from_: UUID | None = Field(default=None, alias="from")
    # W7-D4, the first-harness modal's two questions. `reach` is D131's shape
    # and becomes `HarnessDef.reach` — the harness's one last narrowing step.
    # `grant` is one security group, scoped to this harness and nothing else.
    reach: Json | None = None
    grant: HarnessGrantIn | None = None

    model_config = ConfigDict(populate_by_name=True)


class HarnessPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: Json | None = None
    assets: list[str] | None = None


async def _harness_node(who: writes.Authority, scope: str) -> str:
    if scope in ("me", "", None):
        return who.user_path
    node_path = who.org_path if scope == "org" else scope
    if await who.administers(node_path) is None:
        raise _forbidden(
            HARNESS_IS_TEAM_ADMINS,
            "harness.not_yours",
            {"at": node_path},
            f"Make it yours instead, or ask an admin of {writes.name_of(node_path)}.",
        )
    return node_path


# --- the store's write (W5-D15) ---------------------------------------------
#
# Three things are shared between *Add to harness* and *New harness from
# selection*, and are written once here: what the person may use, how a
# bundled preset becomes files on a branch, and the rule that a tool brings
# the environment its sidecar names. The console does the same three on the
# screen; the route does them again, because the CLI reaches the same place.


ASSET_UNKNOWN = "Nothing on your chain, and nothing bundled, answers that id."


async def _store_catalogue(
    connection: Any, who: writes.Authority
) -> tuple[dict[str, Json], dict[str, Json]]:
    """What the person may put in a harness: the winning copy of every asset
    that reaches them (`idx_effective`, the same set the store lists), and the
    bundled presets no id on their chain answers."""
    rows = await connection.fetch(
        """select e.asset_id id, a.kind, a.name, a.sidecar from idx_effective e
             join idx_assets a on a.org=e.org and a.node_path=e.from_path and a.id=e.asset_id
            where e.org=$1 and e.user_id=$2""",
        who.org_id,
        who.principal.auth_user_id,
    )
    usable = {str(row["id"]): dict(row) for row in rows}
    presets = {row["id"]: row for row in console.preset_catalogue() if row["id"] not in usable}
    return usable, presets


def _with_environments(ids: list[str], catalogue: dict[str, Json]) -> tuple[list[str], list[Json]]:
    """W5-D15. A tool whose sidecar names `needs: [{ kind: "environment" }]`
    brings that environment along. The console says so before the write and
    this says it again, so the CLI's path cannot differ; an environment no id
    in the catalogue answers is left out rather than invented."""
    out = list(dict.fromkeys(ids))
    brought: list[Json] = []
    byname = {(row["kind"], row["name"]): one for one, row in catalogue.items()}
    for asset_id in list(out):
        row = catalogue.get(asset_id)
        wanted = console.needed_environment((row or {}).get("sidecar"))
        if wanted is None:
            continue
        found = byname.get(("environment", wanted))
        if found is None or found in out:
            continue
        out.append(found)
        brought.append({"environment": wanted, "for": (row or {}).get("name")})
    return out, brought


async def _preset_copies(
    connection: Any, who: writes.Authority, node_path: str, ids: list[str]
) -> list[Json]:
    """The commit changes that put a bundled asset's directory on a branch.

    A preset is a directory under `engine/compose/presets/assets` (D30j) and
    not a row anywhere, so the copy is its files verbatim — `base64`, not
    `writes.blob`, for the reason the seed gives: a `SKILL.md` re-serialised
    as JSON is a different file. An id something on the chain already answers
    is not copied: the person already has it.
    """
    catalogue = {row["id"]: row for row in console.preset_catalogue()}
    wanted = [one for one in dict.fromkeys(ids) if one in catalogue]
    if not wanted:
        return []
    held = {
        str(row["id"])
        for row in await connection.fetch(
            """select id from idx_assets
                where org=$1 and id = any($2::uuid[]) and node_path = any($3::text[])""",
            who.org_id,
            [UUID(one) for one in wanted],
            writes.ancestors_of(node_path),
        )
    }
    files = seed.preset_assets()
    changes: list[Json] = []
    for asset_id in wanted:
        if asset_id in held:
            continue
        row = catalogue[asset_id]
        directory = files[f"assets/{row['kind']}/{row['name']}"]
        changes += [
            {"path": path, "blob": base64.b64encode(body).decode()}
            for path, body in sorted(directory.items())
        ]
    return changes


class AssetsIn(BaseModel):
    ids: list[str] = Field(min_length=1)


@router.post("/harnesses/{harness_id}/assets", response_model=CommitResult)
async def add_assets_to_harness(
    harness_id: UUID,
    body: AssetsIn,
    request: Request,
    principal: Who,
    scope: Annotated[str | None, Query()] = None,
) -> Json:
    """W5-D15. The ids join **the person's version** of the harness:
    `harnesses/<id>.json` on their own branch, created from the nearest copy
    on their chain when their branch holds none — the rule the CLI's
    `joinHarness` follows (engine 08 §10.0 step 5a), so the store and the
    terminal write the same file the same way.

    A bundled preset is copied onto the branch in the same commit, because a
    harness naming an id nothing answers is a row that reads *unanswered*. An
    id the harness already lists is skipped in silence: adding what is there
    is not a refusal, it is nothing to do.
    """
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path = await _harness_node(who, scope or "me")
        usable, presets = await _store_catalogue(connection, who)
        for asset_id in body.ids:
            if asset_id not in usable and asset_id not in presets:
                raise ApiError(404, "asset.unknown", ASSET_UNKNOWN, {"id": asset_id})
        ids, _brought = _with_environments(body.ids, {**usable, **presets})
        current, head = await writes.edit_file(
            connection,
            who=who,
            node_path=node_path,
            path=f"harnesses/{harness_id}.json",
            default=None,
        )
        if current is None:
            current = await _nearest_harness(connection, who, node_path, harness_id)
        listed = list(current.get("assets") or [])
        added = [one for one in ids if one not in listed]
        if not added:
            # Nothing to do is not a commit (`joinHarness` pushes nothing
            # either). The answer is still the head the caller would have got.
            return {"commit": head, "ref": who.ref_for(node_path), "added": []}
        harness = {**current, "id": str(harness_id), "assets": [*listed, *added]}
        writes.validate_harness(harness)
        changes = await _preset_copies(connection, who, node_path, added)
        changes.append({
            "path": f"harnesses/{harness_id}.json", "blob": writes.blob(harness),
        })
        result = await writes.commit(
            connection,
            org_id=who.org_id,
            ref=who.ref_for(node_path),
            changes=changes,
            message=f"Add {len(added)} to {harness['name']}",
            reason={"kind": "admin-edit"},
            author=who.author,
            actor_id=who.principal.auth_user_id,
            audit_unit=await writes.unit_of(connection, node_path),
            action="harness.add_assets",
            payload={"harness": str(harness_id), "name": harness.get("name"), "n": len(added)},
            expected_head=head,
        )
        return {**result, "added": added}


async def _nearest_harness(
    connection: Any, who: writes.Authority, node_path: str, harness_id: UUID
) -> Json:
    """The person's version of a harness their branch does not hold yet: the
    nearest copy on their chain, which is the one they were running (D3 keeps
    the id). Deepest path wins, because every ancestor is a prefix of it."""
    rows = await connection.fetch(
        """select node_path, def from idx_harnesses
            where org=$1 and id=$2 and node_path = any($3::text[])""",
        who.org_id,
        harness_id,
        writes.ancestors_of(node_path),
    )
    if not rows:
        raise ApiError(404, "harness_not_found", "No harness with that id is on your chain.")
    nearest = max(rows, key=lambda row: len(row["node_path"]))
    return dict(nearest["def"] or {})


async def _recommended_ids(connection: Any, who: writes.Authority) -> list[str]:
    """The organisation's `recommended` list, narrowed to ids the org branch
    actually holds — compose drops the others (01 §6 step 12), so a harness
    that named one would only ever show an unanswered row."""
    current, _ = await writes.edit_file(
        connection,
        who=who,
        node_path=who.org_path,
        path="policy/always-loaded.json",
        default=[],
    )
    _, recommended = _always_loaded_lists(current)
    if not recommended:
        return []
    held = {
        str(row["id"])
        for row in await connection.fetch(
            "select id from idx_assets where org=$1 and node_path=$2 and id = any($3::uuid[])",
            who.org_id,
            who.org_path,
            [UUID(one) for one in recommended],
        )
    }
    return [one for one in recommended if one in held]


@router.post("/harnesses", status_code=status.HTTP_201_CREATED, response_model=CommitResult)
async def create_harness_on_ref(body: HarnessIn, request: Request, principal: Who) -> Json:
    """`harnesses/<id>.json` on the caller's ref (00 §4.11, engine 01 §4.2).

    Creating is never refused at `me` (PRD §17.4): a new harness is a new
    filter over what the person already holds, never a new permission. The two
    optional fields W7-D4 adds are the exception and say so: `reach` narrows,
    which is always allowed; `grant` *is* a new permission, so it is refused
    exactly where `POST /v1/grants` would refuse it.
    """
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path = await _harness_node(who, body.scope)
        # Before anything is committed: a grant the caller may not make must
        # not leave a harness behind as a half-done write (D9).
        if body.grant is not None:
            if not who.is_org_admin:
                raise _forbidden(
                    GROUP_IS_ORG_ADMINS.format(team=writes.name_of(who.at or who.org_path)),
                    "grant.org_admin_required",
                    remedy="Narrow a grant your team already holds instead.",
                )
            if body.grant.group not in await writes.org_groups(
                connection, who.org_id, who.org_path
            ):
                raise writes.invalid(
                    "grant.group", f"No security group is named {body.grant.group!r}."
                )
        assets = list(body.assets)
        if body.from_ is not None:
            _, source = await writes.node_of_harness(connection, who.org_id, body.from_)
            assets = assets or list(source.get("assets") or [])
        # W5-D10: a new harness starts with what the organisation recommends.
        # They are ordinary entries from this commit on — the person may take
        # any of them out again, which is what separates them from `required`.
        for asset_id in await _recommended_ids(connection, who):
            if asset_id not in assets:
                assets.append(asset_id)
        harness_id = str(uuid4())
        harness = {
            "id": harness_id,
            "name": body.name,
            "description": body.description,
            "icon": body.icon or {"palette": [], "rows": []},
            "assets": assets,
        }
        # W7-D4: the harness's own last narrowing step (D131). Absent is not
        # `off` — it is *inherit*, which is what the modal sends when the
        # switch is on, so a harness never restates what it was given.
        if body.reach is not None:
            harness["reach"] = writes.validate_reach(body.reach)
        writes.validate_harness(harness)
        path = f"harnesses/{harness_id}.json"
        writes.refuse_secrets(harness, path=path)
        # W5-D15: *New harness from selection* may name a bundled preset the
        # organisation does not hold. It is copied onto this branch in the
        # same commit, by the same helper *Add to harness* uses — a harness
        # naming an id nothing answers is an unanswered row and nothing else.
        changes = await _preset_copies(connection, who, node_path, assets)
        result = await writes.commit(
            connection,
            org_id=who.org_id,
            ref=who.ref_for(node_path),
            changes=[*changes, {"path": path, "blob": writes.blob(harness)}],
            message=f"harness {body.name}",
            reason={"kind": "admin-edit"},
            author=who.author,
            actor_id=who.principal.auth_user_id,
            audit_unit=await writes.unit_of(connection, node_path),
            action="harness.create",
            payload={"name": body.name, "harness": harness_id},
        )
        if body.grant is None:
            return {**result, "id": harness_id}
        # W7-D4's *Outside keys*. Two commits, not one: a grant lives in
        # `policy/grants.json` and `policy/` is refused on a `users/…` branch
        # (01 §4.2), so it cannot ride along on the ref the harness landed on.
        # Both are in this transaction, so a refusal on the second rolls the
        # first back here — and the grant reaches this harness and nothing
        # else, which is the sense in which the modal writes nothing *at* the
        # organisation even though the file it appends to is the org's.
        grant = {
            "id": f"g-{uuid4().hex[:12]}",
            "scope": {"teams": "all", "harnesses": [harness_id]},
            "group": body.grant.group,
            "by": principal.email or str(principal.auth_user_id),
        }
        await _append_grant(
            connection,
            who=who,
            node_path=who.org_path,
            grant=grant,
            action="grant.create",
            payload={
                "group": body.grant.group,
                "teams": _teams_words(grant["scope"]),
                "grant": grant["id"],
            },
        )
        return {**result, "id": harness_id, "grant": grant["id"]}


@router.patch("/harnesses/{harness_id}", response_model=CommitResult)
async def edit_harness_on_ref(
    harness_id: UUID, body: HarnessPatch, request: Request, principal: Who
) -> Json:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path, _ = await writes.node_of_harness(connection, who.org_id, harness_id)
        if node_path != who.user_path and await who.administers(node_path) is None:
            raise _forbidden(HARNESS_IS_TEAM_ADMINS, "harness.not_yours", {"at": node_path})
        current, head = await writes.edit_file(
            connection,
            who=who,
            node_path=node_path,
            path=f"harnesses/{harness_id}.json",
            default=None,
        )
        if current is None:
            raise ApiError(404, "harness_not_found", "No harness with that id is on your chain.")
        harness = {**current, **body.model_dump(exclude_none=True), "id": str(harness_id)}
        writes.validate_harness(harness)
        return await writes.write_file(
            connection,
            who=who,
            expected_head=head,
            node_path=node_path,
            path=f"harnesses/{harness_id}.json",
            body=harness,
            message=f"harness {harness['name']}",
            reason_kind="admin-edit",
            action="harness.update",
            payload={"name": harness["name"], "harness": str(harness_id)},
        )


@router.delete("/harnesses/{harness_id}", response_model=CommitResult)
async def delete_harness_on_ref(harness_id: UUID, request: Request, principal: Who) -> Json:
    """The harness goes; nothing in it does — its files keep their history."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        node_path, definition = await writes.node_of_harness(connection, who.org_id, harness_id)
        if node_path != who.user_path and await who.administers(node_path) is None:
            raise _forbidden(HARNESS_IS_TEAM_ADMINS, "harness.not_yours", {"at": node_path})
        return await writes.write_file(
            connection,
            who=who,
            node_path=node_path,
            path=f"harnesses/{harness_id}.json",
            body=None,
            message=f"delete harness {definition.get('name', harness_id)}",
            reason_kind="admin-edit",
            action="harness.delete",
            payload={
                "name": definition.get("name"),
                "n": len(definition.get("assets") or []),
                "harness": str(harness_id),
            },
        )


# --- people, teams and roles (records) --------------------------------------


class TeamIn(BaseModel):
    """00 §4.11's form, and the legacy body, in one model: `kind` + `parent`
    (an id or a dotted path), or `role` + `parent_id`."""

    kind: Literal["team"] | None = None
    parent: str | None = None
    parent_id: UUID | None = None
    role: Literal["org", "team", "user"] | None = None
    name: str = Field(min_length=1, max_length=200)
    members: list[str] = Field(default_factory=list)


@router.post("/org-units", status_code=status.HTTP_201_CREATED)
async def create_org_unit(body: TeamIn, request: Request, principal: Who) -> Json:
    """The console posts `{ kind: "team", parent, name, members? }` (00 §4.11)
    and the CLI posts the records form; both land in `routes_org_units`, which
    is the one place a node and its branch are created together (02 §5.3)."""
    parent_id = body.parent_id
    if parent_id is None and body.parent is not None:
        parent_id = (await writes.unit_by_id_or_path(get_pool(request), body.parent))["id"]
    if parent_id is None:
        raise writes.invalid("parent", "Say which team or organisation this sits inside.")
    unit = await routes_org_units.create_org_unit(
        routes_org_units.OrgUnitCreate(
            parent_id=parent_id, role=body.role or "team", name=body.name
        ),
        request,
        principal,
    )
    invited: list[str] = []
    for member in body.members:
        await routes_org_units.create_invite(
            unit["id"],
            routes_org_units.InviteCreate(email=member),
            request,
            principal,
        )
        invited.append(member)
    return {**unit, "invited": invited}


class InviteIn(BaseModel):
    team: str
    email: str = Field(min_length=3, max_length=320)
    admin_level: Literal["owner", "admin"] | None = None


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def invite(body: InviteIn, request: Request, principal: Who) -> Json:
    """`POST /v1/invites` (00 §4.11, 04 §15) over the existing team route, so
    the console does not have to know a team's id to invite to it."""
    pool = get_pool(request)
    team = await writes.unit_by_id_or_path(pool, body.team)
    # `create_invite` refuses a non-admin too, with the records sentence; this
    # one names who decides, which is what the screen renders (P13).
    who = await writes.authority(pool, principal)
    if await who.administers(team["path"]) is None:
        raise _forbidden(INVITE_IS_TEAM_ADMINS, "invite.not_yours", {"team": team["path"]})
    return await routes_org_units.create_invite(
        team["id"],
        routes_org_units.InviteCreate(
            email=body.email,
            admin_level=body.admin_level,
            admin_unit_id=team["id"] if body.admin_level else None,
        ),
        request,
        principal,
    )


@router.delete(
    "/org-units/{id_or_path}/members/{person_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_member(
    id_or_path: str, person_id: UUID, request: Request, principal: Who
) -> Response:
    """Removing someone ends every grant that reached them through this team —
    the count is what the log row says and what `RemovalPreview` showed."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        team = await writes.unit_by_id_or_path(connection, id_or_path)
        if await who.administers(team["path"]) is None:
            raise _forbidden(REMOVE_IS_TEAM_ADMINS, "member.not_yours", {"team": team["path"]})
        member = await connection.fetchrow(
            """select m.user_unit_id, u.path from org_unit_members m
                 join org_units u on u.id=m.user_unit_id
                where m.auth_user_id=$1 and u.parent_id=$2""",
            person_id,
            team["id"],
        )
        if member is None:
            raise ApiError(404, "member_not_found", "This person is not on that team.")
        effective = await console_index.effective_for(connection, who.org_id, person_id)
        lost = len([grant for grant in effective["grants"] if grant.get("group")])
        await connection.execute(
            "delete from org_unit_members where auth_user_id=$1 and user_unit_id=$2",
            person_id,
            member["user_unit_id"],
        )
        await append_event(
            connection,
            org_unit_id=team["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="member.remove",
            payload={"person": str(person_id), "team": team["name"], "n": lost},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class RoleIn(BaseModel):
    level: Literal["admin", "owner"] = "admin"


@router.put("/org-units/{id_or_path}/admins/{person_id}")
async def appoint_admin(
    id_or_path: str, person_id: UUID, body: RoleIn, request: Request, principal: Who
) -> Json:
    """04 §15: appointing a team admin is an organisation admin's decision."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        team = await writes.unit_by_id_or_path(connection, id_or_path)
        if not who.is_org_admin:
            raise _forbidden(APPOINT_IS_ORG_ADMINS, "role.org_admin_required")
        await connection.execute(
            """insert into org_unit_admins(auth_user_id,org_unit_id,level) values($1,$2,$3)
               on conflict (auth_user_id,org_unit_id) do update set level=$3""",
            person_id,
            team["id"],
            body.level,
        )
        await append_event(
            connection,
            org_unit_id=team["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="member.role",
            payload={"person": str(person_id), "team": team["name"], "role": f"{body.level}"},
        )
        return {"person": str(person_id), "team": team["path"], "role": body.level}


@router.delete(
    "/org-units/{id_or_path}/admins/{person_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_admin(
    id_or_path: str, person_id: UUID, request: Request, principal: Who
) -> Response:
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        team = await writes.unit_by_id_or_path(connection, id_or_path)
        if not who.is_org_admin:
            raise _forbidden(APPOINT_IS_ORG_ADMINS, "role.org_admin_required")
        await connection.execute(
            "delete from org_unit_admins where auth_user_id=$1 and org_unit_id=$2",
            person_id,
            team["id"],
        )
        await append_event(
            connection,
            org_unit_id=team["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="member.role",
            payload={"person": str(person_id), "team": team["name"], "role": "member"},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class VisibilityIn(BaseModel):
    boundaries: bool | None = None
    logs: bool | None = None
    # W5-D15: the Assets screen's *Browse* tab. Off closes the place to pick
    # more from; it takes nothing already held away.
    store: bool | None = None


@router.patch("/org-units/{id_or_path}/visibility")
async def set_visibility(
    id_or_path: str, body: VisibilityIn, request: Request, principal: Who
) -> Json:
    """PRD §16: an organisation admin may turn the boundaries or the logs view
    off for a node. The console renders `HiddenView` naming the decision."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        unit = await writes.unit_by_id_or_path(connection, id_or_path)
        if not who.is_org_admin:
            raise _forbidden(VISIBILITY_IS_ORG_ADMINS, "visibility.org_admin_required")
        current = await connection.fetchval(
            "select policy from org_unit_boundaries where org_unit_id=$1", unit["id"]
        )
        policy = dict(current or {})
        visibility = {**(policy.get("visibility") or {}), **body.model_dump(exclude_none=True)}
        policy["visibility"] = visibility
        await connection.execute(
            """insert into org_unit_boundaries(org_unit_id, policy) values($1,$2)
               on conflict (org_unit_id) do update set policy=$2""",
            unit["id"],
            json.dumps(policy),
        )
        await append_event(
            connection,
            org_unit_id=unit["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="boundary.update",
            payload={"team": unit["name"], "visibility": visibility},
        )
        return {"unit": unit["path"], "visibility": visibility}


class PersonIn(BaseModel):
    state: Literal["active", "deactivated"]


@router.patch("/people/{person_id}")
async def set_person_state(
    person_id: UUID, body: PersonIn, request: Request, principal: Who
) -> Json:
    """A person who has left is not deleted (03 §7): their sessions, their
    audit rows and their branch stay true, and the membership carries the
    date."""
    async with transaction(get_pool(request)) as connection:
        who = await writes.authority(connection, principal)
        if not who.is_org_admin:
            raise _forbidden(PEOPLE_IS_ORG_ADMINS, "people.org_admin_required")
        member = await connection.fetchrow(
            """select m.user_unit_id, u.path, p.name team from org_unit_members m
                 join org_units u on u.id=m.user_unit_id
                 left join org_units p on p.id=u.parent_id
                where m.auth_user_id=$1""",
            person_id,
        )
        if member is None or not (
            member["path"] == who.org_path or member["path"].startswith(who.org_path + ".")
        ):
            raise ApiError(404, "person_not_found", "This person could not be found.")
        await connection.execute(
            "update org_unit_members set deactivated_at=$2 where auth_user_id=$1",
            person_id,
            None if body.state == "active" else datetime.now().astimezone(),
        )
        await append_event(
            connection,
            org_unit_id=who.org_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            # 03 §6 has no template for a state change; deactivating is being
            # taken off every team and reactivating is being put back, which is
            # what these two sentences say.
            action="member.remove" if body.state == "deactivated" else "member.add",
            payload={"person": str(person_id), "team": member["team"], "n": 0},
        )
        return {"person": str(person_id), "state": body.state}


# --- the requests list (04 §15's *Waiting on*) ------------------------------


@router.get("/requests", response_model=RequestPage)
async def list_requests(
    request: Request,
    principal: Who,
    subject: Annotated[Literal["promotion", "role", "publish"] | None, Query()] = None,
    state: Annotated[Literal["open", "closed"] | None, Query()] = None,
    team: Annotated[str | None, Query()] = None,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Json:
    """Requests the viewer authored, plus every request in a unit they
    administer. `?subject=role&state=open` is the People screen's list of role
    requests waiting on an organisation admin (04 §15, D43)."""
    pool = get_pool(request)
    rows = await pool.fetch(
        """select r.*, u.path team_path, coalesce(a.email,'') author_email
             from requests r
             join org_units u on u.id = r.org_unit_id
             left join auth.users a on a.id = r.author_auth_user_id
            where ($1::text is null or r.subject_kind = $1)
              and ($2::text is null or r.state = $2)
              and ($3::text is null or u.path = $3)
              and ($4::timestamptz is null or r.created_at < $4)
              and (r.author_auth_user_id = $5
                   or exists (select 1 from org_unit_admins d
                                join org_units au on au.id = d.org_unit_id
                               where d.auth_user_id = $5
                                 and (u.path = au.path or u.path like au.path || '.%')))
            order by r.created_at desc, r.id desc
            limit $6""",
        subject,
        state,
        team,
        datetime.fromisoformat(cursor) if cursor else None,
        principal.auth_user_id,
        limit,
    )
    items = [
        {
            "id": str(row["id"]),
            "title": row["title"],
            "subject": row["subject"],
            "subjectKind": row["subject_kind"],
            "team": row["team_path"],
            "author": row["author_email"],
            "state": row["state"],
            "decision": row["decision"],
            "at": row["created_at"].isoformat(),
        }
        for row in rows
    ]
    return {"items": items, "next": items[-1]["at"] if len(items) == limit else None}
