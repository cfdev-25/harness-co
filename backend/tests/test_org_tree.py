import pytest

from app.domain.org_tree import (
    Boundary,
    email_label,
    merge_boundaries,
    slugify,
    validate_role_order,
    validate_tightening,
)
from app.errors import ApiError


def test_boundary_merge_uses_every_strictest_rule():
    policies = [
        {
            "egress_allowlist": ["a.example", "b.example"],
            "connector_allowlist": ["slack", "drive"],
            "approvals": {"deploy": "required"},
            "load_policy": {"default": "always", "prescribed": True},
            "budget": {"monthly_usd_cap": 1000, "requests_per_minute": 100},
        },
        {
            "egress_allowlist": ["b.example"],
            "connector_allowlist": ["drive"],
            "build_policy": {"push_review": True},
            "load_policy": {"default": "on_demand", "prescribed": False},
            "budget": {"monthly_usd_cap": 500},
        },
    ]
    merged = merge_boundaries(policies)
    assert merged["egress_allowlist"] == ["b.example"]
    assert merged["connector_allowlist"] == ["drive"]
    assert merged["approvals"]["deploy"] == "required"
    assert merged["build_policy"]["push_review"] is True
    assert merged["budget"] == {"monthly_usd_cap": 500, "requests_per_minute": 100}
    assert merged["load_policy"]["default"] == "always"


def test_no_policy_anywhere_is_unconstrained_not_denied():
    """Absent is not empty.

    Nobody wrote a policy, so nothing is restricted. If this returned [] then
    switching egress enforcement on would deny every org that never set one.
    """
    merged = merge_boundaries([])
    assert merged["egress_allowlist"] is None
    assert merged["connector_allowlist"] is None
    assert merged["budget"]["monthly_usd_cap"] is None


def test_an_explicit_empty_policy_denies_everything():
    merged = merge_boundaries([{"egress_allowlist": [], "connector_allowlist": []}])
    assert merged["egress_allowlist"] == []
    assert merged["connector_allowlist"] == []


def test_a_child_may_define_what_an_unconstrained_parent_left_open():
    # The first policy in a chain only narrows, so it may name anything.
    validate_tightening({"egress_allowlist": ["a.example"]}, merge_boundaries([]))


@pytest.mark.parametrize(
    ("child", "field"),
    [
        ({"egress_allowlist": ["new.example"]}, "egress_allowlist"),
        ({"connector_allowlist": ["new"]}, "connector_allowlist"),
        ({"approvals": {"deploy": "off"}}, "approvals.deploy"),
        ({"build_policy": {"push_review": False}}, "build_policy.push_review"),
        (
            {"load_policy": {"default": "on_demand", "prescribed": True}},
            "load_policy.default",
        ),
        ({"budget": {"monthly_usd_cap": 101}}, "budget.monthly_usd_cap"),
    ],
)
def test_boundary_cannot_loosen(child, field):
    parent = {
        "egress_allowlist": ["old.example"],
        "connector_allowlist": ["old"],
        "approvals": {"deploy": "required"},
        "build_policy": {"push_review": True},
        "load_policy": {"default": "always", "prescribed": True},
        "budget": {"monthly_usd_cap": 100},
    }
    with pytest.raises(ApiError) as caught:
        validate_tightening(child, parent)
    assert caught.value.code == "boundary_loosens"
    assert caught.value.detail["field"] == field


def test_setting_one_budget_field_keeps_the_other_inherited():
    validate_tightening(
        {"budget": {"requests_per_minute": 10}},
        {"budget": {"monthly_usd_cap": 100, "requests_per_minute": 20}},
    )


def test_boundary_model_writes_capabilities_not_tool_names():
    """An admin typing a Pi name into the console still ends up with the
    server holding a capability, per agents.md §7.1.2 — a boundary that said
    `bash` says `process.exec` from the moment it is stored."""
    boundary = Boundary(allowed_tools=["bash", "slack_read"], deploy_tools=["deploy"])
    assert boundary.allowed_tools == ["process.exec", "tool.slack_read"]
    assert boundary.deploy_tools == ["tool.deploy"]


def test_allowed_tools_narrows_by_intersection_like_other_allowlists():
    merged = merge_boundaries(
        [
            {"allowed_tools": ["process.exec", "filesystem.read", "tool.deploy"]},
            {"allowed_tools": ["process.exec", "tool.deploy"]},
        ]
    )
    assert merged["allowed_tools"] == ["process.exec", "tool.deploy"]


