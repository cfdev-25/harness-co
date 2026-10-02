"""The broker (04): a security group becomes a credential for one session, or
the organization's rules refuse it.

Approval and sources are re-derived here from the index, never trusted from
the request (B3). A value leaves only inside a `MintedCredential` (B1); the
session record and every audit payload carry provenance only (B6).

`sessions.py` in 04 §4 is folded in here: `create_record`, `mark_revoked`,
`retire_alias`, `close` and `owned_active` are below.
"""

import json
import re
from typing import Any
from uuid import UUID

import asyncpg

from app.domain import console_index, seed, writes
from app.domain.audit import append_event
from app.domain.resolvers import BUNDLED, VaultUnknown, registry, resolver_for
from app.errors import ApiError
from app.identity import Principal

# 04 §9, verbatim. A code appears here and nowhere else.
BLOCKERS: dict[str, tuple[int, str, str]] = {
    "broker.rate_limited": (429, "You started more than ten sessions in a minute.",
        "Wait a moment and run again."),
    "broker.index_stale": (409, "Your organization's definitions are being re-read after a "
        "failed update; sessions cannot start until that finishes.",
        "Run again in a minute; if it persists an operator has been paged."),
    "broker.index_behind": (409,
        "The server has not finished reading the latest change to your organization.",
        "Run again in a few seconds."),
    "broker.harness_not_found": (404, "That harness is not one you can see.",
        "`harness switch` to pick another."),
    "broker.provider_unknown": (403,
        "`{provider}` is not a harness provider your organization has listed.",
        "An organization admin adds it under Providers."),
    "broker.provider_not_approved": (403, "`{provider}` is not approved: {reason}.",
        "An organization admin can approve it under Providers."),
    "broker.provider_not_in_scope": (403, "`{provider}` is approved, but not for your team.",
        "Ask an organization admin to widen its scope."),
    "broker.provider_beta_admins_only": (403,
        "`{provider}` is in beta, so only admins are handed credentials with it.",
        "Run with an approved provider, or ask an admin to approve it."),
    "broker.provider_below_pin": (403,
        "Your `{provider}` is version {v}; your organization requires {min}.",
        "Update it and run again."),
    "broker.model_unknown": (403, "`{model}` is not a model `{provider}` lists.",
        "Choose one from `harness preflight model`."),
    "broker.model_not_approved": (403,
        "`{model_provider}` is not approved for this harness, provider or team.",
        "An organization admin sets *approved for* under Model providers."),
    # W6-D6: no key is held for this provider, so nothing it is routed to can
    # run. Raised before approval, because approval of a provider that can
    # serve nobody is beside the point.
    "broker.provider_needs_key": (403,
        "`{model_provider}` needs a key: no security group holds a credential for it.",
        "An organization admin connects one with *Set up* under Model providers."),
    "broker.model_credential_missing": (403,
        "Nothing you hold has a credential for `{alias}`, which `{model_provider}` needs.",
        "Ask a team admin to narrow a group with `{alias}` into your team."),
    "broker.no_grant_for_alias": (422,
        "No group granted to your team has an entry for `{alias}`.",
        "Ask a team admin to narrow one into your team."),
    "broker.ambiguous_alias": (422,
        "Two grants give `{alias}` different secrets at the same scope.",
        "An admin narrows one of them to a harness, or removes one."),
    "broker.vault_unknown": (422, "`{vault}` is named by a group but is not connected.",
        "An organization admin connects it under Key vaults."),
    "broker.vault_unavailable": (422, "`{vault}` could not supply `{alias}`, and this group "
        "does not allow a local login instead.",
        "Check the vault's row under Key vaults; the session cannot use your own login for this."),
    "broker.session_not_active": (409, "This session is {status}.",
        "Start a new one with `harness run`."),
}


class Refusal(Exception):
    """A `Blocker` (00 §4.7) with a `broker.*` code. Every refusal is one, and
    every one is an authoritative audit event (B5)."""

    def __init__(self, code: str, **fields: Any) -> None:
        status, message, remedy = BLOCKERS[code]
        self.status = status
        self.blocker = {
            "code": code,
            "message": message.format(**fields),
            "remedy": remedy.format(**fields),
        }
        super().__init__(self.blocker["message"])

    def as_api_error(self) -> ApiError:
        return ApiError(
            self.status, self.blocker["code"], self.blocker["message"], {"blockers": [self.blocker]}
        )


