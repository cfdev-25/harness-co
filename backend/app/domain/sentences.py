"""Every word the console prints that is not a person's own data.

Three tables, each the *only* place its words are written (console 03 K6):

* `SENTENCES` — one template per audit action (03 §6). A log row's sentence is
  built here and nowhere else, so two screens cannot describe one act two ways.
* `FAILURES` — the console's refusals (03 §11), in `broker.BLOCKERS`' shape:
  `code → (status, message, remedy)`. Every `403` names who decides (P13).
* `SCALES` — the scale registry (00 §4.6, 05 §4), served by `/v1/console/how`
  so the CLI and the console print identical words (03 D36, P14).

British spelling throughout (05 R9). Templates are `str.format_map`'d against
a mapping that answers a missing field with `FALLBACKS`, so an incomplete
payload renders the row with a plain word and never an empty sentence or a
stack (03 §6).
"""

from typing import Any

# --- 1. Log sentences (03 §6) ----------------------------------------------

# action → (category, template). `None` as a category means the action feeds a
# screen but is never a log row: `session.endpoint` is `/endpoints`' input.
SENTENCES: dict[str, tuple[str | None, str]] = {
    # Sessions — engine 04 §8.
    "session.open": ("harness", "{actor} started {harness} on {provider} · {model}"),
    "session.refuse": ("harness", "{actor} could not start {harness}: {blocker}"),
    "session.revoke": ("harness", "{actor}'s session on {harness} was ended: {reason}"),
    "session.retire": ("harness", "the {alias} credential was rotated during {actor}'s session"),
    "session.close": (
        "harness",
        "{actor} closed {harness} · {n} endpoints reached · {refused} refused",
    ),
    "session.endpoint": (None, "{actor} reached {host}"),
    # Assets and harnesses.
    "asset.push": ("harness", "{actor} kept a change to {kind} {name}"),
    "asset.promote": ("harness", "{actor} promoted {kind} {name} to {team}"),
    "asset.rollback": ("harness", "{actor} rolled {kind} {name} back to {date}"),
    "asset.approve": ("harness", "{actor} accepted {kind} {name}"),
    "asset.create": ("harness", "{actor} added {kind} {name}"),
    "asset.status": ("harness", "{actor} set {kind} {name} to {status}"),
    "asset.harnesses": ("harness", "{actor} changed which harnesses hold {kind} {name}"),
    "asset.scopes": ("permission", "{actor} changed which teams {kind} {name} reaches"),
    "asset.edit": ("harness", "{actor} edited {kind} {name}"),
    "asset.delete": ("harness", "{actor} removed {kind} {name}"),
    "harness.create": ("harness", "{actor} created the harness {name}"),
    "harness.update": ("harness", "{actor} changed the harness {name}"),
    "harness.delete": ("harness", "{actor} deleted {name} ({n} things were in it)"),
    "harness.assets": ("harness", "{actor} changed what the harness {name} holds"),
    # W5-D15, the store's write: `n` things were added to the person's version
    # of a harness, which may include a preset copied onto their branch.
    "harness.add_assets": ("harness", "{actor} added {n} to {harness}"),
    "resolve": ("harness", "{actor} composed what they hold"),
    # Requests.
    "request.open": ("harness", '{actor} offered {n} files to {team}: "{title}"'),
    "request.accept": ("harness", '{actor} accepted "{title}" from {author} into {team}'),
    "request.decline": ("harness", '{actor} declined "{title}": {reason}'),
    "request.withdraw": ("harness", '{actor} withdrew "{title}"'),
    # Permissions.
    "grant.create": ("permission", "{actor} granted {group} to {teams}"),
    "grant.narrow": ("permission", "{actor} narrowed {group} into {team}: {aliases}"),
    "grant.remove": ("permission", "{actor} took {group} back from {teams}"),
    "boundary.set": ("permission", "{actor} added a boundary for {scope}: {value}"),
    "boundary.remove": ("permission", "{actor} lifted a boundary for {scope}: {value}"),
    "boundary.update": ("permission", "{actor} changed the boundaries at {team}"),
    # Reach (W5 D131). One row per verb the screen has, so the log reads as the
    # screen does: the mode, a host added, a host taken away.
    "reach.set": ("permission", "{actor} set reach at {team} to {mode} ({n} hosts)"),
    "reach.allow_host": ("permission", "{actor} let {team} reach {host}"),
    "reach.deny_host": ("permission", "{actor} stopped {team} reaching {host}"),
    "vault.connect": ("permission", "{actor} connected {vault}"),
    "group.create": ("permission", "{actor} created the security group {group} ({n} entries)"),
    "key.rotate": ("permission", "{actor} rotated {name}"),
    "api_key.rotate": ("permission", "{actor} rotated {name}"),
    "api_key.create": ("permission", "{actor} added the key {name}"),
    "api_key.deliver": ("permission", "{actor} was handed the key {name}"),
    # Providers.
    "provider.approve": ("provider", "{actor} approved {provider} for {scope}"),
    "provider.beta": ("provider", "{actor} moved {provider} to beta for {scope}"),
    "provider.decline": ("provider", "{actor} declined {provider}: {reason}"),
    "routing.change": ("provider", "{actor} set {model_provider} as default for {target}"),
    "provider.key_setup": ("provider", "{actor} connected a key for {provider} for {scope}"),
    # W6-D5: a model provider is the organization's, so it can be taken away
    # again. The row says what it was holding when it went.
    "provider.delete": ("provider", "{actor} removed the model provider {provider}"),
    # People.
    "member.add": ("people", "{actor} added {person} to {team}"),
    "member.invite": ("people", "{actor} invited {email} to {team}"),
    "member.invite_accept": ("people", "{email} accepted the invitation to {team}"),
    "member.invite_revoke": ("people", "{actor} withdrew the invitation to {email}"),
    "member.remove": ("people", "{actor} removed {person} from {team} ({n} groups lost)"),
    "member.role": ("people", "{actor} made {person} a {role} at {team}"),
    "org.create": ("people", "{actor} created the organization {name}"),
    "org.seed": (
        "provider",
        "{actor} seeded the organization's catalogue: {runtimes} runtimes, "
        "{providers} model providers",
    ),
    "org_unit.create": ("people", "{actor} created {name} inside {team}"),
    "console.read_as": ("people", "{actor} read {person}'s versions"),
    # `definitions` writes these onto the org's chain through /v1/internal/audit
    # (engine 02 §12); they are the git-backed rows the log expands to a diff.
    "definitions.push": ("harness", "{actor} pushed {n} files to {ref}"),
    "definitions.commit": ("harness", "{actor} committed {n} files to {ref}"),
    "definitions.reindex": ("permission", "the index was rebuilt over {n} chains"),
}

