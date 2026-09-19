"""The canonical, agent-agnostic tool vocabulary (agents.md §7.1.2).

`org_unit_boundaries.policy` used to store `allowed_tools`/`deploy_tools` as
whatever an agent happened to call its own tools — "bash", "read", "edit".
That is the agent's private vocabulary, not the server's: an admin typing
"bash" was really asking for "no shelling out", a fact Claude Code cannot
read off a word it has never heard. A capability names the *effect*
instead — `filesystem.read`, `process.exec` — which is identical on every
agent, so the boundary survives an agent swap unchanged.
"""

# Pi's seven built-in tool names (the hardcoded `builtins` list that used to
# live in `adapters/pi.ts`) — frozen here, not grown. This dict exists to
# explain what *already-stored* data meant before this vocabulary existed; a
# future agent's tool names never enter it; they render *from* a capability,
# in that agent's own adapter, never the other way around.
_BUILTIN_CAPABILITY: dict[str, str] = {
    "read": "filesystem.read",
    "grep": "filesystem.read",
    "find": "filesystem.read",
    "ls": "filesystem.read",
    "edit": "filesystem.write",
    "write": "filesystem.write",
    "bash": "process.exec",
}

# The finite set every agent can imply from its own built-ins. `tool.<name>`
# and `connector.<name>` are not listed here because they are parameterized
# by an asset that already exists (kind 'tool' / 'connection') — there is
# nothing fixed to enumerate.
FIXED_CAPABILITIES = frozenset(
    {"filesystem.read", "filesystem.write", "process.exec", "network.fetch"}
)


def to_capability(name: str) -> str:
    """Translate one boundary entry into the capability vocabulary.

    Idempotent, so a value that is already capability-shaped (this ran
    before, or an admin typed a capability directly) passes through
    unchanged rather than picking up a second `tool.` prefix. Everything
    that is not one of Pi's seven built-ins and not already a capability is
    a team-tool or connector name, and becomes `tool.<name>` unchanged
    apart from the prefix — the identical rule 0025's data migration applies
    to rows written before this function existed.
    """
    if name in FIXED_CAPABILITIES or name.startswith("tool.") or name.startswith("connector."):
        return name
    return _BUILTIN_CAPABILITY.get(name, f"tool.{name}")