# --- 5.0 held keys (W6-D6) --------------------------------------------------


def registered_vaults() -> set[str]:
    """The vault ids `api` has connected: the bundled one, which lives in its
    own database, and every resolver in the registry (04 §7)."""
    return {BUNDLED, *registry}


def alias_held(groups: dict[str, Any], alias: str | None) -> bool:
    """W6-D6's *held*: the alias appears in a security group entry whose vault
    is one `api` has connected. Read from the composed policy — never a live
    secret fetch, which is why a console page may ask it on every draw. It is
    not *granted*: a key the organization holds and has not narrowed to this
    team is still held, and the grant is the broker's own step 6."""
    if not alias:
        return False
    vaults = registered_vaults()
    return any(
        entry.get("alias") == alias and (entry.get("secret") or {}).get("vault") in vaults
        for group in groups.values()
        for entry in group.get("entries") or []
    )


def needs_key(groups: dict[str, Any], model_provider: dict[str, Any]) -> bool:
    """W6-D6: a model provider with no alias, or an alias no group entry holds,
    *needs a key*. It is excluded from routing writes, from `speaks_routed` and
    therefore from `runners_for` and `canRun`, and the session is refused —
    one rule, read in four places, computed without touching the network."""
    return not alias_held(groups, (model_provider.get("credential") or {}).get("alias"))


def signs_in(harness_provider: dict[str, Any] | None, model_provider_id: str) -> bool:
    """W7-D2: this runtime has its own sign-in for this model provider, so a
    key nobody holds is not a missing key — it is the person's own login.

    07 §6's `model_native` is the adapter's capability (*can this runtime use
    its own login at all*); the list of providers it ships that login for is
    data beside it, in `engine/compose/presets/harness-providers.json` as
    `modelNative`, never on a branch (`seed.preset_model_native`). Absent is
    `False`: a runtime we shipped no list for signs in to nothing, so every
    organization that supplies keys keeps Wave 6's `needs-key` exactly.
    """
    return model_provider_id in seed.preset_model_native(
        (harness_provider or {}).get("id") or ""
    )


# --- 5.1 covers, 5.2 pick_grant -------------------------------------------


def covers(scope: dict[str, Any], chain: list[dict[str, Any]], harness_id: str | None) -> bool:
    """The one scoping rule (prd-v2 §13). The Python twin of
    `engine/compose/src/scope.ts`; B7 holds only if the two agree line for
    line, so this follows that file where 04 §5.1 row 1 differs from it —
    a user path is never a scope target and neither is the org path, so only
    team nodes are compared, and org-wide is `teams: "all"`."""
    teams = scope.get("teams")
    named = [node["path"] for node in chain if node["kind"] == "team"]
    if teams != "all" and not any(team in named for team in teams or []):
        return False  # Row 1/2
    if scope.get("harnesses") is None:
        return True  # Row 3: absent is every harness the teams own, not a filter
    # Row 4: a session with no harness is covered only by grants with no narrowing.
    return harness_id is not None and harness_id in scope["harnesses"]


def _specificity(scope: dict[str, Any], chain: list[dict[str, Any]]) -> tuple[int, int]:
    """`scopeSpecificity` in `scope.ts`: the index in `chain` of the deepest
    team the scope names, `-1` for `"all"` and for a team not on this chain."""
    narrowed = 0 if scope.get("harnesses") is None else 1
    teams = scope.get("teams")
    if teams == "all":
        return -1, narrowed
    paths = [node["path"] for node in chain]
    depth = max(
        (paths.index(team) for team in teams or [] if team in paths), default=-1
    )
    return depth, narrowed


