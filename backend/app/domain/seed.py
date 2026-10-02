"""The catalogue a new organisation starts with (engine D30h, D146, D147).

*Not approved is a state, not an absence* (prd-v2 §9.1): an organisation's
provider tables are rows from the moment it exists, so the console's first
screen is a catalogue with switches rather than an empty table nobody can act
on. The rows come from `engine/compose/presets/`, which is the only home of a
default (01 §4.2) — this module, the exporter and the CLI read those files and
none holds a list.

**The list is `presets/index.json`** (W6-D1). Its `defaults` say, per entry,
what the default is (`path`), how it is **managed** — `required` (the harness
cannot run without it and nobody may remove it), `recommended` (seeded and
then fully the organisation's), `suggested` (never seeded, offered on a
screen) — and which console screen manages it. This module walks that list; it
names no preset file except to say which of the two `reach-default-*` entries
an edition takes. A default that is not in the manifest is not seeded, and
`scripts/check-defaults.py` fails on a file under `presets/` that no entry
names.

Two callers, two shapes: `seed_policy` is path → body, which the exporter
merges into the tree it is already building, and `seed_files` wraps the same
bodies as `writes.commit` changes for `POST /v1/orgs`. `seed_assets` is the
same over D30j's built-in asset directories, whose files are bytes rather than
bodies — a `SKILL.md` is not JSON.

Filling is **by id, never by overwrite**. A migrated organisation keeps the
`anthropic` row its records held, credential and all; the seed only adds the
ids that are not there yet.
"""

import base64
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from app.domain import writes
from app.errors import ApiError

Edition = Literal["enterprise", "personal"]

# The monorepo layout. A split deploy that ships `api` without the checkout
# sets HARNESS_PRESETS_DIR (build-decisions.md 2026-09-26).
PRESETS = Path(__file__).resolve().parents[3] / "engine" / "compose" / "presets"

NOT_REVIEWED = "Not yet reviewed by an organisation admin."

# W5-D1c/D135 as data (W6-D1): the two reach defaults are files, and the
# edition picks one. The only place this module still names a preset.
REACH_DEFAULT = "reach-default-"

SEEDED = ("required", "recommended")


def presets(name: str) -> Any:
    """One preset file's body. Fail closed like `definitions_unconfigured`: a
    deployment that cannot find its catalogue seeds nothing, rather than an
    organisation nobody can start a session in."""
    path = Path(os.environ.get("HARNESS_PRESETS_DIR") or PRESETS) / name
    try:
        return json.loads(path.read_text())
    except OSError as exc:
        raise ApiError(
            503,
            "presets_unconfigured",
            "The provider catalogue is not readable, so nothing can be created yet.",
            {"file": name},
            remedy="An operator sets HARNESS_PRESETS_DIR to the presets directory.",
        ) from exc


def manifest() -> list[dict[str, Any]]:
    """W6-D1's `defaults`: every out-of-the-box behaviour, in one list."""
    return list(presets("index.json")["defaults"])


def defaults(*managed: str) -> list[dict[str, Any]]:
    """The manifest entries with one of these `managed` words, in manifest order."""
    return [entry for entry in manifest() if entry["managed"] in managed]


def _body(entry: dict[str, Any]) -> Any:
    """A manifest entry's file, with the one indirection a preset may use (01
    §4.2) resolved: a value spelled `@<id>` is that entry's own file.

    **No preset uses it today.** `reach-default-personal.json` did — it was
    `reach-suggested.json` with a mode — until W7-D4 (D155) made the personal
    default `{"mode": "on", "hosts": []}` so a harness's *Web access* switch
    has an `on` to narrow from. The resolution stays here, and the checker
    keeps testing any `@` it finds, so the next default that *is* another
    entry with a field on it says so rather than copying it."""
    body = presets(entry["path"])
    if not isinstance(body, dict):
        return body
    by_id = {other["id"]: other for other in manifest()}
    out = {}
    for key, value in body.items():
        if isinstance(value, str) and value.startswith("@"):
            named = by_id.get(value[1:])
            if named is None:
                raise ApiError(
                    503,
                    "presets_unconfigured",
                    "The provider catalogue names a default that does not exist.",
                    {"file": entry["path"], "reference": value},
                    remedy="An operator checks engine/compose/presets/index.json.",
                )
            value = presets(named["path"])
        out[key] = value
    return out


