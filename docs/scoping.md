# Scoping

Who can use a thing, decided by whoever owns it.

Today an asset at the org is available to every descendant, automatically and
unconditionally. Sharing means *moving the asset up the tree*, so the only two
settings are "nobody" and "everybody". An admin who wants a CRM connector used
by five of ten teams cannot express it.

This document adds the missing half. §0–§8 are normative: if code and this
document disagree, the code is wrong. §9 lists the tasks in build order, in
the format of [`build-plan.md`](build-plan.md).

Related: [`prd.md`](prd.md) §1.2–§1.3 (the tree and the two directions),
[`harnesses.md`](harnesses.md) §0 (what a harness is, and is not),
[`agents.md`](agents.md) §11 (a control ships only if we can enforce it).

## 0. The one rule

> **Nothing is shared by containment. A unit sees what it owns, plus what an
> ancestor has explicitly scoped to it.**

Being inside an org grants nothing. An admin builds at their level and then
names who receives it. The recipient may narrow further, never widen.

## 1. What this amends

| Document | Amendment |
| --- | --- |
| `prd.md` §1.2 | "Governance is movement through the tree" is no longer the only sharing mechanism. Promote/share/port move *ownership*; scope decides *reach*. |
| `prd.md` §1.3 | "A user operates with a resolved set — their own assets combined with everything inherited from their ancestors" becomes "…combined with everything their ancestors have scoped to them." |
| `harnesses.md` §0 | Unchanged in substance, sharpened in §3 here: scope filters **before** nearest-ancestor-wins. |
| `resolve.py` `resolved_assets` | One join and one predicate. §3. |
| `admin.tsx` | The owned/available toggle goes (§6); the subheader becomes a sub-sidebar (§7). |

## 2. Where this sits, and the AWS correction

You asked whether this is how AWS works. It is closer than the current model,
and the correction runs the opposite way to the one you expected.

| AWS | Here |
| --- | --- |
| **Service Control Policies** — attach to an OU, inherit down, **can only restrict, never grant** | `org_unit_boundaries` + `merge_boundaries`. Already built, already tighten-only. |
| **RAM resource shares** — you name the accounts or OUs that receive a resource. Nothing is shared because it merely exists in the org | **Missing.** This document. |
| **IAM groups** — a collection of principals that policies attach to | A team node. Your "a team is like a security group" is exactly right. |

**The correction: AWS has no inheritance by containment at all.** An account
inside an OU gets nothing from that fact. Access arrives only by an explicit
share or an explicit policy, and SCPs can only ever subtract from it. So the
current model is *more permissive* than AWS, not less — putting an asset at
the org today is closer to making a bucket public than to putting it in an OU.
This change moves toward AWS. It does not overshoot it.

The two mechanisms stay separate, and `prd.md` §1.3's two directions survive
intact:

- **Boundaries** (SCP-shaped): top-down, tighten-only, about *what may be done*.
- **Scope** (RAM-shaped): explicit, about *what may be seen*.

A boundary can forbid something that is scoped to you. Scope can never widen
a boundary. They compose in that order.

## 3. The model

```sql
create table asset_scopes (
  asset_id     uuid not null references assets(id) on delete cascade,
  org_unit_id  uuid not null references org_units(id) on delete cascade,
  granted_by   uuid not null,
  granted_at   timestamptz not null default now(),
  primary key (asset_id, org_unit_id)
);
```

A row means: *this asset is available to this unit and everything beneath it.*

**Scope is per asset, per unit — a table, not a column**, because a recipient
may re-scope what it received. The org scopes the CRM connector to Marketing;
Marketing scopes it to three of its eight people. Both facts are rows, and the
second cannot widen the first because resolution only ever walks *up* from the
user (§3.1).

**Scope keys on `asset_id`, not `(kind, name)`.** `harness_assets` uses names
on purpose — a harness says "include the skill called triage" and the tree
decides whose triage. Scope is the opposite question: the org is scoping *its
own copy*. Keyed by name, an org scoping out `triage` would also hide a team's
own `triage`, which nobody asked it to do.

**An owner always sees what it owns.** Scope governs descendants only. A unit
never needs to scope an asset to itself, and a user node — having no
descendants — never needs to scope at all.