def pick_grant(
    alias: str,
    grants: list[dict[str, Any]],
    groups: dict[str, Any],
    chain: list[dict[str, Any]],
    harness_id: str | None,
) -> dict[str, Any]:
    """The narrowest covering grant that provides `alias`. Raises `Refusal`."""
    candidates = []
    for grant in grants:
        group = groups.get(grant.get("group") or "")
        if group is None or not covers(grant["scope"], chain, harness_id):
            continue
        entry = next((e for e in group["entries"] if e["alias"] == alias), None)
        if entry is None:
            continue
        # Step 1: a narrowed grant provides only the aliases it kept.
        narrowed = grant.get("narrowedFrom")
        if narrowed and alias not in narrowed.get("aliases", []):
            continue
        candidates.append((grant, entry))
    if not candidates:
        raise Refusal("broker.no_grant_for_alias", alias=alias)  # Step 2
    best = max(_specificity(grant["scope"], chain) for grant, _ in candidates)  # Step 3
    tied = [
        (grant, entry)
        for grant, entry in candidates
        if _specificity(grant["scope"], chain) == best
    ]
    # Step 4: a tie to different secrets is ambiguous; to the same secret it is
    # one answer, taken by grant id.
    if len({(e["secret"]["vault"], e["secret"]["ref"]) for _, e in tied}) > 1:
        raise Refusal("broker.ambiguous_alias", alias=alias)
    return min(tied, key=lambda pair: pair[0]["id"])[0]


# --- the chain and the role, from the tree `api` owns ----------------------


async def chain_for(
    connection: asyncpg.Connection, user_unit_id: UUID, auth_user_id: UUID, org_id: UUID
) -> list[dict[str, Any]]:
    """Step 1's `Chain`, root first, narrowest last. Refs per 02 §14."""
    rows = await connection.fetch(
        """with recursive up as (
             select id, parent_id, role, path, 0 depth from org_units where id=$1
             union all
             select p.id, p.parent_id, p.role, p.path, u.depth+1
               from org_units p join up u on u.parent_id=p.id
           )
           select up.role, up.path,
                  case up.role when 'org' then 'refs/heads/org'
                               when 'team' then 'refs/heads/teams/'||up.path
                               else 'refs/heads/users/'||$2::text end ref
             from up order by up.depth desc""",
        user_unit_id,
        str(auth_user_id),
    )
    commits = {
        row["ref"]: row["commit"]
        for row in await connection.fetch(
            "select ref, commit from idx_refs where org=$1", org_id
        )
    }
    return [
        {
            "kind": row["role"],
            "path": row["path"],
            "ref": row["ref"],
            "commit": commits.get(row["ref"], ""),
        }
        for row in rows
    ]


async def _org_id(connection: asyncpg.Connection, user_unit_id: UUID) -> UUID:
    return await connection.fetchval(
        """with recursive up as (
             select id, parent_id, role from org_units where id=$1
             union all select p.id, p.parent_id, p.role
                         from org_units p join up on up.parent_id=p.id
           ) select id from up where role='org' limit 1""",
        user_unit_id,
    )


async def role_on_chain(
    connection: asyncpg.Connection, auth_user_id: UUID, chain: list[dict[str, Any]]
) -> dict[str, Any]:
    """`/v1/me`'s `role` (00 §4.10): a grant at an `org` node is `org-admin`, at
    a `team` node `team-admin`, and no grant is `member`. Height, not level:
    `deps.role_at` ranks owner over admin, which is a different question."""
    paths = [node["path"] for node in chain if node["kind"] in ("org", "team")]
    row = await connection.fetchrow(
        """select u.role, u.path from org_unit_admins a join org_units u on u.id=a.org_unit_id
            where a.auth_user_id=$1 and u.path = any($2::text[])
            order by length(u.path) limit 1""",
        auth_user_id,
        paths,
    )
    if row is None:
        return {"level": "member", "at": None}
    return {
        "level": "org-admin" if row["role"] == "org" else "team-admin",
        "at": row["path"],
    }


# --- 5.3 open_session ------------------------------------------------------


def _below(version: str, minimum: str) -> bool:
    a = [int(part) for part in re.findall(r"\d+", version)]
    b = [int(part) for part in re.findall(r"\d+", minimum)]
    width = max(len(a), len(b))
    return a + [0] * (width - len(a)) < b + [0] * (width - len(b))