def _branch_path(entry: dict[str, Any]) -> str:
    """Where a policy entry lands on a new organisation's org branch: its own
    file name under `policy/`, except the two reach defaults, which are the one
    file `policy/reach.json` the edition picks between (W5-D1c)."""
    if entry["id"].startswith(REACH_DEFAULT):
        return "policy/reach.json"
    return f"policy/{entry['path'].rsplit('/', 1)[-1]}"


def _policy_defaults(edition: Edition) -> list[dict[str, Any]]:
    """The manifest's seeded policy files for this edition: every `required` or
    `recommended` entry that is not an asset directory, with the other
    edition's reach default left out."""
    return [
        entry
        for entry in defaults(*SEEDED)
        if not entry["path"].startswith("assets/")
        and (
            not entry["id"].startswith(REACH_DEFAULT)
            or entry["id"] == f"{REACH_DEFAULT}{edition}"
        )
    ]


def _asset_defaults() -> list[dict[str, Any]]:
    """The manifest's seeded asset directories (D30j)."""
    return [entry for entry in defaults(*SEEDED) if entry["path"].startswith("assets/")]


def preset_attach(provider_id: str) -> dict[str, str] | None:
    """How this provider's key is sent (00 §4.3 `SecurityGroup.entries[].attach`).
    It lives in the presets file and never on a branch: the provider row on a
    branch is a `ModelProvider`, which has no such field."""
    for row in presets("model-providers.json"):
        if row["id"] == provider_id:
            return dict(row["attach"])
    return None


@lru_cache(maxsize=8)
def _model_native(root: str) -> dict[str, tuple[str, ...]]:
    """`harness-providers.json`'s `modelNative`, by runtime id, read once.

    Cached because `broker.signs_in` is on the console's hot path — once per
    model provider row in `_status`, once per (runtime, harness) pair in
    `runners_for` — and this is shipped data, not policy: it changes when the
    engine is deployed, not while it is running. Keyed on the resolved presets
    directory so a test that points `HARNESS_PRESETS_DIR` elsewhere gets its
    own answer rather than the first caller's.
    """
    return {
        row["id"]: tuple(row.get("modelNative") or [])
        for row in presets("harness-providers.json")
    }


def preset_model_native(provider_id: str) -> list[str]:
    """W7-D2: the model providers this runtime signs in to **itself** — 07 §6's
    `model_native` concern, as the list of provider ids the adapter ships an
    OAuth flow for (Pi: `packages/ai/src/auth/oauth/`).

    It lives beside `attach` and for the same reason: it is a fact about the
    runtime the engine ships, not a policy an organisation edits, so it is in
    the presets file and never on a branch (`_runtime_rows` writes the row key
    by key and does not copy it). A runtime an admin added themselves is in no
    preset and signs in to nothing, which is the honest answer — we do not know
    what it can do.
    """
    root = os.environ.get("HARNESS_PRESETS_DIR") or str(PRESETS)
    return list(_model_native(root).get(provider_id, ()))


def preset_assets() -> dict[str, dict[str, bytes]]:
    """The built-in assets (D30j), directory → that directory's files as bytes.

    The manifest is the list (W6-D1): a second built-in asset is a directory
    under `<presets>/assets/<kind>/<name>/` **and** an entry in `index.json`,
    which is what `scripts/check-defaults.py` holds the two to.
    """
    root = Path(os.environ.get("HARNESS_PRESETS_DIR") or PRESETS)
    out: dict[str, dict[str, bytes]] = {}
    for entry in _asset_defaults():
        at = entry["path"]
        directory = root / at
        out[at] = {
            f"{at}/{file.relative_to(directory).as_posix()}": file.read_bytes()
            for file in sorted(directory.rglob("*"))
            if file.is_file()
        }
    return out


