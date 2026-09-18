# Asset Sync

How team infrastructure — skills, memories, tools, connections, and any kind
added later — moves between the control plane and a user's machine without
ever destroying the user's work.

**Git manages the working copy. The control plane is the remote.** We do not
write a hashing scheme, a state file, a diff engine, or a conflict detector;
git already has all four, and the user already knows how they behave.

This document is normative. If code and §4 disagree, the code is wrong.

Related: [`enforcement-architecture.md`](enforcement-architecture.md),
[`build-plan.md`](build-plan.md).

## 0. The one rule

> **Hydration never writes over a path whose working-tree content differs from
> what the team last delivered.**

In git terms: the supervisor only ever updates a path that is clean against
`refs/harness/remote`. Everything else in this document is the small amount of
machinery needed to make that sentence true using git commands and nothing
else.

## 1. The branch model

**Every user is on their own personal branch.** Stated explicitly:

- A user's working copy of the team's infrastructure lives on their machine
  and is theirs to edit. Edits change nothing anywhere else.
- `harness push` publishes the user's version of an asset to **their own
  profile** — their user unit in the org tree. Nobody else receives it. The
  team's copy is untouched.
- Because resolution is nearest-ancestor-wins, the user's pushed version now
  **shadows** the team's for that user, and only that user.
- A team admin **promotes** a user's version to the team unit. Every teammate
  receives it at their next session start. Promotion is an admin action in the
  console; `push` can never do it.

Fork, improve, propose, merge to main — with `push` as the fork and `promote`
as the merge. This is **current server behaviour**: `harness push` already
targets the user's own unit via `/v1/me`; `promote` and the `push_review` →
`approve` gate already exist. What is new is that the working copy persists
between sessions and that hydration respects it.

## 2. What already exists (do not rebuild)

| Concept | Where | Behaviour |
| --- | --- | --- |
| Canonical store | `assets`, `asset_versions`, `asset_files` | one row per asset per org unit; immutable versions; content-addressed files |
| Resolution | `backend/app/domain/resolve.py` | nearest ancestor wins per `(kind, name)`; skips `pending_review` |
| Push | `harness push` | user's own unit; new version; `409` if the head moved |
| Review gate | `boundary.build_policy.push_review` | non-admin pushes are `pending_review` until `/approve` |
| Promote / rollback | `POST /v1/assets/{id}/promote`, `/rollback` | admin moves an asset up the tree; head moves back |
| Working copy | **git** | hashing, dirty detection, per-path diff, history, reset, status |

The sync layer is **kind-agnostic**. An asset is a directory `<kind>/<name>/`
and a version is its files. Adding a kind — `cron`, `prompt`, `context`,
anything — is one line in the `assets.kind` check constraint and one render
rule in the adapter. Nothing in this document changes.

## 3. On disk

```
~/.config/harness/credentials.json   the ONLY secret. 0600. Deny-read in the jail.
                                     Override: $HARNESS_CREDENTIALS

~/.harness/                          $HARNESS_HOME. Persistent.
  assets/                            the WORK TREE — writable in the jail
    skill/<name>/…
    memory/<name>/<name>.md
    tool/<name>/run …
    versions.json                    written by hydrate; see §3.2
  assets.git/                        the GIT DIR — NOT writable in the jail
  sessions/<id>/                     ephemeral
```

### 3.1 How git is invoked

Always, from the supervisor, never from inside the jail, with one helper:

```
git --git-dir="$HARNESS_HOME/assets.git" --work-tree="$HARNESS_HOME/assets" \
    -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    -c user.name=harness -c user.email=harness@local \
    <command…>
```

Why each flag exists:

- **`--git-dir` outside the work tree.** The agent can write to the work tree.
  It must not be able to touch refs, objects, or config. Keeping the git
  directory outside the writable geometry makes that structural.
- **`core.hooksPath=/dev/null`, `core.fsmonitor=false`.** The supervisor runs
  git *outside the jail*, as the user. If the agent could plant a hook, the
  next `git commit` would execute it with the user's full privilege. Command-
  line `-c` overrides any config the agent could write. Never drop these.
- **Fixed identity.** Commits are bookkeeping; no prompt, no global config
  dependency.

Initialisation, once: `git init` with the two flags above, then create
`refs/harness/remote` on first hydration.

### 3.2 Refs and files

| Thing | Meaning |
| --- | --- |
| working tree | the user's current state — their personal branch |
| `refs/harness/remote` | the tree the server delivered at the **last completed hydration**. This is the base. Only hydration moves it. |
| `main` | history of the user's pushes. One commit per `harness push`. Hydration never touches it. |
| `versions.json` | `{ "<kind>/<name>": { asset_id, version_id, seq, shadows } }`. Written by hydrate into the delivered tree so it is versioned with it. `shadows` is `null` or `{ org_unit_path, version_id, seq }` for the asset this one overrides (§5). |

**Dirty(key)** := the working tree at `<key>` differs from `refs/harness/remote`
at `<key>`, including added or removed files. Computed by writing the working
tree to a temporary index (`GIT_INDEX_FILE=<tmp> git add -A && git
write-tree`) and `git diff --quiet <that-tree> refs/harness/remote -- <key>`.
One helper, `worktreeTree()`, used everywhere.

## 4. Hydration