### 3.1 Resolution

The existing query walks the ancestor chain and takes everything. It gains one
predicate:

```
chain      = me, my parent, ..., the root          (unchanged)
candidates = assets owned by a unit in chain
             AND ( owner = me                      -- I own it
                OR EXISTS scope(asset, u) for some u in chain )
window     = row_number() over (partition by kind, name order by depth)
```

**The predicate applies before the window, not after.** This is the whole
correctness argument.

> **Testing this needs the mirror case, not the obvious one.** "Org owns
> `triage`, Marketing owns `triage`, the org's is not scoped to Marketing"
> passes under *both* orderings: ranking is `order by depth asc`, so
> Marketing's nearer copy wins the window either way. The bug only surfaces
> when the window's depth-winner is the copy that **fails** the predicate and
> a farther, passing copy sits behind it — Marketing owns an unscoped
> `triage`, the org owns one scoped down to Marketing. Filtered first, the
> org's resolves; ranked first, Marketing's takes slot one, is dropped, and
> the user resolves nothing. If an org's `triage` were allowed into the window and
then dropped, it would have already shadowed Marketing's own `triage` and the
user would resolve nothing. Filtered first, the org's copy never competes, and
nearest-ancestor-wins is left saying exactly what `harnesses.md` §0 says it
says.

`EXISTS scope(asset, u) for some u in chain` is what makes a grant reach
*through* intermediate units: the org scopes to Marketing, and Ana — a user
inside Marketing — matches on Marketing, not on herself.

### 3.2 Enforcement verdict

By [`agents.md`](agents.md) §11.1: the choke point is the **control plane**.
`resolved_assets` builds the manifest server-side, so an asset that is not
scoped to you is not in your manifest, is never hydrated, and never reaches
a session. **Enforced**, not advisory — and enforced identically for every
agent, because no agent is involved.

## 4. Default: nothing, until scoped

A newly created asset has no scope rows. It is visible to its owner and to
nobody else until somebody says otherwise.

This is the deliberate choice (over "everyone below, until narrowed"), and it
has one cost worth stating plainly: **an admin who creates something and
forgets to scope it has built something nobody can use.** The console must
therefore make an unscoped asset visibly incomplete at the moment it is
created, in the same way `model-default` is visibly missing when absent
([`agents.md`](agents.md) §12.4). Silence is the failure mode this default
buys, and the UI is where it gets paid for.

### 4.1 Migration

Every asset that exists when this ships is scoped to **all descendants of its
owning unit**, in the same migration that creates the table. Not doing this
would empty every live session's manifest the moment it deployed.

**One row per asset, naming its owning unit** — not one per (asset,
descendant) pair. A scope row means "this unit and everything beneath it"
(§3), so the single row is exactly the reach the asset already had, and it
keeps that reach for units that do not exist yet.

Enumerating pairs is wrong rather than merely verbose, and it fails
asymmetrically. It names descendants, never the owner, so somebody hired after
the migration inherits the **org's** assets — a row names their team — and not
their own **team's**, because no row names the team itself. A new starter sees
the company and not their colleagues. Caught by
`test_the_backfill_reaches_units_created_after_it_ran`, which fails with
`assert ['crm'] == ['crm', 'triage']` against the pair-enumerating version.

## 5. What scope is not

- **Not a boundary.** It cannot grant an action a boundary forbids. A
  connector scoped to Marketing whose host is absent from the egress allowlist
  is still unreachable.
- **Not a harness.** A harness is a *user's* working selection from what they
  already resolve, and it can only take away ([`harnesses.md`](harnesses.md)
  §0). Scope is an *admin's* decision about reach. The two compose: scope
  decides what you could put in a harness.
- **Not ownership.** Promote, share and port still move an asset between
  units. Scope decides how far the asset reaches from wherever it now lives.

## 5.1 Nothing has to go up

Scope restricts *reach*. It does not restrict *authorship*, and adding it must
not quietly turn the tree into a place where only admins can make things.

- **Anyone can create at their own level.** `require_write`
  (`deps.py:122`) permits a write to your own unit unconditionally; admin
  rights are only needed to write somewhere *else*. `harness push` already
  lands assets at the pusher's own unit (`index.ts:260`).
