from app.domain.capabilities import FIXED_CAPABILITIES, to_capability


def test_a_pi_builtin_becomes_the_capability_it_implies():
    assert to_capability("bash") == "process.exec"
    assert to_capability("read") == "filesystem.read"
    assert to_capability("edit") == "filesystem.write"


def test_a_team_tool_name_is_unchanged_apart_from_the_prefix():
    assert to_capability("deploy") == "tool.deploy"
    assert to_capability("slack_read") == "tool.slack_read"


def test_translation_is_idempotent():
    """A value that already went through translation (or was typed straight
    into the console as a capability) must not pick up a second prefix."""
    for capability in FIXED_CAPABILITIES:
        assert to_capability(capability) == capability
    assert to_capability("tool.deploy") == "tool.deploy"
    assert to_capability("connector.slack") == "connector.slack"