# Every action whose row can be expanded to a diff (03 §6's *git-backed* column).
GIT_BACKED = {
    "asset.push", "asset.promote", "asset.rollback", "asset.approve",
    "asset.edit", "asset.delete",
    "request.open", "request.accept", "harness.create", "harness.delete",
    "harness.add_assets",
    "grant.create", "grant.narrow", "grant.remove", "boundary.set",
    "boundary.remove", "reach.set", "reach.allow_host", "reach.deny_host",
    "group.create", "provider.approve", "provider.beta",
    "provider.decline", "provider.delete", "provider.key_setup", "org.seed", "routing.change",
    "definitions.push", "definitions.commit",
}

# 03 §6: *a payload field the template needs that is absent renders the row with
# the template's fallback*. Plain words, never a placeholder or an empty string.
FALLBACKS: dict[str, str] = {
    "actor": "someone",
    "alias": "a credential",
    "aliases": "nothing",
    "author": "its author",
    "blocker": "the organization's rules refused it",
    "date": "an earlier version",
    "email": "someone",
    "group": "a security group",
    "harness": "a harness",
    "host": "an endpoint",
    "kind": "a file",
    "model": "a model",
    "mode": "a setting",
    "model_provider": "a model provider",
    "n": "some",
    "name": "it",
    "person": "someone",
    "provider": "a provider",
    "providers": "some",
    "reason": "no reason was given",
    "ref": "a branch",
    "refused": "0",
    "role": "a member",
    "runtimes": "some",
    "scope": "its scope",
    "status": "a state",
    "target": "it",
    "teams": "their teams",
    "team": "their team",
    "title": "a request",
    "value": "a value",
    "vault": "a vault",
}

# 03 §6: *… and increments a metric*. Counted here, read by the V1 test.
MISSING_FIELDS: dict[str, int] = {}