- **A user's own assets need no scope at all.** Scope governs descendants, and
  a user node is a leaf. Someone writing a skill for themselves touches none
  of this machinery.
- **Promotion stays optional.** Promote, share and port are things an admin
  *may* do. Nothing expires, nothing is confiscated, and an asset that stays
  at a user node forever is a supported outcome, not a pending migration.

The division of labour this is meant to produce: the org owns the few
expensive, dangerous, centrally-licensed things — the CRM connection, the
model provider, the production credentials — and scopes them deliberately.
Everything else is written where the work happens.

### 5.2 A shadow is a conflict, not a default

Resolution picks one asset per `(kind, name)` by nearest-ancestor-wins.
Something must be picked — a session needs exactly one `triage` — so that rule
stays. What must change is **how a collision comes into existence.**

Today it happens silently. You push `triage`, an ancestor already has
`triage`, and you are told nothing; you have created an override you never
chose, and you stop receiving the org's improvements to it forever.
[`asset-sync.md`](asset-sync.md) §5 already names this a **regression** and
already ends with the rule that governs it:

> **Never auto-resolve.**

That rule is currently applied to only half the problem. §5 handles a shadow
that already exists and later *diverges* — the org's copy advances, you are
notified, `harness reset` takes theirs. Nothing handles the moment the shadow
is **created**. This section closes that.

**A name collision is a merge conflict, and is resolved by a person.** These
are git's semantics and there is no reason to invent others: the substrate is
already git ([`asset-sync.md`](asset-sync.md) §0), `push` already returns
`409` when the head moved under it (§8), and the only missing pieces are a
third conflict trigger and an editor.

#### The three moments a collision can arise

| | What happens | Who resolves it |
| --- | --- | --- |
| **a. You push a name an ancestor has** | `409 name_collision`, with the ancestor's copy | you, at push |
| **b. An ancestor pushes a name you already have** | the ancestor is told *"3 units below already have a `triage`"* before their push lands | the admin pushing, who can see what they are about to shadow |
| **c. A scope newly grants you a name you already have** | the same conflict, raised at the moment of scoping | the admin scoping |

**(c) is new, and this design creates it.** Scoping is now an act that can
produce a collision that neither party authored — the org's `crm` reaching a
team that already wrote its own. It must raise the same conflict as a push,
or scope becomes a back door around the rule.

#### The three resolutions

Exactly git's, named in the product's words:

- **Keep mine** — an explicit, recorded override. The `shadows` machinery
  already built ([`asset-sync.md`](asset-sync.md) §5) then does its job:
  when the other copy advances, you are told. The difference from today is
  only that somebody chose this.
- **Take theirs** — discard mine; inherit.
- **Merge** — open the editor, produce one file, push that.

`asset-sync.md` §9 defers merging to v2 with the note that `git merge` is one
command away. The console makes that v1: it already has `diffLines` and
`DiffRow` (`web/lib/diff.ts`), which is a two-way diff; a conflict needs the
third side (the common ancestor version, which `asset_versions` retains).

**Renaming is the fourth answer and should be offered first** when the two
assets are plainly unrelated — two teams that both happened to call something
`triage`. Most collisions are naming accidents, not genuine forks, and the
cheapest resolution is the one that stops them being a conflict at all.

#### What does not change

Nearest-ancestor-wins, and `harnesses.md` §0. An override that a person chose
still wins for that person, and the tree still decides whose copy you get.
The rule is unchanged; it stops being reachable by accident.

### 5.3 Same harness, fewer keys — the intern

> *Everyone uses the Support harness. The summer intern must not get the
> production write key.*

**No fork.** The intern runs the same harness and resolves less of it. Every
part of this already exists:

- `harness_assets` stores `(kind, name)`, never an asset id, and **a name with
  nothing behind it is allowed and loads nothing**
  (`0017_harnesses.sql:30`).
- `inHarness` filters the *manifest* by name (`core.ts:149`). An asset that
  scope kept out of the manifest is simply not there to match.

So scoping the write-key connector away from the intern leaves the harness
unchanged and the intern's session short one connector. Nobody maintains a
second harness, and nothing drifts.

**When the intern needs a weaker version rather than nothing**, the *admin*
decides that, not the intern. A scope row carries an optional credential:

```sql
alter table asset_scopes add column key_ref text;   -- null = the asset's own
```

```
org   crm ── write key
        ├── scoped to Support   (its own key)
        └── scoped to interns   with key_ref = the read-only key
```

One asset, one name, two credentials, chosen by whoever owns the asset. The
intern's session renders `crm` pointing at a key they can neither see nor
change, and the harness that names `crm` works for everybody.

An earlier draft of this section solved it the other way — a second `crm` at
the `interns` unit, shadowing the org's. That is wrong for a resource, and
§5.5 says why: it would let a recipient decide its own credential for a name
the org published. The override mechanism stays, for content.

### 5.4 Collections: nesting now, groups only if needed

The `interns` unit above is the piece that does not exist yet. `ROLE_PARENT`
allows `user → team` and nothing between, so a team cannot hold a sub-unit.

**How AWS answers this.** It uses two different mechanisms, deliberately:

| AWS | Shape | Answers |
| --- | --- | --- |
| **OUs** | a tree, one parent per account | *where does this belong?* |
| **IAM groups** | a set, many per user | *what is this person, across the org?* |

Groups are not part of the OU hierarchy, and that is the whole point: a user
belongs to one OU and any number of groups. `interns` inside Marketing is a
tree question. `all interns, company-wide` is not — a tree with one parent per
node cannot express it, and neither can ours.

**So: do the tree part now, and only the tree part.**

- **v1 — allow `team → team`.** One entry in `ROLE_PARENT`. A sub-unit is an
  org unit, so it is already a scope target, already a boundary level, already
  resolvable, already renderable in the sidebar's SCOPED TO region. Scoping to
  `interns` is then the single click that was wanted, and it composes: the
  sub-unit narrows its own boundary further, exactly like any other level.
- **Later, and only when something needs it — groups as a second kind of
  scope target.** Many-to-many, outside the tree, granting nothing by
  themselves: a group is a *name you can scope to*, and every rule about
  boundaries and resolution stays with the tree. That keeps the one-parent
  rule that makes `resolved_assets` a single walk.

The cost of guessing wrong is asymmetric, which is why the order is this way
round. Nesting is a one-line change that is obviously right. Groups add a
second axis to every question the tree currently answers alone — *whose copy
do I get* has no answer if two groups both offer a `crm` — and that question
has to be settled before, not after, somebody depends on it. Nothing in this
design is harder to add later for having waited.

### 5.5 The line: assets and administration

Two families, two sets of rules. The console already groups them; the model
should say so explicitly.

| | Surfaces | Versioned? | Working copy? | May a unit change what it received? |
| --- | --- | --- | --- | --- |
| **Assets** | Harnesses · System prompts · Memories · Skills · Prompts · Tools · Connections | yes, `asset_versions` | yes, `~/.harness/assets` | **Yes** — that is the point. Edit freely; `push` is where it becomes a shared decision, and a collision is a merge conflict (§5.2). |
| **Administration** | Boundary · Connectors · People · Audit | no | no | **No.** Flows down. A unit may add its own and narrow what it received; it may never edit what an ancestor set. |

An earlier draft of this section put connections in the second family and said
inherited assets are "read-only below". Both were wrong. Every unit has its own
branch of the work tree and editing it is ordinary
([`asset-sync.md`](asset-sync.md) §1); `require_write` governs *publishing*, not
*editing*. And a `connection` is a config file — provider, model, base URL, and
a reference to a credential. The dangerous half is the credential, which is a
**Connector**, and connectors are already in the second family. A unit
overriding a connection can only name a key already visible to it
(`asset_store.py` checks the reference against the chain), so it cannot
self-escalate by editing config.

#### Where administration stands today

Only one of the four behaves as described.

