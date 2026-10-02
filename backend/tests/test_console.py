"""03 §12 tier V1: the console's pure functions, in process.

These are the rules that decide what a cell says — the sentence table, the
edge labels, the preflight rule's two halves, the owner word, the Differences
classification and the cursor. None of them needs a database, and each of them
is a place where two screens could otherwise disagree.
"""

import re
from pathlib import Path

from app.domain import console
from app.domain.sentences import FAILURES, FALLBACKS, MISSING_FIELDS, SCALES, SENTENCES, sentence

APP = Path(__file__).resolve().parents[1] / "app"
# Engine 04 §8's table, which `audit.py` does not spell out in one place.
ENGINE_ACTIONS = {
    "session.open", "session.refuse", "session.revoke", "session.retire",
    "session.endpoint", "session.close",
}
# Written by `definitions` onto the org's chain through /v1/internal/audit.
DEFINITIONS_ACTIONS = {"definitions.push", "definitions.commit", "definitions.reindex"}
# Engine 02 §8.2's complete edge vocabulary.
RELS = {
    "placed_on", "includes", "needs_alias", "entry", "entry_secret", "entry_upstream",
    "grants", "reach", "scoped_to", "only_for", "narrowed_from", "credential",
    "default_for", "approved_for", "speaks", "exposes",
}


def _actions_in_code() -> set[str]:
    found = set()
    for path in APP.rglob("*.py"):
        found |= set(re.findall(r'action="([a-z_][a-z_.]*)"', path.read_text()))
    return found


def test_every_action_has_a_sentence():
    """03 §15: `SENTENCES` covers every action string in the code and in
    engine 04 §8. A log row with no template is a row nobody can read."""
    missing = (_actions_in_code() | ENGINE_ACTIONS | DEFINITIONS_ACTIONS) - set(SENTENCES)
    assert missing == set(), f"no sentence template for {sorted(missing)}"


def test_sentence_for_every_action():
    """The same coverage, exercised: every template renders words."""
    for action in SENTENCES:
        assert sentence(action, {"actor": "Dana Okafor"}).strip()


def test_sentence_fallbacks_never_empty():
    """03 §6: a missing payload field renders the fallback and increments a
    metric — never an empty sentence, never a stack."""
    MISSING_FIELDS.clear()
    for action, (_, template) in SENTENCES.items():
        line = sentence(action, {})
        assert line and "{" not in line and "}" not in line, action
        for field in re.findall(r"\{(\w+)\}", template):
            assert field in FALLBACKS, f"{action} needs a fallback for {field}"
    assert MISSING_FIELDS, "a fallback was taken and nothing counted it"


def test_every_action_carries_a_category():
    """PRD §19 has four logs; `session.endpoint` alone feeds `/endpoints`."""
    for action, (category, _) in SENTENCES.items():
        assert category in (None, "harness", "permission", "provider", "people"), action
    assert SENTENCES["session.endpoint"][0] is None


def test_every_rel_has_a_via_label():
    """03 §5: a `rel` without a label is a test failure."""
    assert RELS - set(console.VIA) == set()
    assert set(console.VIA) - RELS == set()


def test_owner_from_path():
    """PRD §17.1's owner word, from the branch the winning copy came from."""
    teams = ["acme.marketing"]
    assert console.owner_from_path("acme", "acme", teams, "acme.marketing.jo") == "org"
    assert console.owner_from_path("acme.marketing", "acme", teams, "acme.marketing.jo") == "team"
    assert console.owner_from_path("acme.marketing.jo", "acme", teams,
                                   "acme.marketing.jo") == "you"
    assert console.owner_from_path("acme.marketing.rae", "acme", teams,
                                   "acme.marketing.jo") == "member:rae"


def test_differs_classification():
    """03 D32: `conflict` only when the last session's composed tree agrees
    with neither side; otherwise `both`."""
    mine, theirs = {"a": "t1", "b": "t2", "c": "t3"}, {"a": "t1", "b": "t9", "d": "t4"}
    assert console.differs(mine, theirs, None) == {"b": "both", "c": "yours-only",
                                                   "d": "theirs-only"}
    assert console.differs(mine, theirs, "t7")["b"] == "conflict"
    assert console.differs(mine, theirs, "t2")["b"] == "both"