def seed_assets(
    existing: dict[str, Any] | None = None,
) -> tuple[dict[str, bytes], list[str], list[str]]:
    """The built-in asset files to write, and the ids `always-loaded.json` names
    on each of its two lists (W5-D10): required first, then recommended. Which
    list an asset is on is its manifest entry's `managed` word and nothing else
    (W6-D2) — `asset.json` is identity, and 01 §5 rule 2 refuses a key that is
    not identity, so a preset cannot say this of itself.

    Held by its sidecar, which 01 §4.2 makes the asset: a directory the branch
    already has is the organisation's copy, edits and all, and is left alone.
    One whose sidecar carries a *different* id is a different asset that shares
    the name, so ours is not named either — an id no organisation asset carries
    is `always_loaded_missing` at compose.
    """
    held = existing or {}
    files: dict[str, bytes] = {}
    required: list[str] = []
    recommended: list[str] = []
    managed = {entry["path"]: entry["managed"] for entry in _asset_defaults()}
    for directory, bodies in preset_assets().items():
        asset_id = json.loads(bodies[f"{directory}/asset.json"])["id"]
        sidecar = held.get(f"{directory}/asset.json")
        if sidecar is None:
            files.update(bodies)
        elif sidecar.get("id") != asset_id:
            continue
        (required if managed[directory] == "required" else recommended).append(asset_id)
    return files, required, recommended


def always_loaded_lists(body: Any) -> dict[str, list[str]]:
    """W5-D10's file in either shape. A bare array is the `required` list — the
    same normalisation `engine/compose/src/compose.ts` and the indexer do, so
    every reader of this file sees two lists and none of them guesses."""
    if isinstance(body, list):
        return {"required": list(body), "recommended": []}
    if isinstance(body, dict):
        return {
            "required": list(body.get("required") or []),
            "recommended": list(body.get("recommended") or []),
        }
    return {"required": [], "recommended": []}


def _fill_ids(existing: list[str], ids: list[str]) -> list[str]:
    return [*existing, *(asset_id for asset_id in ids if asset_id not in existing)]


