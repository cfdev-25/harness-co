import re
from typing import Any, Literal

import asyncpg
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.capabilities import to_capability
from app.errors import ApiError


class Approvals(BaseModel):
    """`deploy` is agent-side and advisory (docs/archive/agents.md §11.3): it is read
    only by `pi/packages/harness/src/index.ts`, which asks a session to
    confirm before it calls a tool named in `deploy_tools` — a field
    `Boundary` does not even carry yet (14.1). Nothing at the control plane,
    the proxy or the sandbox refuses a deploy because of this key. The actual
    control-plane gate already has its own name and its own row:
    `build_policy.push_review`.
    """

    model_config = ConfigDict(extra="forbid")
    deploy: Literal["required", "off"] | None = None


class BuildPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    push_review: bool = False


class Budget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    monthly_usd_cap: float | None = Field(default=None, ge=0)
    requests_per_minute: int | None = Field(default=None, ge=0)


class ModelPolicy(BaseModel):
    """agents.md §5.1's two independent axes.

    `source` is what the org provides; `none` is its strictest value, because
    a subtree can decline the org's model but cannot conjure one the org never
    offered. `user_credentials` is what the user may bring; `forbidden` is its
    strictest value, for the same reason in the other direction. Both are
    `None` when nobody in the chain has set them, which `merge_boundaries` and
    `validate_tightening` treat exactly like every other unset boundary field
    — not a default, an absence for the client to default safely (§5.1: "an
    absent model must not become an accidental one").
    """

    model_config = ConfigDict(extra="forbid")
    source: Literal["proxied", "gateway", "none"] | None = None
    user_credentials: Literal["forbidden", "allowed", "required"] | None = None