def test_preflight_dry_check_three_clauses():
    """03 P-1 (b) of the dry check: all three clauses must hold."""
    model = {"id": "anthropic", "endpoints": {"anthropic-messages": "https://x"}}
    provider = {"id": "pi", "approval": "approved", "speaks": ["anthropic-messages"]}
    groups = {"marketing": {"entries": [{"alias": "crm"}]}}
    grants = [{"id": "g", "group": "marketing"}]
    asset = {"sidecar": {"needs": [{"kind": "credential", "alias": "crm"}]}}
    assert console.dry_check([asset], model, [provider], grants, groups) is True
    # (a) no shared wire format between the runtime and the model provider.
    assert console.dry_check([asset], model, [{"id": "x", "approval": "approved",
                                               "speaks": ["openai-chat"]}], grants, groups) is False
    # (b) a loaded asset speaks a format outside the intersection.
    odd = {"sidecar": {"format": "openai-chat"}}
    assert console.dry_check([odd], model, [provider], grants, groups) is False
    # (c) an alias no covering grant's group has an entry for.
    hungry = {"sidecar": {"needs": [{"kind": "credential", "alias": "email"}]}}
    assert console.dry_check([hungry], model, [provider], grants, groups) is False


def test_cursor_roundtrip():
    assert console.decode_cursor(console.encode_cursor("triage", "abc")) == ("triage", "abc")


def test_pagination_cursor_is_opaque():
    """03 §4: keyset on `(sort_key, id)`, never `?page=`, and `next` is absent
    on the last page."""
    rows = [{"name": f"a{index}", "id": str(index)} for index in range(5)]
    first = console.page(rows, 2, None)
    assert [row["name"] for row in first["items"]] == ["a0", "a1"]
    assert first["next"] and "a1" not in first["next"]
    second = console.page(rows, 2, first["next"])
    assert [row["name"] for row in second["items"]] == ["a2", "a3"]
    assert console.page(rows, 200, second["next"])["next"] is None


def test_bad_cursor_is_a_422():
    import pytest

    from app.errors import ApiError
    with pytest.raises(ApiError) as caught:
        console.decode_cursor("not-a-cursor-we-issued")
    assert caught.value.status_code == 422


def test_parse_diff_makes_hunks():
    text = "--- a\n+++ b\n@@ -1,2 +1,2 @@\n-old\n+new\n keep\n"
    hunks = console.parse_diff(text)
    assert len(hunks) == 1 and hunks[0]["header"].startswith("@@")
    assert [line["kind"] for line in hunks[0]["lines"]] == ["del", "add", "ctx"]
    assert console.tally(hunks) == (1, 1)


def test_every_403_names_decider():
    """P13: every 403 body names who decides, and carries a remedy."""
    for code, (status, message, remedy) in FAILURES.items():
        if status != 403:
            continue
        assert re.search(r"admin", message), f"{code} does not name who decides"
        assert remedy or code == "request.not_author"


def test_scale_registry_is_the_whole_list():
    """K4/00 §4.6: thirteen scales, and every tag links to its own anchor.
    `providerStatus` is W6-D6's — the Providers table's *Reachable* column
    became a scale, because *unreachable* and *needs a key* send a person to
    two different places."""
    assert set(SCALES) == {
        "approval", "source", "evidence", "slot", "reach", "holds", "loads", "role",
        "request", "session", "preflight", "providerStatus", "provenance"}
    for scale_id, entry in SCALES.items():
        assert entry["href"] == f"/console/how#{scale_id}"
        assert entry["values"] and all(
            value["tone"] in ("ok", "hold", "warn", "accent", "neutral")
            for value in entry["values"])


def test_related_all_teams_is_a_word_not_a_list():
    """P4: `all: true` renders *All teams*, never a repeated list."""
    assert console.team_related(["all"]) == {"unit": "teams", "items": [], "all": True}
    assert console.team_related(["acme.marketing"])["all"] is None