Runs inside `harness run` after `GET /v1/resolve`, before the adapter renders.
Non-interactive: notifies and proceeds, never prompts.

1. Write every delivered asset's files, plus `versions.json`, into a temporary
   index; `git write-tree`; `git commit-tree` → **`incoming`**. No working-tree
   change yet.
2. `W := worktreeTree()`. `R := refs/harness/remote` (may be absent on first
   run).
3. For each key present in `incoming` or `R`, in this order, first match wins:

| # | Condition | Action | Notify |
| --- | --- | --- | --- |
| 1 | `W` = `incoming` at key | nothing | — |
| 2 | `R` absent, key absent from work tree | `git checkout incoming -- <key>` | — |
| 2b | `R` absent, key present in work tree | **nothing** | "`<key>` exists locally but was never delivered. `harness push` to keep yours, `harness reset <key>` to take the team's." |
| 3 | `W` = `R` at key (not dirty) | `rm -rf <key>`; `git checkout incoming -- <key>` | "Updated `<key>` to v`<seq>`." — or, if key absent from `incoming`: `rm -rf <key>`; "`<key>` is no longer provided by your team." |
| 4 | `R` = `incoming` at key (team unchanged) | **nothing** | — |
| 5 | otherwise (all three differ) | **nothing** | "`<key>`: you changed it and the team changed it. `harness push` keeps yours, `harness reset <key>` takes theirs." |

4. `git update-ref refs/harness/remote incoming`.

Row 1 is first and does not consult `R`, so an asset the user adopted by hand,
or whose pushed version has just been approved, converges silently instead of
being reported forever. Rows 2/2b exist only for the very first hydration.
Row 3 is the only row that writes, and it writes only where the working tree
equals the previous delivery — so it can never destroy an edit. Conflicts are
observable afterwards as `dirty(key) && (R ≠ new R at key)`; `status` reports
them, nothing stores them.

### Idempotency

`harness run` twice with no server change and no local change: the second run
hits row 1 or row 4 for every key, performs **zero** file writes, and
`refs/harness/remote` is unchanged. This is a test, not an aspiration.

## 5. The inverse regression: overrides

A pushed personal version shadows the team's **indefinitely** under
nearest-ancestor-wins. The user who fixed `tool/deploy` never receives the
team's later improvements to it. That is also a regression.

So the server includes, per resolved asset, `shadows` — the next-farther asset
with the same `(kind, name)`. Hydration compares `versions.json` in `incoming`
to `versions.json` in `R`: where `shadows.version_id` changed, notify "The
team's `<key>` advanced to v`<seq>` but your personal override is in effect.
`harness reset <key>` to take theirs." Never auto-resolve.

## 6. Push

`harness push <path> --message "…"`, `<path>` inside the work tree. Existing
behaviour plus three rules:

1. **Kinds.** `skill` (dir with `SKILL.md`), `memory` (one `.md`), `tool` (dir
   with an executable `run`). Detection by shape, as now.
2. **Commit.** After the server accepts, `git add -- <key>` and `git commit`
   on `main` with the message. This is the user's personal history; nothing
   reads it but the user (`git log`, `git diff main~1`).
3. **`409`.** Unchanged prompt. Non-interactive (no TTY or
   `--non-interactive`) → print both messages, exit 1. Never auto-override.

Push does not touch `refs/harness/remote`. If the version is `pending_review`,
resolution keeps delivering the old one, hydration lands in row 4, and the
user's edit is preserved until approval converges it via row 1. No special
case.

Push never targets a unit other than the user's own.

## 7. Commands

| Command | Git underneath |
| --- | --- |
| `harness run` | §4, then render, then boot |
| `harness push <path> --message` | §6 |
| `harness reset <kind>/<name>` | `rm -rf <key>; git checkout refs/harness/remote -- <key>`. Confirms unless `--yes` or not a TTY (then requires `--yes`). |
| `harness status` | per key: `clean` / `modified` / `conflict` / `override (team at v<seq>)`, from `worktreeTree()` vs `R` plus `versions.json`. No network. |
| `harness adopt <path>` | move a hand-made directory into `assets/<kind>/<name>/`. No git operation; the next `run` handles it (row 1 or 2b). |

Five commands. `status` and `reset` are the entire conflict UI. Anything more
sophisticated — `git log`, `git diff`, `git blame` — the user runs themselves
with the §3.1 flags, and it is just git.

## 8. Two conflicts

| | When | Detected | Resolution |
| --- | --- | --- | --- |
| **Hydration** | user edited *and* team moved | §4 row 5 at session start; `status` shows `conflict` | `push` keeps mine / `reset` takes theirs |
| **Push** | server head moved since my parent | `409` | prompt, or exit 1 non-interactively |

## 9. What v1 deliberately does not do

- **No merging.** `git merge` is one command away and is a v2 decision, not
  an accident of omission.
- **No server-side git.** The control plane stays Postgres and JSON; it has
  promote, rollback, approve, audit, and org-tree resolution — none of which
  are git concepts. Exposing it as a git remote is a v2 option only if needed.
- **No dependency installation.** Tools vendor their dependencies.
- **No per-agent rendering on the server.** Neutral bytes; the adapter renders.
- **No `.gitignore`, no submodules, no LFS.** If a team asset needs any of
  these, the asset is wrong, not the sync layer.
