import pytest

from app.domain.org_tree import merge_boundaries, slugify, validate_role_order, validate_tightening
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


def test_boundary_defaults_deny_access():
    merged = merge_boundaries([])
    assert merged["egress_allowlist"] == []
    assert merged["connector_allowlist"] == []
    assert merged["budget"]["monthly_usd_cap"] is None


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


def test_names_and_role_order_are_plain_and_predictable():
    assert slugify(" Finance & Ops! ") == "finance-ops"
    validate_role_order("team", "org")
    with pytest.raises(ApiError):
        validate_role_order("team", "team")