async def open_session(
    pool: asyncpg.Pool, auth_user_id: UUID, email: str | None, body: Any
) -> dict[str, Any]:
    """04 §5.3. One transaction, rolled back on refusal except for the
    `session.refuse` event, written in its own."""
    try:
        async with pool.acquire() as connection:
            async with connection.transaction():
                return await _open(connection, auth_user_id, email, body)
    except Refusal as refusal:
        async with pool.acquire() as connection:
            async with connection.transaction():
                unit = await connection.fetchrow(
                    "select user_unit_id from org_unit_members where auth_user_id=$1",
                    auth_user_id,
                )
                if unit:
                    await append_event(
                        connection,
                        org_unit_id=unit["user_unit_id"],
                        actor_type="user",
                        actor_id=auth_user_id,
                        event_class="authoritative",
                        action="session.refuse",
                        payload={
                            "provider": body.provider,
                            "harness": str(body.harness) if body.harness else None,
                            "model": list(body.model),
                            "blockers": [refusal.blocker["code"]],
                        },
                    )
        raise refusal.as_api_error() from refusal


async def _open(
    connection: asyncpg.Connection, auth_user_id: UUID, email: str | None, body: Any
) -> dict[str, Any]:
    # Step 1. Authenticate; the chain from the tree `api` owns; rate limit.
    unit = await connection.fetchrow(
        """select u.id, u.path from org_unit_members m join org_units u on u.id=m.user_unit_id
            where m.auth_user_id=$1""",
        auth_user_id,
    )
    if unit is None:
        raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
    existing = await connection.fetchval(
        "select status from harness_sessions where id=$1", body.id
    )
    if existing is not None and existing != "active":
        raise Refusal("broker.session_not_active", status=existing)  # B4
    started = await connection.fetchval(
        """select count(*) from harness_sessions
            where owner_auth_user_id=$1 and created_at > now() - interval '1 minute'""",
        auth_user_id,
    )
    if started >= 10:
        raise Refusal("broker.rate_limited")
    org_id = await _org_id(connection, unit["id"])
    chain = await chain_for(connection, unit["id"], auth_user_id, org_id)

    # Step 2. Load policy from the index, never from the request (B3).
    try:
        policy = await console_index.org_policy(connection, org_id)
        effective = await console_index.effective_for(connection, org_id, auth_user_id)
    except console_index.IndexStale as stale:
        raise Refusal("broker.index_stale") from stale
    indexed = dict(
        await connection.fetch("select ref, commit from idx_refs where org=$1", org_id)
    )
    # D66: checked one way only. A client on an older commit is fine — sessions
    # record what they ran on.
    if any(indexed.get(ref) != commit for ref, commit in (body.commits or {}).items()):
        raise Refusal("broker.index_behind")

    # Step 3. Harness.
    harness_id = str(body.harness) if body.harness else None
    if harness_id is not None:
        placed = await connection.fetchval(
            "select node_path from idx_harnesses where org=$1 and id=$2", org_id, body.harness
        )
        if placed is None or placed not in {node["path"] for node in chain}:
            raise Refusal("broker.harness_not_found")

    # Step 4. Provider approval.
    provider = policy["harnessProviders"].get(body.provider)
    if provider is None:
        raise Refusal("broker.provider_unknown", provider=body.provider)
    if provider["approval"] == "not-approved":
        raise Refusal(
            "broker.provider_not_approved",
            provider=body.provider,
            reason=provider.get("reason", ""),
        )
    if not covers(provider["scope"], chain, harness_id):
        raise Refusal("broker.provider_not_in_scope", provider=body.provider)
    role = await role_on_chain(connection, auth_user_id, chain)
    if provider["approval"] == "beta" and role["level"] == "member":
        raise Refusal("broker.provider_beta_admins_only", provider=body.provider)
    pin = provider.get("pin") or {}
    if "minVersion" in pin and _below(body.provider_version, pin["minVersion"]):
        raise Refusal(
            "broker.provider_below_pin",
            provider=body.provider,
            v=body.provider_version,
            min=pin["minVersion"],
        )

    # Step 5. Model approval.
    model_provider_id, model = body.model
    model_provider = policy["modelProviders"].get(model_provider_id)
    if model_provider is None or model not in model_provider.get("models", []):
        raise Refusal("broker.model_unknown", model=model, provider=model_provider_id)
    # W6-D6: the one place a session's model provider is picked. A provider
    # that needs a key can serve nobody, so it is refused before approval is
    # even read — the console excludes it from `canRun` for the same reason.
    # W7-D2: unless this runtime signs in to that provider itself. Then the
    # key nobody holds is the person's own login (03 D9/D11's native mode),
    # the session is allowed and marked `native` — not metered — and step 6
    # does not ask for a grant the organization never meant to give.
    keyless = needs_key(policy["groups"], model_provider)
    native_session = keyless and signs_in(provider, model_provider_id)
    if keyless and not native_session:
        raise Refusal("broker.provider_needs_key", model_provider=model_provider_id)
    approved = set(policy["routing"]["approvedFor"]["harnesses"].get(harness_id or "", []))
    approved |= set(policy["routing"]["approvedFor"]["providers"].get(body.provider, []))
    for node in chain:
        if node["kind"] in ("org", "team"):
            approved |= set(policy["routing"]["approvedFor"]["teams"].get(node["path"], []))
    if model_provider_id not in approved:
        raise Refusal("broker.model_not_approved", model_provider=model_provider_id)

    # Step 6. Aliases → grants. A missing non-model alias is a slot blocker,
    # not a refusal of the session (D64).
    # W7-D2: in a native session the model alias is not asked for. No group
    # holds it — that is what made the session native — so requiring it here
    # would refuse at step 6 the session step 5 just allowed. The CLI keeps
    # its own `deferred` slot for it (03 §5.6) and Pi uses its own login.
    credential = None if native_session else (model_provider.get("credential") or {}).get("alias")
    aliases = list(dict.fromkeys(list(body.aliases) + ([credential] if credential else [])))
    groups = policy["groups"]
    grants = effective["grants"]
    chosen: dict[str, dict[str, Any]] = {}
    slots: list[dict[str, Any]] = []
    for alias in aliases:
        try:
            chosen[alias] = pick_grant(alias, grants, groups, chain, harness_id)
        except Refusal as refusal:
            if alias == credential:
                raise Refusal(
                    "broker.model_credential_missing",
                    alias=alias,
                    model_provider=model_provider_id,
                ) from refusal
            slots.append(_slot(alias, "unsatisfied", None, blocker=refusal.blocker))

    # Step 7. Resolve.
    context_base = {
        "person": email or str(auth_user_id),
        "session": str(body.id),
        "org": str(org_id),
    }
    credentials: list[dict[str, Any]] = []
    for alias, grant in chosen.items():
        group = groups[grant["group"]]
        entry = next(e for e in group["entries"] if e["alias"] == alias)
        vault = entry["secret"]["vault"]
        via = {"grant": grant["id"], "group": grant["group"], "sources": group["sources"]}
        try:
            resolver = resolver_for(vault, connection)
        except VaultUnknown:
            slots.append(
                _slot(
                    alias,
                    "unsatisfied",
                    via,
                    blocker=Refusal("broker.vault_unknown", vault=vault).blocker,
                )
            )
            continue
        try:
            minted = await resolver.resolve(
                entry["secret"]["ref"],
                {**context_base, "group": grant["group"], "grant": grant["id"]},
                group.get("mint"),
            )
        except Exception:  # 04 §5.3 step 7 names this failure mode
            if group["sources"] == "vault":
                # B2: no fallback exists in this branch.
                slots.append(
                    _slot(
                        alias,
                        "unsatisfied",
                        via,
                        blocker=Refusal(
                            "broker.vault_unavailable", vault=vault, alias=alias
                        ).blocker,
                    )
                )
            else:
                slots.append(_slot(alias, "deferred", via))
            continue
        resolved = {
            "source": "vault",
            "vault": vault,
            "group": grant["group"],
            "grant": grant["id"],
        }
        credentials.append(
            {
                "alias": alias,
                "value": minted["value"],
                "kind": minted["kind"],
                "expiresAt": minted["expires_at"],
                "resolvedFrom": resolved,
                "evidence": minted["evidence"],
            }
        )
        slots.append(
            _slot(
                alias,
                "satisfied",
                via,
                resolved_from=resolved,
                evidence=minted["evidence"],
                kind=minted["kind"],
                expires_at=minted["expires_at"],
                version=minted.get("version"),
            )
        )

    # Step 8. Record — provenance only (B6).
    await create_record(
        connection,
        body=body,
        org_unit_id=unit["id"],
        owner=auth_user_id,
        slots=slots,
    )
    # Step 9. One authoritative `session.open` (D63: `session.mint` is folded in).
    await append_event(
        connection,
        org_unit_id=unit["id"],
        actor_type="user",
        actor_id=auth_user_id,
        event_class="authoritative",
        action="session.open",
        payload={
            "provider": body.provider,
            "provider_version": body.provider_version,
            "harness": harness_id,
            "model": list(body.model),
            "commits": dict(body.commits or {}),
            # W7-D2: the session ran on the person's own sign-in, not on a key
            # the organization minted. An admin reading the log sees which, and
            # a native session is not metered (C22).
            "native": native_session,
            "slots": [_provenance(slot) | {"alias": slot["need"]["alias"]} for slot in slots],
        },
    )
    # Step 10.
    for slot in slots:
        del slot["_stored"]
    return {"credentials": credentials, "slots": slots, "blockers": [], "native": native_session}