def test_deploy_tools_grows_by_union_not_intersection():
    """Naming a tool here asks for *more* caution, so a lower level adding one
    tightens rather than loosens — the opposite direction from an allowlist."""
    merged = merge_boundaries(
        [
            {"deploy_tools": ["tool.deploy"]},
            {"deploy_tools": ["tool.migrate"]},
        ]
    )
    assert merged["deploy_tools"] == ["tool.deploy", "tool.migrate"]


def test_a_child_cannot_grant_back_an_excluded_capability():
    parent = {"allowed_tools": ["process.exec"]}
    with pytest.raises(ApiError) as caught:
        validate_tightening({"allowed_tools": ["process.exec", "filesystem.read"]}, parent)
    assert caught.value.detail["field"] == "allowed_tools"


def test_a_child_cannot_drop_a_required_deploy_confirmation():
    parent = {"deploy_tools": ["tool.deploy"]}
    with pytest.raises(ApiError) as caught:
        validate_tightening({"deploy_tools": []}, parent)
    assert caught.value.detail["field"] == "deploy_tools"
def test_model_policy_merge_is_unset_when_nobody_set_it():
    merged = merge_boundaries([])
    assert merged["model_policy"] == {"source": None, "user_credentials": None}


def test_model_policy_merge_takes_the_nearest_explicit_setter():
    policies = [
        {"model_policy": {"source": "proxied", "user_credentials": "forbidden"}},
        {},
        {"model_policy": {"user_credentials": "allowed"}},
    ]
    merged = merge_boundaries(policies)
    # Nobody below the org overrode `source`, so the org's stands.
    assert merged["model_policy"]["source"] == "proxied"
    # A team relaxed `user_credentials`; that is the nearest setter.
    assert merged["model_policy"]["user_credentials"] == "allowed"


@pytest.mark.parametrize(
    ("parent_policy", "child_policy", "field"),
    [
        (
            {"source": "none"},
            {"source": "proxied"},
            "model_policy.source",
        ),
        (
            {"source": "none"},
            {"source": "gateway"},
            "model_policy.source",
        ),
        (
            {"user_credentials": "forbidden"},
            {"user_credentials": "allowed"},
            "model_policy.user_credentials",
        ),
        (
            {"user_credentials": "forbidden"},
            {"user_credentials": "required"},
            "model_policy.user_credentials",
        ),
    ],
)
def test_model_policy_cannot_loosen_out_of_its_strictest_value(parent_policy, child_policy, field):
    with pytest.raises(ApiError) as caught:
        validate_tightening({"model_policy": child_policy}, {"model_policy": parent_policy})
    assert caught.value.code == "boundary_loosens"
    assert caught.value.detail["field"] == field


def test_model_policy_lateral_moves_are_not_loosening():
    # proxied <-> gateway, and allowed <-> required, carry no order: neither
    # widens what §5.1's other axis already permits.
    validate_tightening(
        {"model_policy": {"source": "gateway"}},
        {"model_policy": {"source": "proxied"}},
    )
    validate_tightening(
        {"model_policy": {"user_credentials": "required"}},
        {"model_policy": {"user_credentials": "allowed"}},
    )
    validate_tightening(
        {"model_policy": {"user_credentials": "allowed"}},
        {"model_policy": {"user_credentials": "required"}},
    )


def test_model_policy_may_tighten_toward_the_strictest_value():
    validate_tightening(
        {"model_policy": {"source": "none"}},
        {"model_policy": {"source": "proxied"}},
    )
    validate_tightening(
        {"model_policy": {"user_credentials": "forbidden"}},
        {"model_policy": {"user_credentials": "allowed"}},
    )


def test_names_and_role_order_are_plain_and_predictable():
    assert slugify(" Finance & Ops! ") == "finance-ops"
    validate_role_order("team", "org")
    # A team inside a team is now legal (docs/scoping.md 5.4); a team inside a
    # user is not, and that is what keeps the order meaningful.
    with pytest.raises(ApiError):
        validate_role_order("team", "user")


def test_email_labels_stay_distinct_where_slugify_collided():
    """`path` is unique-indexed, so a collision blocks onboarding entirely."""
    assert email_label("corbfurrer@gmail.com") != email_label("corb.furrer@gmail.com")
    assert email_label("a@b.com") == "a-at-b-com"
    # Team and org names keep the simpler rule.
    assert slugify("Marketing Team") == "marketing-team"


def test_a_team_may_hold_a_team():
    """A sub-unit is how a group like `interns` gets scoped to in one click.

    It is an ordinary org unit, so nothing else has to learn about it: scope
    targets, boundary merging and resolution already handle any unit.
    """
    validate_role_order("team", "team")
    validate_role_order("team", "org")


def test_a_user_still_belongs_only_to_a_team():
    with pytest.raises(ApiError) as caught:
        validate_role_order("user", "org")
    assert caught.value.code == "invalid_role_order"