class _Fallback(dict):
    def __missing__(self, key: str) -> str:
        MISSING_FIELDS[key] = MISSING_FIELDS.get(key, 0) + 1
        return FALLBACKS.get(key, "something")


def category_of(action: str) -> str | None:
    entry = SENTENCES.get(action)
    return entry[0] if entry else None


def sentence(action: str, fields: dict[str, Any]) -> str:
    """The one place a log row's words are made (K6)."""
    entry = SENTENCES.get(action)
    if entry is None:
        MISSING_FIELDS[action] = MISSING_FIELDS.get(action, 0) + 1
        return f"{fields.get('actor') or FALLBACKS['actor']} did something we have no words for"
    values = {key: value for key, value in fields.items() if value not in (None, "")}
    return entry[1].format_map(_Fallback(values))


# --- 2. Console failures (03 §11) ------------------------------------------

# code → (status, message, remedy). Formatted with the route's own fields.
FAILURES: dict[str, tuple[int, str, str]] = {
    "console.scope_forbidden": (
        403,
        "This view belongs to {team}; its admins and organization admins can open it.",
        "Ask a {team} admin, or open your own view.",
    ),
    "console.as_forbidden": (
        403,
        "You can read a member's versions only for teams you administer.",
        "Pick a member of {teams}.",
    ),
    "console.harness_not_found": (
        404,
        "No harness with that id is on your chain.",
        "`harness switch` lists yours.",
    ),
    "console.file_not_found": (
        404,
        "{path} is not in this harness for you.",
        "Open the harness and pick a file.",
    ),
    "console.hidden": (
        200,
        "An organization admin has turned this view off.",
        "Ask an organization admin.",
    ),
    "console.definitions_unavailable": (
        503,
        "File contents are unavailable right now; the rest of the page is current.",
        "Try again in a moment.",
    ),
    "console.index_stale": (
        200,
        "The index is behind the repository since {since}.",
        "Nothing to do; it catches up on its own.",
    ),
    "session.not_visible": (404, "No such session in your view.", ""),
    "request.not_visible": (404, "No such request in your view.", ""),
    "console.not_found": (404, "No such {what} in your view.", ""),
}

# The sentence `HiddenView` renders in place of a list (P10; 05 §8 `HIDDEN`).
HIDDEN = {
    "boundaries": "An organization admin has turned off your view of boundaries.",
    "logs": "An organization admin has turned off your view of the logs.",
    # W5-D15: `visibility.store` off. What the person already holds is
    # untouched — only the place to pick more from is closed.
    "store": "An organization admin has turned off browsing for more assets.",
}

# Engine C18, console 04 §6: a harness may name an id that nothing on this
# chain answers. The row is shown with this note and no owner — never hidden,
# and never a 404, because the assignment is real and the file is not.
UNANSWERED = "This id is assigned but nothing answers it on your chain."


# --- 3. The scale registry (00 §4.6, 05 §4) --------------------------------

def _scale(label: str, *values: tuple[str, str, str]) -> dict[str, Any]:
    return {
        "label": label,
        "values": [{"value": v, "tone": t, "meaning": m} for v, t, m in values],
    }