| Surface | Table | Inherits today | Needed |
| --- | --- | --- | --- |
| **Boundary** | `org_unit_boundaries` | **yes**, tighten-only — `merge_boundaries` intersects allowlists and takes the minimum cap; `validate_tightening` raises `boundary_loosens` | nothing. This is the model the other three should follow. |
| **Connectors** | `api_keys` | **now yes** — `visible_keys` walks the ancestor chain, tagging each row with its owning unit | done. Create and rotate are the only mutations that exist, and both already gate on `require_admin` at the key's **owning** unit (`routes_api_keys.py:47`, `:108`), so an inherited connector is usable below and changeable only where it lives |
| **People** | `org_invites` | per-unit | an ancestor's admin manages membership below; a unit cannot grant itself members its parent did not allow |
| **Audit** | `audit_log` | **now yes** — `descendant_events` walks down from the requested unit | done, with one deliberate exception below |

**Connectors is the one that hurts now.** It is why a team configuring its own
default model cannot select the org's provider key
([`agents.md`](agents.md) §12.6) — the exact problem that started this. Under
this rule an org connector is scoped downward like anything else, is usable by
the units it reaches, and is editable and rotatable only where it lives. A
team gets the use of a key it can never read, which is the whole point of
[`prd.md`](prd.md) §1.9's key management.

**Audit is the quiet one.** An org admin could not see what descendants did,
because nothing walked the tree — a stated promise in [`prd.md`](prd.md) §1.10
going unmet rather than a design question. It now walks.

**`verify_audit` deliberately does not roll up.** The hash chain is per unit —
`audit_log_latest_hashes` is keyed on `org_unit_id` (`audit.py:50-52`) — so a
rolled-up verification would interleave independent chains and report every
unit as broken. Reading the log rolls up; verifying its integrity stays
per-unit. These are different questions and must not share a query.

**A correction this work produced.** An earlier draft of this section said
connectors need "editing and deletion" gated like rotation, and named
`require_write` as the pattern. Neither was right: the only mutations that
exist are create and rotate, and both use `require_admin`, which is stricter —
`require_write` permits a write to your own unit unconditionally, which would
have let a non-admin mint a key at their own node. The stricter gate stands.

## 6. The console: one list, no toggle

The owned/available toggle goes (`admin.tsx:173-197`, `:308`).

It was showing a *computed fact* — "this is in my resolved set" — styled as a
control. Nothing about it could be flipped; the switch implied an authority
that did not exist. That is exactly the failure [`agents.md`](agents.md) §11
exists to prevent, and it is worse here than elsewhere because the real
control was missing entirely.

In its place, one list, every row carrying:

| Column | Meaning |
| --- | --- |
| name | as now |
| **owned by** | the unit that owns it — `org_unit_path`, which the manifest already carries |
| **shared with** | on rows *this unit owns*: how many units it is scoped to, or **Not shared yet** |

Only rows this unit owns get a scope control. A row inherited from an ancestor
shows where it came from and offers no scope control at this level for *that*
copy — re-scoping downward is a separate act on this unit's own grant, not an
edit of the ancestor's.

**Not shared yet** is the important state. It is the §4 cost made visible, and
it should read as unfinished work rather than as a neutral fact.

## 7. The sidebar: here, then below

You said you were unsure about teams sitting inside the org in the sidebar.
Two questions are tangled there, and only one is a design question:

- **The data model is right and does not change.** `ROLE_PARENT` says
  team→org, user→team. Teams *are* in the org. Nested orgs stay legal
  (`org` → `{None, org}`), which matters for subsidiaries and MSP tenants.
- **The navigation is what is wrong.** One nested list makes the org look like
  a folder that happens to contain teams, when the org is where an admin
  *works*.

So the split is not "org versus teams" — that breaks the moment an org
contains an org. It is **here versus below**:

```
┌─────────────────┬──────────────────────┬─────────────────────────────┐
│ HERE            │  Connectors          │                             │
│ ▸ Acme Holdings │  Skills              │   the panel for the         │
│   (admin scope) │  Tools               │   selected section          │
│                 │  Memories            │                             │
│ SCOPED TO       │  System prompts      │                             │
│ ▸ Marketing     │  Harnesses           │                             │
│ ▸ Engineering   │  ──────────          │                             │
│ ▸ Support       │  Boundary            │                             │
│   ▸ Ana         │  Preferences         │                             │
│   ▸ Ben         │  Invites             │                             │
│ ▸ Finance       │  Audit               │                             │
└─────────────────┴──────────────────────┴─────────────────────────────┘
   sidebar            sub-sidebar (§8)        content
```