def _slot(
    alias: str,
    state: str,
    via: dict[str, Any] | None,
    *,
    resolved_from: dict[str, Any] | None = None,
    evidence: str = "declared",
    blocker: dict[str, Any] | None = None,
    kind: str | None = None,
    expires_at: str | None = None,
    version: str | None = None,
) -> dict[str, Any]:
    slot: dict[str, Any] = {
        "need": {"kind": "credential", "alias": alias},
        "state": state,
        "evidence": evidence,
        "resolvedFrom": resolved_from,
    }
    # Provenance the record and the audit payload carry, never the wire Slot.
    slot["_stored"] = {"kind": kind, "expires_at": expires_at, "version": version}
    if via is not None:
        slot["via"] = via  # D60: named even when nothing was filled
    if blocker is not None:
        slot["blocker"] = blocker
    return slot


def _provenance(slot: dict[str, Any]) -> dict[str, Any]:
    keys = ("state", "evidence", "resolvedFrom", "via")
    return {key: slot.get(key) for key in keys} | slot["_stored"]


# --- the session record (04 §4 `sessions.py`, folded in) -------------------


async def create_record(
    connection: asyncpg.Connection,
    *,
    body: Any,
    org_unit_id: UUID,
    owner: UUID,
    slots: list[dict[str, Any]],
) -> None:
    stored = {slot["need"]["alias"]: _provenance(slot) for slot in slots}
    await connection.execute(
        """insert into harness_sessions
             (id, org_unit_id, owner_auth_user_id, harness_id, provider_id, provider_version,
              model_provider, model, commits, slots, workspace, hostname)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)""",
        body.id,
        org_unit_id,
        owner,
        body.harness,
        body.provider,
        body.provider_version,
        body.model[0],
        body.model[1],
        json.dumps(dict(body.commits or {})),
        json.dumps(stored),
        # W5-D14: on the row and nowhere else. The audit payload below is
        # readable by an admin; a person's paths are not.
        getattr(body, "workspace", None),
        getattr(body, "hostname", None),
    )