SCALES: dict[str, dict[str, Any]] = {
    "approval": _scale(
        "Approval",
        ("approved", "ok",
         "Anyone this runtime is scoped to may run it and be handed credentials with it."),
        ("beta", "hold",
         "Anyone scoped to it may run it, but only an admin is handed credentials with it — "
         "the state for trying a build before committing to it."),
        ("not-approved", "warn",
         "Nobody may run it. A deliberate no, recorded with its reason so the next person "
         "sees it was decided."),
    ),
    "source": _scale(
        "Comes from",
        ("vault-supplied", "accent",
         "We resolve it from a key vault when the session starts, can confirm it beforehand, "
         "and can stop supplying it."),
        ("locally-owned", "neutral",
         "A sign-in or machine login the person made. We never hold it, cannot hand it to a "
         "harness, and only learn of it once the session is up."),
    ),
    "evidence": _scale(
        "Evidence",
        ("verified", "ok", "The platform confirmed it itself, just now."),
        ("harness-reported", "hold", "The runtime says so; we did not check it ourselves."),
        ("declared", "neutral", "Expected and unobserved. Nothing here rounds up."),
    ),
    "slot": _scale(
        "Slot",
        ("satisfied", "ok", "This need was met before the session started."),
        ("unsatisfied", "warn",
         "This need was not met and the session will not start until it is. The row says "
         "what to do."),
        ("deferred", "hold",
         "It cannot be checked before launch — a sign-in the runtime holds, or a local login "
         "the group permits — so it is checked once the session is up and never counted as "
         "satisfied."),
    ),
    "reach": _scale(
        "Outside endpoints",
        ("prohibited", "ok",
         "The harness reaches only what it was granted: its credentialed endpoints and its "
         "model provider. The strong claim."),
        ("allowed", "hold",
         "The harness may reach anything not on a boundary. The agent still cannot cross a "
         "boundary; the claim is weaker and the tag says so."),
    ),
    "holds": _scale(
        "Holds",
        ("enforced", "ok",
         "There is no route, no permission, or the binary is not there. It holds whatever the "
         "agent tries."),
        ("intercepted", "hold",
         "Every invocation is checked before it runs. It holds against the thing attempted "
         "directly, not the same thing written another way."),
    ),
    # W5-D10's three states, in order of how much they decide for the person.
    "loads": _scale(
        "How it loads",
        ("required", "accent",
         "Into every session, and no harness can leave it out. Where a compliance rule "
         "belongs. It cannot be deleted while it is required."),
        ("recommended", "hold",
         "Every new harness starts with it, and whoever owns that harness may take it out "
         "again. A good default, not a rule."),
        ("on-request", "neutral",
         "Published and available; whoever builds the harness includes it."),
    ),
    "role": _scale(
        "Role",
        ("member", "neutral",
         "Uses what they are given, offers changes, creates their own harnesses, reads every "
         "log about themselves."),
        ("team-admin", "accent",
         "Everything a member may, and may narrow what the team holds: sub-teams, narrower "
         "grants, boundaries for the team and below, accepting requests. Widens nothing."),
        ("org-admin", "accent",
         "Everything. Approves runtimes, connects vaults, creates groups, appoints admins, "
         "sets what a person may see."),
    ),
    "request": _scale(
        "Request",
        ("open", "hold", "Waiting on a team admin."),
        ("closed", "neutral",
         "Decided — accepted, declined or withdrawn — with the reason kept."),
    ),
    "session": _scale(
        "Session",
        ("active", "ok", "Running now, on the credentials it was minted."),
        ("revoked", "warn",
         "Ended by the platform: a policy that covered it changed, or an admin revoked it. "
         "The reason is on the session."),
        ("closed", "neutral", "Ended by the person."),
    ),
    "preflight": _scale(
        "Preflight",
        ("passing", "ok",
         "Every check that runs before a session passed the last time it ran, or would pass now."),
        ("failing", "warn",
         "Something stops it starting. The harness's own page names the cause and links to the "
         "thing to change."),
    ),
    # W6-D6. Three states a person can act on, and each names who acts: a key
    # to connect, or an endpoint to wait for. *Reachable* said neither.
    "providerStatus": _scale(
        "Status",
        ("set-up", "ok",
         "A security group holds a key for it and its endpoint answered just now. Sessions can "
         "be routed here."),
        ("needs-key", "warn",
         "No security group holds a key for it, so nothing is routed to it, no runtime can run "
         "on it and a session aimed at it is refused. *Set up* connects one."),
        # W7-D2. Not a warning: nothing is missing. The runtime has its own
        # login for this provider, so the session runs on the person's own
        # sign-in and is not metered.
        ("sign-in", "accent",
         "Pi signs in to this provider itself (`/login`); add a key to route it through the "
         "harness."),
        ("unreachable", "hold",
         "A key is held, but the endpoint did not answer within three seconds. Routing stands; "
         "a session will fail until it answers."),
    ),
    "provenance": _scale(
        "Provenance",
        ("declared", "neutral", "An admin typed it. Set by a person, in a commit with an author."),
        ("observed", "ok", "Checked as this screen drew, and stored nowhere."),
        ("derived", "accent",
         "Computed from what is granted, denied and included. Nobody wrote it."),
    ),
}

for _id, _entry in SCALES.items():
    _entry["href"] = f"/console/how#{_id}"