**HERE** is the unit being administered: its name, and the workbench beneath
it. **SCOPED TO** is the tree of descendants — not a containment view but a
list of destinations, each one somewhere this unit's assets can be sent.
Selecting one moves *there*, and the same two regions redraw around it: a team
admin sees HERE = Marketing, SCOPED TO = its users.

The shape is identical at every depth, which is why it survives nested orgs
and why an org admin and a team admin learn one layout.

## 8. Subheader to sub-sidebar

The eleven tabs (`admin.tsx:80-92`) become the middle column above. The reason
is not fashion: the list is going to grow — Preferences
([`agents.md`](agents.md) §12) is already specified and unbuilt — and a
horizontal strip of eleven items is already at the width where the last ones
get cut off on a laptop. A vertical column takes another five entries without
a layout change, and it gives room for the one thing a horizontal tab cannot
carry: a count or a warning dot beside a section that needs attention, which
is how **Not shared yet** (§6) and a missing `model-default`
([`agents.md`](agents.md) §12.4) get surfaced without opening them.

Group them, so the workbench reads as two kinds of thing:

- **What this unit has** — Connectors, Skills, Tools, Memories, System
  prompts, Prompts, Connections, Harnesses
- **How it behaves** — Boundary, Preferences, Invites, Audit

---

## 9. Tasks

### 9.1 The scope table and resolution — §3, §4.1

**Files.** new `backend/supabase/migrations/0022_asset_scopes.sql`;
`backend/app/domain/resolve.py`; `backend/app/api/routes_assets.py`;
`backend/tests/test_resolve.py`.

**Behaviour.** Create `asset_scopes` per §3, including the optional `key_ref`
override (§5.3), and backfill every existing asset
to all descendants of its owning unit (§4.1). `resolved_assets` gains the §3.1
predicate, applied **before** the `row_number()` window. New assets get no
scope rows. Scope writes require write access to the asset's *owning* unit,
the same check `create_version` already makes.

**Acceptance.** The mirror test described in §3.1 — the nearer copy fails the
predicate, the farther one passes — verified to fail when the predicate is
moved after the window. The obvious arrangement is not sufficient and must not
be relied on alone. A new asset resolves
for its owner and for nobody below. The backfill leaves every pre-existing
manifest byte-identical.

**Out of scope.** Any console change. Harness visibility, which has its own
path (`visible_harnesses`) and should be looked at separately.

### 9.2 Scope endpoints — §3

**Files.** `backend/app/api/routes_assets.py`; `backend/app/domain/audit.py`.

**Behaviour.** `GET /v1/assets/{id}/scopes` lists them. `PUT
/v1/assets/{id}/scopes` replaces the set for one asset, taking a list of org
unit ids, refusing any unit that is not a descendant of the owning unit.
Every change is an authoritative audit event naming the asset and the units
added and removed — who could use what, and from when, is exactly the question
an audit is for.

**Acceptance.** Scoping to a non-descendant is a 422 naming the unit. Revoking
a scope is recorded. A member with no write access to the owning unit gets 403.

**Out of scope.** Bulk scoping across assets.

### 9.3 One list, no toggle — §6

**Files.** `web/app/admin.tsx`; new `web/app/scope.tsx`.

**Behaviour.** Delete the owned/available toggle and the `scope` filter state.
One list showing owned-by for every row, and, for rows this unit owns, a
shared-with cell that opens a picker of descendant units. An unscoped owned
asset reads **Not shared yet** and is styled as unfinished, not neutral.

The picker leads with **Everyone here** — one click, every descendant. §4's
default costs most where it helps least: a team sharing with its own members,
where the answer is nearly always all of them. The default stays explicit;
the common answer stops being tedious.

**Acceptance.** No toggle remains. An asset created in the console is visibly
not shared until somebody scopes it. The picker offers only descendants and
its first control scopes to all of them.

**Out of scope.** The sidebar and sub-sidebar (9.4).

### 9.4 Here-and-below sidebar, sub-sidebar — §7, §8

**Files.** `web/app/admin.tsx`.

**Behaviour.** The sidebar splits into HERE (the selected unit) and SCOPED TO
(its descendants). The eleven tabs move into a middle column, grouped per §8,
with room for a count or warning marker per entry. Selecting a descendant
re-roots both regions on it.

