import re
from typing import Any, Literal

import asyncpg
from pydantic import BaseModel, ConfigDict, Field

from app.errors import ApiError


class Approvals(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deploy: Literal["required", "off"] | None = None


class LoadPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default: Literal["on_demand", "always"] = "on_demand"
    prescribed: bool = False


class BuildPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    push_review: bool = False


class Budget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    monthly_usd_cap: float | None = Field(default=None, ge=0)
    requests_per_minute: int | None = Field(default=None, ge=0)


class Boundary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    egress_allowlist: list[str] | None = None
    connector_allowlist: list[str] | None = None
    approvals: Approvals | None = None
    load_policy: LoadPolicy | None = None
    build_policy: BuildPolicy | None = None
    budget: Budget | None = None


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", value.lower()))
    return re.sub(r"-+", "-", cleaned).strip("-")


def merge_boundaries(policies: list[dict[str, Any]]) -> dict[str, Any]:
    defined_egress = [set(p["egress_allowlist"]) for p in policies if "egress_allowlist" in p]
    defined_connectors = [
        set(p["connector_allowlist"]) for p in policies if "connector_allowlist" in p
    ]

    def intersection(values: list[set[str]]) -> list[str]:
        return sorted(set.intersection(*values)) if values else []

    caps: dict[str, float | int | None] = {}
    for field in ("monthly_usd_cap", "requests_per_minute"):
        values = [
            p["budget"][field] for p in policies if p.get("budget", {}).get(field) is not None
        ]
        caps[field] = min(values) if values else None

    prescribed = next(
        (
            p["load_policy"]
            for p in reversed(policies)
            if p.get("load_policy", {}).get("prescribed") is True
        ),
        None,
    )
    own_load = next((p["load_policy"] for p in reversed(policies) if "load_policy" in p), None)
    return {
        "egress_allowlist": intersection(defined_egress),
        "connector_allowlist": intersection(defined_connectors),
        "approvals": {
            "deploy": (
                "required"
                if any(p.get("approvals", {}).get("deploy") == "required" for p in policies)
                else "off"
            )
        },
        "load_policy": prescribed or own_load or {"default": "on_demand"},
        "build_policy": {
            "push_review": any(
                p.get("build_policy", {}).get("push_review", False) for p in policies
            )
        },
        "budget": caps,
    }


def validate_tightening(child: dict[str, Any], parent: dict[str, Any]) -> None:
    labels = {
        "egress_allowlist": "Egress",
        "connector_allowlist": "Connector",
    }
    for field in labels:
        if field in child:
            extra = set(child[field]) - set(parent.get(field, []))
            if extra:
                item = sorted(extra)[0]
                raise ApiError(
                    422,
                    "boundary_loosens",
                    (
                        f"{labels[field]} allowlist cannot include '{item}' "
                        "because the org does not allow it."
                    ),
                    {"field": field},
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
    parent_load = parent.get("load_policy", {})
    child_load = child.get("load_policy")
    if (
        parent_load.get("prescribed")
        and child_load is not None
        and child_load.get("default") != parent_load.get("default")
    ):
        raise ApiError(
            422,
            "boundary_loosens",
            "Load policy cannot change because the parent prescribes it.",
            {"field": "load_policy.default"},
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


ROLE_PARENT = {
    "org": {None, "org"},
    "team": {"org"},
    "user": {"team"},
}


def validate_role_order(role: str, parent_role: str | None) -> None:
    if role not in ROLE_PARENT or parent_role not in ROLE_PARENT[role]:
        messages = {
            "org": "An org can only be created at the root or inside another org.",
            "team": "A team can only be created inside an org.",
            "user": "A user can only be created inside a team.",
        }
        raise ApiError(
            422, "invalid_role_order", messages.get(role, "This org unit role is invalid.")
        )