async def owned_active(
    connection: asyncpg.Connection,
    session_id: UUID,
    principal: Principal,
    *,
    admins_too: bool = False,
) -> dict[str, Any]:
    """The active session a caller may act on. The supervisor and the proxy are
    the owner; `admins_too` is revoke, which 00 §4.10 also gives an admin over
    the owner's chain — decided by `Authority.administers`, so "administers
    node X" is read in one place. A session the caller may not touch is the
    404 a session that does not exist is."""
    row = await connection.fetchrow(
        """select s.*, u.path owner_path from harness_sessions s
             join org_units u on u.id = s.org_unit_id where s.id=$1""",
        session_id,
    )
    allowed = row is not None and row["owner_auth_user_id"] == principal.auth_user_id
    if row is not None and not allowed and admins_too:
        who = await writes.authority(connection, principal)
        allowed = await who.administers(row["owner_path"]) is not None
    if not allowed:
        raise ApiError(404, "session_not_found", "This session could not be found.")
    if row["status"] != "active":
        raise Refusal("broker.session_not_active", status=row["status"]).as_api_error()
    return dict(row)


async def mark_revoked(
    connection: asyncpg.Connection, session_id: UUID, reason: str
) -> dict[str, Any] | None:
    row = await connection.fetchrow(
        """update harness_sessions set status='revoked', revoked_reason=$2
            where id=$1 and status='active' returning *""",
        session_id,
        reason,
    )
    return dict(row) if row else None


