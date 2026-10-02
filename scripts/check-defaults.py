#!/usr/bin/env python3
"""Mechanical checks over the defaults registry (engine 01 §4.2, W6-D1/W6-D4).

Run from the repo root: `python3 scripts/check-defaults.py`. Exits non-zero on
any finding. `engine/compose/presets/index.json` is the manifest of every
out-of-the-box behaviour; a default that is not in it does not exist, and a
file under `presets/` that is not in it is a finding.

Checks:

1. **The manifest and the directory are the same set.** Every entry's `path`
   resolves under `presets/`, and every file or directory under `presets/` —
   top-level files other than `README.md` and `index.json`, plus each
   `assets/<kind>/<name>/` directory — is some entry's `path`.
2. **Shape.** `id` unique; `managed` is `required`, `recommended` or
   `suggested`; `screen` and a non-empty `verbs` on every entry. A `hosts`
   value spelled `@<id>` (the one indirection, engine 01 §4.2) must name
   another entry in the same manifest.
3. **The screen exists.** `screen` is a route segment under
   `web/app/(console)/console/[scope]/`, so this is a directory test, not a
   reading of prose.
4. **The verbs exist in code.** A verb is matched if it occurs in a file
   **directly inside** the screen's route directory (not its sub-routes: a tab
   below it is another screen with its own entry), or in the name of a test in
   a `<subject>-writes.spec.tsx` whose `<subject>` is one of the entry's own
   words — its `id` and its `screen`, split on `-`, `:` and `/`. *Occurs*
   means: the verb's hyphen-separated parts in order, joined by nothing, `-`
   or `_`, case insensitively, not preceded by a letter, and allowed any
   lower-case suffix. So `decline` matches `declineReason`, `set-up` matches
   `setUp` and `setup`, `approve` matches `approved` — and `delete` matches
   nothing on a screen that has no delete. A verb only the docs mention is a
   finding.
5. **Every `required` entry is named in the harness OS section.**
   `docs/engine/01-repository.md` §4.4 *The harness OS* must mention each
   `required` entry's `id` or `path`, which is where the one sentence of why
   lives.
"""
import io
import json
import os
import re
import sys

PRESETS = "engine/compose/presets"
ROUTES = "web/app/(console)/console/[scope]"
SPECS = "web/test/components"
HARNESS_OS = "docs/engine/01-repository.md"
MANAGED = ("required", "recommended", "suggested")


def read(path):
    return io.open(path, encoding="utf-8").read()


def on_disk():
    """Every file or directory under `presets/` a manifest entry may name."""
    paths = set()
    for name in sorted(os.listdir(PRESETS)):
        if name in ("README.md", "index.json"):
            continue
        if name == "assets":
            for kind in sorted(os.listdir(f"{PRESETS}/assets")):
                for asset in sorted(os.listdir(f"{PRESETS}/assets/{kind}")):
                    paths.add(f"assets/{kind}/{asset}")
            continue
        paths.add(name)
    return paths


def verb_pattern(verb):
    parts = [re.escape(part) for part in verb.split("-")]
    return re.compile(r"(?<![A-Za-z])" + r"[-_]?".join(parts) + r"[a-z]*", re.I)


def spec_names():
    """Write specs by subject: `reach-writes.spec.tsx` → `reach` → its test names."""
    out = {}
    for name in sorted(os.listdir(SPECS)):
        if name.endswith("-writes.spec.tsx"):
            subject = name[: -len("-writes.spec.tsx")]
            out[subject] = re.findall(
                r"""^\s*test\(\s*["'](.+?)["']""", read(f"{SPECS}/{name}"), re.M
            )
    return out


def words(entry):
    return set(re.split(r"[-:/]", f"{entry.get('id') or ''}/{entry.get('screen') or ''}")) - {""}


def screen_text(screen):
    """The files of the screen's own route directory, not its sub-routes: a tab
    below it is another screen with its own manifest entries and its own verbs."""
    directory = f"{ROUTES}/{screen}"
    if not os.path.isdir(directory):
        return None
    return "\n".join(
        read(f"{directory}/{name}")
        for name in sorted(os.listdir(directory))
        if os.path.isfile(f"{directory}/{name}")
    )


def check():
    findings = []
    manifest = json.loads(read(f"{PRESETS}/index.json"))
    entries = manifest.get("defaults") or []
    ids = {entry.get("id") for entry in entries}
    named = set()
    specs = spec_names()

    for entry in entries:
        at = entry.get("id") or entry.get("path") or "<entry>"
        path, managed = entry.get("path"), entry.get("managed")
        if not path:
            findings.append(f"{at}: no path")
        else:
            named.add(path)
            if not os.path.exists(f"{PRESETS}/{path}"):
                findings.append(f"{at}: path {path!r} is not under {PRESETS}/")
        if managed not in MANAGED:
            findings.append(f"{at}: managed {managed!r} is not one of {', '.join(MANAGED)}")
        if not entry.get("verbs"):
            findings.append(f"{at}: no verbs")
        screen = entry.get("screen")
        if not screen:
            findings.append(f"{at}: no screen")
            continue
        text = screen_text(screen)
        if text is None:
            findings.append(f"{at}: screen {screen!r} is no directory under {ROUTES}/")
            continue
        mine = [name for subject in words(entry) for name in specs.get(subject, [])]
        for verb in entry.get("verbs") or []:
            pattern = verb_pattern(verb)
            if not pattern.search(text) and not any(pattern.search(name) for name in mine):
                findings.append(
                    f"{at}: verb {verb!r} is in no file of {screen}/ and in no "
                    f"*-writes.spec.tsx test name of its own"
                )

    if len(ids) != len(entries):
        findings.append(f"{PRESETS}/index.json: duplicate ids among {len(entries)} entries")
    for path in sorted(on_disk() - named):
        findings.append(f"{PRESETS}/{path}: under presets/ and in no manifest entry")

    # The one indirection: a `hosts` of `@<id>` is that entry's body.
    for entry in entries:
        body = entry.get("path") and f"{PRESETS}/{entry['path']}"
        if not body or not body.endswith(".json") or not os.path.isfile(body):
            continue
        value = json.loads(read(body))
        hosts = value.get("hosts") if isinstance(value, dict) else None
        if isinstance(hosts, str):
            if not hosts.startswith("@") or hosts[1:] not in ids:
                findings.append(f"{entry['id']}: hosts {hosts!r} names no manifest entry")

    # W6-D4: a `required` default is the harness OS, and 01 §4.4 says why.
    text = read(HARNESS_OS)
    section = re.search(r"^### 4\.4 .*?$(.*?)^#{2,3} ", text, re.M | re.S)
    if not section:
        findings.append(f"{HARNESS_OS}: no §4.4 section for the harness OS")
    else:
        for entry in entries:
            if entry.get("managed") != "required":
                continue
            if entry["id"] not in section.group(1) and entry.get("path", "\0") not in section.group(1):
                findings.append(f"{entry['id']}: required and not named in {HARNESS_OS} §4.4")

    print(
        f"presets: {len(entries)} defaults "
        f"({sum(1 for e in entries if e.get('managed') == 'required')} required, "
        f"{sum(1 for e in entries if e.get('managed') == 'recommended')} recommended, "
        f"{sum(1 for e in entries if e.get('managed') == 'suggested')} suggested), "
        f"{sum(len(e.get('verbs') or []) for e in entries)} verbs, {len(findings)} findings"
    )
    return findings


if __name__ == "__main__":
    all_findings = check()
    for finding in all_findings:
        print("  ", finding)
    sys.exit(1 if all_findings else 0)