class Boundary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    egress_allowlist: list[str] | None = None
    connector_allowlist: list[str] | None = None
    approvals: Approvals | None = None
    build_policy: BuildPolicy | None = None
    budget: Budget | None = None
    # Which capabilities a session may use at all, and which of those need a
    # per-call confirmation before running (agents.md §7.1.2). Values are
    # capabilities, not tool names, translated on the way in so the API never
    # stores an agent's private vocabulary even if an admin still types one.
    allowed_tools: list[str] | None = None
    deploy_tools: list[str] | None = None
    model_policy: ModelPolicy | None = None

    @field_validator("allowed_tools", "deploy_tools")
    @classmethod
    def _as_capabilities(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return [to_capability(item) for item in value]


# agents.md §5.1: `none` and `forbidden` are each axis's strictest value, so
# only a move *out of* them is a loosening. `proxied`<->`gateway` and
# `allowed`<->`required` carry no order relative to each other — either is a
# lateral policy choice a child may make freely.
_MODEL_SOURCE_PROVIDES_MODEL = {"proxied": True, "gateway": True, "none": False}
_MODEL_CREDENTIALS_PERMIT_OWN = {"forbidden": False, "allowed": True, "required": True}


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", value.lower()))
    return re.sub(r"-+", "-", cleaned).strip("-")


def email_label(email: str) -> str:
    """A path segment for a user unit that cannot collide with another address.

    `slugify` deletes every symbol, so "a.b@x.com" and "ab@x.com" both became
    "abxcom" — and `path` is unique-indexed, so the second person to accept an
    invite in a team could never onboard. Dots and "@" are replaced rather
    than dropped, which keeps distinct addresses distinct and stays readable.
    Dots cannot survive as dots: the path itself is dot-separated.
    """
    replaced = email.lower().replace("@", "-at-").replace(".", "-")
    cleaned = re.sub(r"[^a-z0-9-]", "-", replaced)
    return re.sub(r"-+", "-", cleaned).strip("-")


# The audit from docs/archive/agents.md §11.3, turned into data instead of a second,
# hand-maintained list. A control ships only if a choke point we own refuses
# it (§11.1); everything below is a verdict on a control still in the
# console, not a claim about what a particular org configured, so this is a
# constant, not something computed per policy chain.
#
# `budget.monthly_usd_cap` is deliberately absent. Its verdict is an open
# product decision (§11.3's own "?"), not a decision this pass makes, so it
# carries no entry here and the console renders it exactly as before.
CONTROL_VERDICTS: dict[str, dict[str, str]] = {
    "egress_allowlist": {
        "status": "pending",
        "note": (
            "The control plane checks a skill's declared hosts against this list "
            "when it is pushed. Nothing yet stops a session reaching an unlisted "
            "host at run time — that lands with the proxy (Phase 3)."
        ),
    },
    "connector_allowlist": {
        "status": "pending",
        "note": (
            "The control plane checks a skill's declared connections against this "
            "list when it is pushed. Nothing yet stops a session from using an "
            "unlisted one at run time — that lands with the proxy (Phase 3)."
        ),
    },
    "build_policy.push_review": {
        "status": "enforced",
        "note": (
            "A version pushed under review is filtered out of resolution until an "
            "admin approves it — no session can run it in the meantime."
        ),
    },
    "approvals.deploy": {
        "status": "advisory",
        "note": (
            "Asks the agent to confirm before it calls a tool named in that unit's "
            "deploy list. The agent decides whether to honour the ask; nothing "
            "here can refuse the call."
        ),
    },
    "budget.requests_per_minute": {
        "status": "pending",
        "note": (
            "Counted at the proxy once requests run through it (Phase 3). "
            "Nothing counts them yet."
        ),
    },
}


def merge_boundaries(policies: list[dict[str, Any]]) -> dict[str, Any]:
    defined_egress = [set(p["egress_allowlist"]) for p in policies if "egress_allowlist" in p]
    defined_connectors = [
        set(p["connector_allowlist"]) for p in policies if "connector_allowlist" in p
    ]
    defined_allowed_tools = [
        set(p["allowed_tools"]) for p in policies if "allowed_tools" in p
    ]

    def intersection(values: list[set[str]]) -> list[str] | None:
        """None when nobody in the chain constrained this, which is not the
        same as an empty list.

        Absent means "no policy here, so no restriction". Empty means "a policy
        was set and it permits nothing". Collapsing the two would mean that
        turning egress enforcement on denies every org that never wrote a
        policy. Kubernetes NetworkPolicy draws the same line for the same
        reason: no policy selects you, you are unrestricted; once one does,
        only what it lists is allowed.
        """
        return sorted(set.intersection(*values)) if values else None

    caps: dict[str, float | int | None] = {}
    for field in ("monthly_usd_cap", "requests_per_minute"):
        values = [
            p["budget"][field] for p in policies if p.get("budget", {}).get(field) is not None
        ]
        caps[field] = min(values) if values else None

    # `deploy_tools` names capabilities that need a confirmation, not
    # capabilities that are permitted at all — a level adding one is asking
    # for *more* caution, so the chain unions rather than intersects. There
    # is no absent-vs-empty distinction to preserve here the way there is for
    # an allowlist: nobody requiring a confirmation and an empty list both
    # mean the same thing, "confirm nothing extra".
    deploy_tools = sorted({tool for p in policies for tool in p.get("deploy_tools", [])})

    def nearest(key: str, subkey: str) -> str | None:
        """The deepest explicit setter in the chain, or `None` if nobody set it.

        `write-time validate_tightening` already refused any save that would
        have let a child loosen `source`/`user_credentials` past its parent's
        effective value, so by the time a full chain reaches here the nearest
        setter's value is already at least as strict as every ancestor's —
        the same reasoning every nearest-wins boundary field relies on.
        """
        return next(
            (p[key][subkey] for p in reversed(policies) if p.get(key, {}).get(subkey) is not None),
            None,
        )

    return {
        "egress_allowlist": intersection(defined_egress),
        "connector_allowlist": intersection(defined_connectors),
        "allowed_tools": intersection(defined_allowed_tools),
        "deploy_tools": deploy_tools,
        "approvals": {
            "deploy": (
                "required"
                if any(p.get("approvals", {}).get("deploy") == "required" for p in policies)
                else "off"
            )
        },
        "build_policy": {
            "push_review": any(
                p.get("build_policy", {}).get("push_review", False) for p in policies
            )
        },
        "budget": caps,
        "model_policy": {
            "source": nearest("model_policy", "source"),
            "user_credentials": nearest("model_policy", "user_credentials"),
        },
        # Global to this deployment, not this chain — see CONTROL_VERDICTS.
        # The console renders every badge from this key so it can never drift
        # from what `harness doctor` would print for the same field.
        "verdicts": CONTROL_VERDICTS,
    }


def validate_tightening(child: dict[str, Any], parent: dict[str, Any]) -> None:
    labels = {
        "egress_allowlist": "Egress allowlist",
        "connector_allowlist": "Connector allowlist",
        # A capability is granted top-down like any other allowlist: a child
        # cannot grant back a capability an ancestor's `allowed_tools`
        # excluded, whether that capability names a built-in effect or a
        # team tool (agents.md §7.1.1/§7.1.2 make no distinction here).
        "allowed_tools": "Allowed tools",
    }
    for field in labels:
        if field in child:
            allowed = parent.get(field)
            # An unconstrained parent cannot be widened: the first policy in a
            # chain only ever narrows, so it may name anything.
            if allowed is None:
                continue
            extra = set(child[field]) - set(allowed)
            if extra:
                item = sorted(extra)[0]
                raise ApiError(
                    422,
                    "boundary_loosens",
                    f"{labels[field]} cannot include '{item}' because the org does not allow it.",
                    {"field": field},
                )
    parent_deploy = set(parent.get("deploy_tools", []))
    child_deploy = child.get("deploy_tools")
    if child_deploy is not None:
        # Unlike an allowlist, removing a name here is the loosening
        # direction: `deploy_tools` marks what needs confirmation, so a
        # child dropping one is asking for *less* caution than the parent
        # requires.
        dropped = parent_deploy - set(child_deploy)
        if dropped:
            raise ApiError(
                422,
                "boundary_loosens",
                (
                    f"Deploy confirmation for '{sorted(dropped)[0]}' cannot be removed "
                    "because the parent requires it."
                ),
                {"field": "deploy_tools"},
            )
    if (
        parent.get("approvals", {}).get("deploy") == "required"
        and child.get("approvals", {}).get("deploy") == "off"
    ):
        raise ApiError(
            422,
            "boundary_loosens",
            "Deploy approval cannot be turned off because the parent requires it.",
            {"field": "approvals.deploy"},
        )
    if (
        parent.get("build_policy", {}).get("push_review")
        and child.get("build_policy", {}).get("push_review") is False
        and "build_policy" in child
    ):
        raise ApiError(
            422,
            "boundary_loosens",
            "Push review cannot be turned off because the parent requires it.",
            {"field": "build_policy.push_review"},
        )
    for field in ("monthly_usd_cap", "requests_per_minute"):
        parent_cap = parent.get("budget", {}).get(field)
        child_budget = child.get("budget", {})
        child_cap = child_budget.get(field)
        if parent_cap is not None and field in child_budget and child_cap > parent_cap:
            raise ApiError(
                422,
                "boundary_loosens",
                f"{field.replace('_', ' ').capitalize()} cannot exceed the parent limit.",
                {"field": f"budget.{field}"},
            )
    child_model_policy = child.get("model_policy") or {}
    parent_model_policy = parent.get("model_policy") or {}
    child_source = child_model_policy.get("source")
    parent_source = parent_model_policy.get("source")
    if (
        child_source is not None
        and parent_source is not None
        and not _MODEL_SOURCE_PROVIDES_MODEL[parent_source]
        and _MODEL_SOURCE_PROVIDES_MODEL[child_source]
    ):
        raise ApiError(
            422,
            "boundary_loosens",
            "Model source cannot provide a model because the parent's "
            'model_policy.source is "none".',
            {"field": "model_policy.source"},
        )
    child_credentials = child_model_policy.get("user_credentials")
    parent_credentials = parent_model_policy.get("user_credentials")
    if (
        child_credentials is not None
        and parent_credentials is not None
        and not _MODEL_CREDENTIALS_PERMIT_OWN[parent_credentials]
        and _MODEL_CREDENTIALS_PERMIT_OWN[child_credentials]
    ):
        raise ApiError(
            422,
            "boundary_loosens",
            "User credentials cannot be permitted because the parent's "
            'model_policy.user_credentials is "forbidden".',
            {"field": "model_policy.user_credentials"},
        )


async def ancestor_rows(connection: asyncpg.Connection, org_unit_id: Any) -> list[asyncpg.Record]:
    return await connection.fetch(
        """with recursive chain as (
             select *, 0 depth from org_units where id=$1
             union all
             select p.*, c.depth+1 from org_units p join chain c on c.parent_id=p.id
           ) select * from chain order by depth desc""",
        org_unit_id,
    )


async def effective_boundary(connection: asyncpg.Connection, org_unit_id: Any) -> dict[str, Any]:
    rows = await connection.fetch(
        """with recursive chain as (
             select id, parent_id, 0 depth from org_units where id=$1
             union all select p.id, p.parent_id, c.depth+1
             from org_units p join chain c on c.parent_id=p.id
           ) select b.policy from chain c join org_unit_boundaries b on b.org_unit_id=c.id
             order by c.depth desc""",
        org_unit_id,
    )
    return merge_boundaries([dict(row["policy"]) for row in rows])


# A team may hold a team, so a group like `interns` is an ordinary org unit:
# already a scope target, already a boundary level, already resolvable. That
# keeps one parent per node, which is what lets `resolved_assets` stay a single
# walk. A membership that cuts across teams is a different shape and is not
# this (docs/archive/scoping.md 5.4).
ROLE_PARENT = {
    "org": {None, "org"},
    "team": {"org", "team"},
    # prd-v2 §12.1: a personal account is a user directly under its org (migration 0038).
    "user": {"team", "org"},
}


async def accept_pending_invite(
    connection: asyncpg.Connection, auth_user_id: Any, email: str
) -> dict[str, Any] | None:
    invite = await connection.fetchrow(
        """select * from org_invites
           where lower(email)=lower($1) and accepted_at is null
           order by created_at limit 1
           for update""",
        email,
    )
    if not invite:
        return None
    team = await connection.fetchrow("select * from org_units where id=$1", invite["team_unit_id"])
    if not team:
        raise ApiError(404, "org_unit_not_found", "The invited team could not be found.")
    unit = await connection.fetchrow(
        """insert into org_units(parent_id,role,name,path,region)
           values($1,'user',$2,$3,$4) returning *""",
        team["id"],
        email.lower(),
        f"{team['path']}.{email_label(email)}",
        team["region"],
    )
    await connection.execute(
        "insert into org_unit_members(auth_user_id,user_unit_id) values($1,$2)",
        auth_user_id,
        unit["id"],
    )
    if invite["admin_unit_id"] is not None:
        await connection.execute(
            """insert into org_unit_admins(auth_user_id,org_unit_id,level)
               values($1,$2,$3)""",
            auth_user_id,
            invite["admin_unit_id"],
            invite["admin_level"],
        )
    await connection.execute(
        """update org_invites
              set accepted_at=now(), accepted_auth_user_id=$2
            where id=$1""",
        invite["id"],
        auth_user_id,
    )
    return dict(unit)


def validate_role_order(role: str, parent_role: str | None) -> None:
    if role not in ROLE_PARENT or parent_role not in ROLE_PARENT[role]:
        messages = {
            "org": "An org can only be created at the root or inside another org.",
            "team": "A team can only be created inside an org or another team.",
            "user": "A user can only be created inside a team.",
        }
        raise ApiError(
            422, "invalid_role_order", messages.get(role, "This org unit role is invalid.")
        )