async def retire_alias(connection: asyncpg.Connection, session_id: UUID, alias: str) -> None:
    await connection.execute(
        """update harness_sessions
              set slots = jsonb_set(slots, array[$2, 'retired'], 'true')
            where id=$1 and slots ? $2""",
        session_id,
        alias,
    )


async def close(
    connection: asyncpg.Connection, session: dict[str, Any], tally: list[dict[str, Any]]
) -> dict[str, int | list[str]]:
    """5.7. `revoke` every minted slot, best-effort; a failure is audited and
    never raised to the client."""
    revoked, failed = 0, []
    for alias, slot in (session["slots"] or {}).items():
        if slot.get("kind") != "minted":
            continue
        resolved = slot.get("resolvedFrom") or {}
        try:
            await resolver_for(resolved.get("vault", ""), connection).revoke(slot)
            revoked += 1
        except Exception:  # 5.7 names this failure mode
            failed.append(alias)
    await connection.execute(
        "update harness_sessions set status='closed', endpoints_tally=$2,"
        " closed_at=now() where id=$1",
        session["id"],
        json.dumps(tally),
    )
    return {"minted_revoked": revoked, "revoke_failed": failed}


# --- 5.5 policy change, 5.6 rotation, 5.7 grace ----------------------------


async def revoke_for_refs(
    connection: asyncpg.Connection, org_id: UUID, refs: list[str]
) -> list[dict[str, Any]]:
    """C33: a policy change ends the session. Coarse by design (D65)."""
    rows = await connection.fetch(
        """select s.id, s.org_unit_id from harness_sessions s
             join org_units u on u.id = s.org_unit_id
             join org_units o on o.id = $1
            where s.status='active'
              and (u.path = o.path or u.path like o.path || '.%')
              and exists (select 1 from jsonb_object_keys(s.commits) k
                            where k = any($2::text[]))""",
        org_id,
        refs,
    )
    revoked = []
    for row in rows:
        await mark_revoked(connection, row["id"], "policy_changed")
        await append_event(
            connection,
            org_unit_id=row["org_unit_id"],
            actor_type="system",
            actor_id=None,
            event_class="authoritative",
            action="session.revoke",
            payload={"reason": "policy_changed", "refs": refs},
        )
        revoked.append(dict(row))
    return revoked


async def retire_for_key(connection: asyncpg.Connection, api_key_id: UUID) -> list[str]:
    """5.6. Rotation retires the alias in every running session whose group
    entry names this key's ref; the session continues (D61)."""
    key = await connection.fetchrow(
        "select ref, org_unit_id from api_keys where id=$1", api_key_id
    )
    if key is None:
        return []
    org_id = await _org_id(connection, key["org_unit_id"])
    groups = (await console_index.org_policy(connection, org_id))["groups"]
    named = {
        (name, entry["alias"])
        for name, group in groups.items()
        for entry in group["entries"]
        if entry["secret"]["ref"] == key["ref"]
    }
    rows = await connection.fetch(
        """select s.id, s.org_unit_id, s.slots from harness_sessions s
             join org_units u on u.id = s.org_unit_id
             join org_units o on o.id = $1
            where s.status='active'
              and (u.path = o.path or u.path like o.path || '.%')""",
        org_id,
    )
    retired = []
    for row in rows:
        for alias, slot in (row["slots"] or {}).items():
            resolved = slot.get("resolvedFrom") or {}
            if resolved.get("vault") != "bundled" or (resolved.get("group"), alias) not in named:
                continue
            await retire_alias(connection, row["id"], alias)
            await append_event(
                connection,
                org_unit_id=row["org_unit_id"],
                actor_type="system",
                actor_id=None,
                event_class="authoritative",
                action="session.retire",
                payload={"alias": alias, "key_id": str(api_key_id)},
            )
            retired.append(alias)
    return retired


async def expire_grace(connection: asyncpg.Connection) -> int:
    """04 §6: the hourly task. `Bundled.resolve` reads `active` only; `grace`
    exists so a bad rotation can be rolled back within the window."""
    return len(
        await connection.fetch(
            """update api_key_versions set status='retired', retired_at=now()
                where status='grace' and grace_until < now() returning id"""
        )
    )