**Acceptance.** An org admin and a team admin see the same layout at their own
level. A nested org renders without a special case. The layout holds at laptop
width with five more sections added.

The Invites tab becomes **People** (§5.5).

**Out of scope.** Preferences itself ([`agents.md`](agents.md) §14.10).

### 9.5 Sub-teams — §5.4

**Files.** `backend/app/domain/org_tree.py`; `backend/tests/test_org_tree.py`.

**Behaviour.** `ROLE_PARENT["team"]` accepts `{"org", "team"}`, so a team may
hold a team. Nothing else changes: a sub-team is an org unit, so scoping,
boundary merging, resolution and the sidebar already handle it. The creation
error message for `team` is reworded to say both placements.

**Acceptance.** A team inside a team is created, is a scope target, and a user
in it resolves an asset scoped to its parent. `merge_boundaries` tightens
through the extra level. `user → team` still refuses anything but a team.

**Out of scope.** Groups (§5.4). Any depth limit — the tree is already
recursive and nothing here needs a new one.

### 9.6 Name collisions as conflicts — §5.2

**Files.** `backend/app/api/routes_assets.py`; `backend/app/domain/resolve.py`;
`web/app/` (a conflict view); `web/lib/diff.ts`; `backend/tests/test_resolve.py`.

**Behaviour.** Creating a `(kind, name)` that an ancestor already holds
returns `409 name_collision` carrying the ancestor's unit, version and
content, rather than silently creating a shadow. Pushing a name that
descendants already hold succeeds but returns the list of units it now
shadows, so the console can say so before the admin commits. `PUT
/v1/assets/{id}/scopes` (9.2) refuses a grant that would collide, naming both
sides, until the receiving unit resolves it.

Resolution is unchanged. A recorded override carries
`provenance.override_of` so the decision is auditable and distinguishable from
a shadow created before this shipped.

The console offers, in order: **rename**, **take theirs**, **keep mine**,
**merge**. Merge is a three-pane view over `diffLines` — theirs, the common
ancestor from `asset_versions`, mine — producing one file that is pushed as an
ordinary new version.

**Acceptance.** A push colliding with an ancestor cannot silently create a
shadow. Scoping cannot create one either. An override created through this
flow records who chose it. Every pre-existing shadow keeps resolving exactly
as it does today — this changes how collisions are *made*, never how existing
ones resolve.

For a **resource** kind (§5.5) the conflict offers **rename** and **take
theirs** only. **Keep mine** is absent, because a recipient does not decide
what a name the owner published points at.

**Out of scope.** Server-side git ([`asset-sync.md`](asset-sync.md) §9 — the
control plane stays Postgres and JSON; a three-pane editor needs no git).
Automatic merging without a person.

### 9.7 Administration inherits — §5.5

**Files.** `backend/app/domain/api_keys.py`, `domain/audit.py`,
`api/routes_api_keys.py`, `api/routes_audit.py`;
`backend/tests/test_api_shapes.py`, `test_audit.py`; `web/app/admin.tsx`.
Neither `org_tree.py` nor `routes_auth.py` was needed — boundary inheritance
already worked, and People is its own pass.

**Backend half: done.** No migration was required; connectors and audit
already store `org_unit_id`, so only the query shape changed. The console half
is wave 4 (`v3.md` §4).

**Behaviour.** `GET /v1/org-units/{id}/api-keys` walks the ancestor chain and
returns inherited connectors alongside owned ones, each tagged with its owning
unit. Rotation, editing and deletion still require write on the *owning* unit,
so an inherited connector is usable below and changeable only where it lives.
Audit gains the same recursive chain `resolved_assets` uses, so a unit's audit
view includes its descendants. The console shows owning unit on both, and
offers no edit control on an inherited row.

**Acceptance.** A team configuring its default model can select a connector
the org owns, and cannot rotate it. An org admin sees a descendant's tool
calls. A member with no write access to the owning unit gets 403 on rotate.
No inherited row renders an edit affordance.

**Out of scope.** Scoping connectors to a subset of descendants — that is 9.1
and 9.2's `asset_scopes` once connectors are reachable at all. People, which
needs its own pass over invites and membership.