def _fill(existing: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    held = {row.get("id") for row in existing}
    return [*existing, *(row for row in rows if row["id"] not in held)]


def _runtime_rows(rows: list[dict[str, Any]], approval: str) -> list[dict[str, Any]]:
    """`harness-providers.json` as a new organisation holds it: the preset carries
    the runtime's identity (W6-D3's `name`, its pin and what it speaks) and the
    seed adds whose decision the approval is."""
    return [
        {
            "id": row["id"],
            **({"name": row["name"]} if row.get("name") else {}),
            "approval": approval,
            "scope": {"teams": "all"},
            **({} if approval == "approved" else {"reason": NOT_REVIEWED}),
            "pin": row["pin"],
            "speaks": row["speaks"],
        }
        for row in rows
    ]


def seed_policy(
    edition: Edition,
    *,
    existing: dict[str, Any] | None = None,
    approval: str | None = None,
    node_path: str | None = None,
) -> dict[str, Any]:
    """D30h's files, path → body, over whatever is already there.

    The manifest is the walk (W6-D2): every `required` and `recommended` policy
    entry lands at `policy/<its file name>`, and this function names no preset.
    The four files below that are in no manifest entry hold no default — three
    are the empty shape a branch must carry (`routing`, `groups`, `grants`) and
    `always-loaded.json` is derived from the asset entries' `managed` words.

    `approval` overrides the edition's: the exporter's organisations were
    running Pi before the migration, so their runtimes arrive approved.
    """
    held = existing or {}
    personal = edition == "personal"
    approval = approval or ("approved" if personal else "not-approved")
    files: dict[str, Any] = {}
    for entry in _policy_defaults(edition):
        at = _branch_path(entry)
        body = _body(entry)
        if entry["id"] == "harness-providers":
            # Filled by id: a migrated organisation keeps its own row.
            files[at] = _fill(held.get(at) or [], _runtime_rows(body, approval))
        elif entry["id"] == "model-providers":
            # `attach` is how the key is sent, which is the presets' business
            # and never a branch's (`preset_attach`), so it is dropped here.
            files[at] = _fill(
                held.get(at) or [],
                [{"id": row["id"], "endpoints": row["endpoints"], "models": row["models"]}
                 for row in body],
            )
        elif isinstance(body, list):
            # A list of names (`kinds.json`): the union, so an organisation that
            # added a kind keeps it and one that predates a new kind gains it.
            files[at] = sorted(set(held.get(at) or []) | set(body))
        else:
            # An object (`reach.json`): the organisation's own file wins whole.
            # D135 — a hobby account's first `pip install` has to work and the
            # Boundaries screen has to show something, so a personal
            # organisation starts on the suggested allow-list and an enterprise
            # starts `off`; the list is offered there as one-click adds, never
            # written for an enterprise.
            files[at] = held.get(at) or body
    # The shapes a branch carries that no default fills.
    files["policy/routing.json"] = held.get("policy/routing.json") or {
        "defaultFor": {"teams": {}, "harnesses": {}, "providers": {}},
        "approvedFor": {"teams": {}, "harnesses": {}, "providers": {}},
    }
    files["policy/groups.json"] = held.get("policy/groups.json") or []
    files["policy/grants.json"] = held.get("policy/grants.json") or []
    # W5-D10's two lists, read off the asset entries' `managed` words and filled
    # by id like every other seeded file: an organisation that already lists
    # something keeps its own order, and an id already required is never also
    # recommended.
    loaded = always_loaded_lists(held.get("policy/always-loaded.json"))
    _, built_in_required, built_in_recommended = seed_assets(held)
    required = _fill_ids(loaded["required"], built_in_required)
    files["policy/always-loaded.json"] = {
        "required": required,
        "recommended": [
            asset_id
            for asset_id in _fill_ids(loaded["recommended"], built_in_recommended)
            if asset_id not in required
        ],
    }
    if personal:
        # D73: the person pastes a key into a group that already exists, so the
        # first screen never asks them to invent one. Filled by name, as the
        # provider rows are filled by id.
        files["policy/groups.json"] = _named(
            files["policy/groups.json"], {"name": "my-keys", "entries": [], "sources": "vault"}
        )
        files["policy/grants.json"] = _fill(
            files["policy/grants.json"],
            [{"id": "my-keys", "scope": {"teams": "all"}, "group": "my-keys", "by": "seed"}],
        )
        # W7-D7: a personal account's first session runs on the person's own
        # sign-in (W7-D2), so the routing *Set up* would write is seeded: every
        # model provider Pi signs in to is approved for the organisation, and
        # Anthropic (else the first of them) is the default. Filled only when the
        # organisation has written nothing of its own, like every other file.
        if node_path:
            signs_in = [
                row["id"] for row in presets("model-providers.json")
                if row["id"] in preset_model_native("pi")
            ]
            routing = files["policy/routing.json"]
            routing["approvedFor"]["teams"].setdefault(node_path, signs_in)
            if signs_in:
                routing["defaultFor"]["teams"].setdefault(
                    node_path, "anthropic" if "anthropic" in signs_in else signs_in[0]
                )
    return files


def _named(existing: list[dict[str, Any]], group: dict[str, Any]) -> list[dict[str, Any]]:
    """`groups.json` is keyed by name, not id (00 §4.3)."""
    held = {row.get("name") for row in existing}
    return existing if group["name"] in held else [*existing, group]


def seed_files(
    edition: Edition, existing: dict[str, Any] | None = None, node_path: str | None = None
) -> list[dict[str, Any]]:
    """The same bodies, and the asset files, as one `CommitRequest.changes`
    (02 §5.3)."""
    files, _required, _recommended = seed_assets(existing)
    return [
        {"path": path, "blob": writes.blob(body)}
        for path, body in seed_policy(edition, existing=existing, node_path=node_path).items()
    ] + [
        # Not `writes.blob`: an asset file is bytes the branch must carry
        # verbatim, and a `SKILL.md` re-serialised as JSON is a different file.
        {"path": path, "blob": base64.b64encode(body).decode()}
        for path, body in files.items()
    ]
