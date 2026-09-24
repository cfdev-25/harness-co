# Product Requirements v2 — The Management Framework

How capability, access, and policy are structured, managed, and inherited
across an organization.

**This document supersedes [`prd.md`](prd.md).** Where the two disagree, this
one wins. §0–§13 are normative: if code and this document disagree, the code
is wrong. §14 is the build inventory; §15 is what is still undecided.

> **Governing principle, unchanged from `prd.md`.** Every capability removes
> stress from the foreground by doing more in the background. We ship
> explainability, not features. If a capability adds a concept the user must
> learn, it does not ship.

Related: [`asset-sync.md`](asset-sync.md) (the work tree),
[`harnesses.md`](harnesses.md) (the harness as a filter),
[`enforcement-philosophy.md`](enforcement-philosophy.md) (what a boundary is),
[`plan-improvement.md`](plan-improvement.md) (ratified fixes F1–F9),
[`scoping.md`](scoping.md) (the model this reverses).

---

## 0. The one rule

> **Definitions are git. Credentials are not. Nothing else may blur that line.**

Everything the platform manages splits into two planes, and the split is what
makes portability and security tractable at the same time.

- **Definition plane — git.** Tools, skills, system prompts, MCP server
  definitions, permission rules, the harness itself. None of it is secret, so
  branching, review, diff, blame, and rollback all apply for free. This plane
  is what makes a harness portable across providers: it compiles *to* each and
  is authored *for* none.
- **Runtime plane — broker and launcher.** Credentials, resolved only at
  launch, never written into the repo, never versioned.

The consequence we care about: reviewing a skill never requires touching a
secret, and rotating a secret never requires a code review.

---

## 1. What this amends

| Document | Amendment |
| --- | --- |
| `prd.md` §1.2 | Nested orgs (`Org › Org › Team › User`) become **one org root, n team layers, users** (§2). A holding company or an MSP tenant is its own org, not a subtree. |
| `prd.md` §1.2 | "Capabilities live on a recursive tree" becomes "capabilities live on a chain of branches." The tree survives; its storage is git. |
| `prd.md` §1.3 | "A user operates with a resolved set — their own assets combined with everything inherited from their ancestors" is **restored** (scoping.md reversed it) and sharpened: inherited means *present on a branch in your chain*. |
| `prd.md` §1.9 | "Secrets are submitted once, obfuscated to an internal reference" stands, but the platform's own code path no longer holds values. It holds references and asks a resolver (§8). |
| `prd.md` §1.10 | Unchanged. Records stay primary in Postgres (§3.1). |
| `prd.md` §2.7 | "Users never see branches, commits, or merges" is **softened**: git is the backbone and is abstracted for non-technical users, but a technical user may clone and use it directly, and we say so. |
| `scoping.md` §0 | **Reversed.** "Nothing is shared by containment" becomes "presence on a branch in your chain is reach." `asset_scopes` is retired (§6). |
| `enforcement-philosophy.md` §2 | **Amended.** Reach is derived from grants, plus one per-harness web switch, minus a deny list (§12.1). The "no route except an allowlist" claim becomes conditional on that switch, and the condition is shown on the harness. |
| `scoping.md` §2 | **Retired analogy.** "A team is like a security group" no longer holds: a **security group** is the credential object (§8.2.2), and a team is a team. Two things cannot share the name for the admins most likely to know it. |
| `asset-sync.md` §9 | **Reversed.** "No server-side git" becomes real bare repositories server-side, with per-ref authorization (§3.1, §12). |
| `asset-sync.md` §1–§8 | Unchanged and load-bearing. The local work tree, `refs/harness/remote`, the hydration table, and the five commands all survive. |
| `harnesses.md` §0 | A harness is still a filter that can only take away, with one exception: org assets marked **always loaded** (§10.1). |
| `harnesses.md` / `scoping.md` §3 | Harness contents key on **asset id**, not `(kind, name)` (§5.1). |
| `agents.md` | Terminology: an **agent** is now a **harness provider** (§11). A *harness* is the package of assets and policy we manage — `harnesses.md` §0's sense, which was already correct. |
| `plan-improvement.md` F2-bis | The in-house key registry is **re-seated, not deleted**: same admin experience, a real vault underneath, behind the resolver interface (§8.2). |
| `plan-improvement.md` F4 | **Partially reversed** for definitions only. Records and the definition index stay in Postgres (§3.1). |

---

## 2. The shape of an org

```
Org                      exactly one root. Policy lives here and nowhere else.
├── Team                 n layers deep. A team may contain teams.
│   ├── Team (sub-team)
│   │   └── User         leaves.
│   └── User
└── Team
    └── User
```

**One org root.** Org-level configuration (§10) is admin-only by construction
because there is exactly one node that can hold it. This is the reason nested
orgs go: when any node could be an org, "an admin decision" has no precise
meaning and every policy check has to ask how far up to look.

**n team layers.** Depth is free and is the mechanism for withholding (§7).
Subsidiaries, divisions, and squads are all team layers.

**Users are leaves.** A user node is a branch like any other; what makes it
different is only that nothing forks from it.

**Multi-tenancy.** A holding company with subsidiaries, or an MSP with client
tenants, gets one org per tenant. Cross-tenant sharing is out of scope for v2.

---

## 3. Storage

### 3.1 Definitions in git, records in Postgres

| | Lives in | Source of truth | Rebuildable |
| --- | --- | --- | --- |
| Assets, harnesses, policy, catalog, registries | bare git repos, one ref per node | **git** | — |
| Definition index (what resolves where, for queries) | Postgres | derived | yes, by re-reading the repos |
| Records: audit, sessions, cost, run-state | Postgres | **Postgres** | no |

**The index stores edges, not just assets.** An admin's questions are almost
always relational — *if I rotate this, what breaks?*, *if I revoke this team,
what do they lose?*, *why can this harness reach production?* — and those span
every branch in the org. Git cannot answer them without walking every ref, so
the relationships are part of what the index holds (§10.2).

The definition index must be rebuildable from the repos alone. This is what
keeps `plan-improvement.md` F4's disaster-recovery objection answered: there
is one restore order — restore the repos, reindex, restore records — and no
moment where two stores must agree about the same fact.

`assets`, `asset_versions`, and `asset_files` were already content-addressed
and immutable, so this is a change of storage, not of model.

### 3.2 Every node is a branch

The org branch is the root. Team branches fork from their parent team, or from
org. User branches fork from their team. A user's machine holds a clone; their
local work tree is a branch off their user branch, which `asset-sync.md` §3
already implements with a real git directory at `~/.harness/assets.git`.

Precedence is branch topology. A team's version of an asset supersedes the
org's for that team because it is the version on that branch.

**The platform never runs `git merge`.** The effective harness is *composed*
from the refs in the chain by precedence and delivered per `asset-sync.md` §4 —
build `incoming` from the resolved chain, reconcile per key against the work
tree. Org-branch content reaches every chain that includes org, so nothing has
to be propagated when the org adds an asset; a team branch holds only that
team's own content and its overrides. A technical user may of course merge by
hand in their own clone.

### 3.3 Divergence without recurring conflict

Composition produces no merge conflicts — precedence decides, and an
unsubscribed path is never materialised at all (§5.2). This section is for the
technical user who *does* merge by hand in their clone.

A branch that deliberately keeps its own version of a path declares it:
`.gitattributes` with `merge=ours` for that path. The exception is content, so
it is visible in a diff and reviewable in a pull request, and the merge stops
asking.

An exception that stops conflicting also stops receiving upstream fixes. The
rail for that already exists: `asset-sync.md` §5's `shadows` — the platform
reports "the parent's version advanced while your override is in effect" and
never auto-resolves. Every declared exception carries a shadows notice at
preflight.

---

## 4. The five layers

From static to ephemeral, in the order a launch moves through them. Most of
these exist today under other names; the fourth column says what is new.

| # | Layer | Does | Today |
| --- | --- | --- | --- |
| 1 | **Definition** | the canonical manifest per branch | `assets` tables → git repos (§3.1) |
| 2 | **Compiler** | harness-agnostic IR → native config, and back | `adapters/pi.ts`, `adapters/claude.ts`; **rehydrate is new** |
| 3 | **Preflight** | resolve the effective harness, detect drift, probe every need, report satisfied / unsatisfied / deferred | `resolve.py` + `hydrate.ts`; **probing and drift are new** |
| 4 | **Broker** | mint session-scoped credentials; **enforce policy at mint** | `api_keys.py` / `/v1/api-keys/deliver`; **resolver interface and enforcement are new** |
| 5 | **Launcher** | bind env and files, exec the provider binary | `supervise.ts`; deliberately dumb, unchanged |

Layers 2 and 4 never talk to each other. They meet only through layer 3, and
only layer 5 ever holds a live value. That separation is what lets the
compiler be open to community adapters while the broker stays closed.

**The compiler is not safe because it is pure.** An adapter renders the config
a provider executes while holding live credentials; a permissive render is an
escalation. Safety comes from validating its *output*: preflight rehydrates
the rendered config back to IR and refuses to launch on divergence. Purity is
a convenience; output validation is the control.

---

## 5. Assets

### 5.1 Identity

Every asset carries a **durable id in its own files** — the uuid it already
has in `assets.id`, written into the asset on migration.

- **Where.** One uniform sidecar per asset directory. A skill and a memory
  could carry frontmatter, but a tool is a directory with an executable `run`
  and nothing to put frontmatter in; a sidecar keeps the layer kind-agnostic,
  which `asset-sync.md` §2 identifies as the property that lets a new kind
  cost one line.
- **Why not the path.** A rename would silently unsubscribe everyone. An org
  renaming `tool/deploy` to `tool/ship` must not strip it from every person
  whose harness listed `deploy`.
- **Collision rule.** Same path on two branches with the same id is an
  override; branch precedence decides. Same path with **different** ids is a
  conflict, surfaced, never silently shadowed. The same id at a **different**
  path on another branch is the same asset, renamed — subscription follows it,
  which is the case the id exists for. Git will carry whatever id a file
  claims, so all three are validated at push and again at preflight.

This is a deliberate exception to "as git-native as possible," taken because
subscription and audit both need an identity that survives a rename.

### 5.2 Subscription and materialization

A harness is a list of asset ids. Materialization on disk is **sparse
checkout**: the branch's tree holds everything the chain provides; the working
copy holds only what the harness subscribes to.

This is what makes deliberate divergence conflict-free. An unsubscribed path
is absent from the working tree with `skip-worktree` set, so an upstream
change to it merges with nothing to collide against — and committing from a
partial copy does not delete everyone else's paths.

What remains is the honest conflict only: you edited a path and the parent
edited the same path. `asset-sync.md` §4 row 5 already handles it correctly —
refuse to write, notify, let the person `push` to keep theirs or `reset` to
take the parent's.

### 5.3 Dependencies

`needs:` is not only about resources. A subscribed skill that calls an
unsubscribed tool is an unsatisfied need, and preflight walks asset→asset
dependencies as well as asset→resource ones.

---

## 6. Grant and filter

Two questions that were previously run together, with different owners:

| | Question | Owner | Mechanism |
| --- | --- | --- | --- |
| **Grant** | May you have this? | an admin | the asset's presence on a branch in your chain |
| **Filter** | Which of what you have does this harness load? | the person | the harness's subscription list (§5.2) |

**A person may subscribe to anything present in their chain.** There is no
per-person availability list. Two things make that safe rather than loose:
subscribing loads an asset into a session, it does not hand over the
credential that asset needs — security groups are granted per team and the
broker mints at launch (§8, §12) — and withholding is done by team layering
(§7), which is a structural decision an admin takes deliberately rather than a
checkbox they forget.

Granting is blessing a branch: an org gives a connector to five of ten teams by
committing it onto those five team branches. That is a normal git operation —
reviewable as a pull request, revertible, attributable in blame — and it
replaces the `asset_scopes` table rather than losing the capability it
provided.

`asset_scopes` (shipped as v3 S1–S6) is therefore retired. Its semantics
survive as branch membership; its table, its endpoints, and the owned-versus-
available distinction in the console do not. This removes the concept the
`prd.md` governing principle says should not have shipped.

---

## 7. Withholding

**Per-user branch content is additive. Subtraction is team layering or
boundary policy, never per-user filtering of parent content.**

The reason is mechanical. Every member of a team must be able to read the team
branch for inheritance to work at all. So an asset present on the team branch
is reachable by every member, and removing it from one person's branch
withholds nothing — they can fetch the team ref. Worse, deleting a file the
person already has is not a control at all: `asset-sync.md` §1 makes the
working copy theirs to edit, so they can check it back out.

The three correct instruments:

| Want | Instrument |
| --- | --- |
| Give this person something extra (a memory: *never drop the db*) | commit it to their user branch |
| Keep this away from this person | put it on a sub-team branch they are not a member of; per-ref authorization does the rest (§12) |
| Let them have it but not do the dangerous thing with it | boundary policy — `org_unit_boundaries` + `merge_boundaries`, already built, already tighten-only |

A consequence worth stating: because per-user branch content is additive only,
**composing the chain on the person's own machine at preflight weakens
nothing.** There is no merge to own, and no server-side propagation step
waiting to be designed.

---

## 8. Credentials

### 8.1 The platform holds references

The platform's code path never holds a secret value. It holds a reference and
asks a resolver. Every provider — AWS Secrets Manager, Vault, 1Password, the
one we host — implements the same two calls:

- `resolve()` — mint a credential against a team **security group**: read-only on the specific secrets a grant names, tagged with person
  and session, expiring with the session.
- `probe()` — is this ready, without returning a value.

`probe()` is the new primitive and the one the whole status model rests on.

### 8.2 The bundled provider

Requiring a customer to bring a secrets manager is an adoption barrier; "go
stand up Vault first" is a bad first step. We host our own instance behind the
identical interface, so the non-technical admin experience ratified in
`plan-improvement.md` F2-bis survives intact — paste a key, name it, scope it,
rotate it as a new version under the same ref — with a real vault underneath
instead of encrypted Postgres columns. Until that ships, the existing registry
*is* the bundled resolver, sitting behind the same interface: the swap is a
resolver implementation, not a change to anything that calls it. See §14 (Later) for OpenBao.

### 8.2.1 Two tiers of provider support

Breadth is cheap for reading a value and expensive for the two things that
carry the security claim: authenticating to the customer's vault without
holding a long-lived secret, and minting something session-scoped we can cut
short. Those differ per provider. So support has two honest tiers:

| Tier | What we can do | Status it can reach |
| --- | --- | --- |
| **Deep** | authenticate without a stored secret, mint session-scoped, probe, expire with the session | **verified** |
| **Shallow** | read the value at launch through the provider's API | the weaker guarantee, reported as such |

Both implement the same `resolve()`/`probe()` interface, so a shallow provider
can be promoted later without anything that calls it changing.

**The first three deep providers are AWS Secrets Manager, Azure Key Vault, and
HashiCorp Vault** — the two dominant clouds plus the on-premises standard.
Azure earns its place because the Tier-1 OAuth surface is Microsoft 365, so
those customers are already there. Everything else starts shallow.

### 8.2.2 What we read, what we never write, and what a security group is

**Listing is a different permission from reading.** All three deep providers
separate them — `ListSecrets` in AWS, list in Azure Key Vault, `LIST` on a path
in Vault — so an inventory of names, groups, tags, rotation age and
last-accessed dates costs the customer no exposure of any value.

**Read access is optional and the screens degrade honestly.** We ask for list
permission and say what it buys. Without it the vault still works; the console
shows what an admin declared and states that it can show no more, rather than
showing something stale. No inventory, no rotation age, no orphan detection.

**We never write to a customer's vault.** Creating or rotating a secret in
their AWS or Vault means holding write credentials on their production secret
store, which is materially more than reading names. The paste-a-key-and-rotate
flow ratified in F2-bis therefore lives on **our hosted vault only** (§8.2);
for a customer's own vault the console reads and links out.

**The inventory is the whole authentication surface, not just vault contents.**
It is named *Secrets inventory* and carries three things an admin would
otherwise chase separately: secrets in vaults, personal sign-ins held by the
harness provider, and ambient machine logins like `gh auth login`. The ones the
platform cannot hold (§8.4) belong here *because* it cannot hold them — an
admin asking how something authenticates should get one answer. Each states
what we can and cannot do with it: name it, see which groups reference it,
record that it was used; not read it, rotate it, or confirm it before launch.

**Vault columns say what they ask.** **Issues** — temporary credentials, or
stored values. **Contents** — whether we may list what is inside. "Can mint"
and "Inventory" named the implementation rather than the question.

**The inventory browses provider → group → secret.** The group is whatever that
vault already uses — a path in Vault, a tag in AWS or Azure. Two findings fall
out that are worth more than the list itself: a **secret nothing covers** (it
exists and no security group reaches it, so either it is dead or something outside the
platform uses it), and an **security group pointing at a secret that no longer
exists** (broken before someone hits it mid-session).

#### A security group is a named set of secrets

A security group has a name, the teams it is granted to, the parameters used to
mint it, and a list of entries — each an **alias** and the secret that alias
resolves to. Marketing holds `crm` and `email`; Marketing interns holds `crm`
alone. That is also how something is kept from someone: a narrower security group
granted to a smaller team, never a box unticked against a person (§7).

Three things justify it over joining teams to secrets directly:

- **The alias.** A harness declares `needs: db`, never `secret/db/all-read`.
  The security group binds the alias per team, so one harness definition runs at two
  teams with different vaults. Without it, vault layout is hard-coded into a
  shared definition and portability is gone.
- **How to mint, not just what.** An assume-role duration and session tag, a
  Vault lease TTL — properties of this team's grant, not of the secret.
- **It always exists.** For a vault we cannot list there is no secret object to
  join to; the security group is all there is.

It stands in for what the vault already calls a role or an AppRole.

**Sub-granting is delegated, narrowing only.** An org admin creates a security group and
grants it to a team. A team admin may pass it, or a narrower slice, down to a
sub-team within their own subtree. They may not add an entry their team does
not hold, change the credential rule, or grant outside their subtree — the
tighten-only rule (§7) applied to credentials. A grant records who made it and
which grant it was narrowed from.

#### Where the credential comes from — the only distinction that is ours

Two earlier drafts got this wrong. The first called it *credential strength*,
which read as a security grade. The second called it *lifetime* and kept three
values, which still put us in the business of judging how a customer manages
their keys. Neither is our place:

| | What it means for us |
| --- | --- |
| **vault-supplied** | we resolve it at launch from a key vault and hand it to the harness. We can confirm it before the session starts, and stop supplying it |
| **locally-owned** | a browser sign-in or machine login the person made. We never hold it, cannot inject it, and only learn of it once the session is up |

How long a key lives, when it was last rotated, and whether anything still uses
it are the **vault's** business and the customer's. We record what a provider
reports and never grade it: there is no hygiene column, no overdue flag, no
recommendation. Inventing a rotation policy on a customer's behalf is overreach
dressed as helpfulness.

**The person's own machine is listed as a key vault.** It is not a vault and
it is not ours, but it is somewhere credentials come from, so it belongs in the
same list — which also means no row in the inventory has a blank provider. Its
screen states the limits outright: we can probe whether a login is present and
show the command that creates it; we cannot read it, rotate it, hand it to a
harness, or confirm it before launch.


**Each security group declares which sources may fill it.** Credentials resolve
down an ordered chain — an explicit override, then the vault, then whatever
ambient login the machine already has — and a group says how far down it will
go. This is the conventional shape: the AWS provider chain, git's
`credential.helper`, Docker's credential stores all work this way, and the
resolver interface (§8.1) is the same credential-helper indirection.

- **vault only** — the chain has exactly one entry. If the vault does not
  resolve, the launch **fails**; it never falls back to whatever the person
  happens to be logged into.
- **vault or local** — an ambient sign-in is acceptable, and the fallback is
  never silent (below).

**Fail closed, not fall through.** A chain that quietly falls back works on one
laptop and not another, and uses the wrong identity in CI: the security
properties vary by machine and nobody knows. The order is fixed and is not
configurable per person; what varies is how far down a group permits.

**Preflight reports which source resolved each slot**, not merely satisfied or
unsatisfied — *resolved from the Finance group*, or *resolved from your local
AWS session*. Every tool with a credential chain ships this (`aws sts
get-caller-identity`, `gh auth status`, `vault token lookup`) because an opaque
chain is unreviewable. **The session keeps that record**, so "how did this run
as that identity three weeks ago" is answerable from our own logs — the target
system's only show the end result. This single field is what makes a fallback
chain safe to have at all.

This replaces the earlier `must expire` switch (§16). That rule tried to say
the same thing through lifetime, and the broker refuses to mint it from anything that outlives
the session. It is a property of what the security group holds rather than a label
someone picks — a security group containing a stored string cannot carry it. This is
which is the vault's business rather than ours. Naming the *sources* says the
part that is actually ours to decide.

**One secret, several teams, without managing anything.** A shared read-only
role referenced by three security groups, each granted to a different team, renders
from the secret's side as the three teams that reach it. We do not grant it —
the vault already permits it. What the platform decides is which of those teams
may have it minted: **the vault sets the ceiling and we lower it, never the
reverse.**

### 8.3 Three evidence levels

Status is not a boolean. Every slot reports how it was established:

| Level | Meaning |
| --- | --- |
| **verified** | the platform confirmed it |
| **harness-reported** | the provider says so |
| **declared** | expected, unobserved |

Preflight reports the level each slot achieved and never rounds up. This is
the mechanism that stops the class of overclaim inventoried in
[`homepage-promises.md`](homepage-promises.md), where the demo shows a
checkmark the code cannot earn.

### 8.4 What the broker cannot hold

**OAuth (Slack, Google, Jira, Outlook).** The token is minted by browser
consent and held in the provider's own store. Native to the provider means no
custody and it works wherever the provider supports it, but status is
harness-reported or declared — never verified before launch. Preflight treats
these as **deferred**: declared, checked once the provider is up, never
counted as satisfied. Brokering them is §14 (Later); the rule if we ever do is
that the brokered tool performs the call and returns results, never a token.

**Ambient CLI logins.** Whatever `gh auth login`, `aws sso login`, or
`supabase login` left on the machine. The platform cannot hold or inject
these, but it is not blind to them: it can **detect** (probe), **guide** (show
the exact command), **upgrade** (inject a brokered token at launch to convert
ambient into managed), and **constrain** (command allow/deny rules).

---

## 9. Preflight and exit

Preflight and exit bracket the provider's lifecycle: both run outside it, one
before and one after.

**Preflight** resolves the effective harness for this person, provider, and
ref; composes the chain; diffs the rendered native config back to
IR to catch drift and hand-edits; walks every `needs:` — assets and credentials
alike — and asks the resolver to probe each; and computes satisfied /
unsatisfied / deferred with an evidence level per slot. Only on success does
it hand off to the compiler to render and the launcher to bind and exec.

**Exit** re-probes every slot, diffs what is actually present against what the
harness declared, and offers to record newly discovered needs into the harness
definition. This is how the server learns what a harness *really* requires —
grown from observed use rather than guessed up front.

Two rules that make exit reconciliation trustworthy:

1. **Sessions do not always exit.** Crash, `SIGKILL`, a closed laptop. So
   preflight reconciles too: it probes before it renders, and if the previous
   session ended without a clean exit it folds in what it finds. Same code,
   called from both ends.
2. **Recording a need does not make it verified.** When someone authenticates
   `gh` themselves, what exit records is "this harness needs a GitHub CLI
   login," and that slot probes as harness-reported at best on the next
   launch. A recorded need carries its evidence level, not just its name.

Both depend on a probe existing per resource kind. Exit reconciliation is only
ever as good as the probes.

---

## 10. Org-level configuration

Two questions sit underneath everything an admin configures: what is allowed to
run, and what is allowed to touch what. These are one-time setup decisions on
the org branch, so each is a reviewable commit with an author and a history,
and every team below inherits it.

| Admin sets up once | What it establishes | Inherited by |
| --- | --- | --- |
| **Key vaults** | which secrets managers exist (bring-your-own, or the bundled one) | all teams |
| **Teams and membership** | the group structure grants map onto; membership is the grant | all resources |
| **Security groups** | a team's scoped entry into a provider (a specific role, a specific path) | that team's harnesses |
| **Provider allowlist** | which harness providers may run at all, and at what trust tier | all teams |
| **Model providers** | where models come from, and who routes to which — default for and approved for, across teams, harnesses and runtimes | every harness, by precedence |
| **Custom distributions** | org forks or internal builds, admitted with provenance and a pinned hash | teams granted them |
| **Organisation assets** | skills, tools, conventions and prompts that apply to every harness regardless of vendor. Each is either always loaded or available when chosen | every team, every harness |
| **Endpoints reached** | the observed log of what harnesses dialled, from the fence and the broker | visible per team |
| **Approval and credential rules** | which builds may run and be handed credentials, and which security groups must expire with the session | all launches |

*(Adopted from the management-framework notes, with "harness" translated to
"harness provider" per §11.)*

**Organisation assets** are what most directly earn the portability claim: because
assets are authored against the harness-agnostic IR rather than a vendor's
format, a compliance rule written once at the org level compiles into Claude
Code, Cursor, and Pi alike. An admin does not write it three times, and does
not rewrite it when a new provider is admitted.

### 10.1 How an organisation asset loads

A harness filter can only take away (`harnesses.md` §0) — but a compliance
memory a person can unsubscribe is not a compliance rule. So each org asset
declares how it loads:

- **Always loaded** — into every harness, and no filter can leave it out.
  Preflight refuses to launch without it. This is where a compliance rule
  belongs.
- **When chosen** — published and available; whoever builds the harness
  includes it.

This is the only place the org table and the harness filter collide, and the
distinction is the whole resolution. It is deliberately framed as *how it
lands* rather than *whether it can be removed*: the question is what the org is
doing with the asset, not what a permission forbids.

### 10.2 The shape of the admin console

One screen per object type, each owning exactly one decision and linking out
for the rest. Six principles govern the whole surface.

**1. Every object is a destination, and every relationship is walkable from
both ends.** From a key vault you reach its secrets, the security groups that mint
them, and the teams behind those. From a secret you reach its vault, the
security groups that reach it, and their teams. No screen restates another's data.

**Two hops matter as much as one.** *Rotate this key and what stops working?*
is answered by the harnesses behind the security groups, not by the security groups. The
console shows the second hop as its own section, and the walk is directed —
*what rests on this* and *what this rests on* are separate, never merged.

**2. Every fact comes from one of three places, and they are never mixed.**

| | Source | On screen |
| --- | --- | --- |
| **Declared** | an admin typed it; a commit with an author | "Set by an admin" |
| **Observed** | `probe()`, asked as the screen draws, stored nowhere | "Checked just now" |
| **Derived** | computed from the graph | "Connected to", "What would break" |

**3. A scale is a column, not a "status".** Every tag is a value on a named
scale — approval, where a credential comes from, certainty, reach, record,
role, state, whether a boundary holds — and each list names the scales it shows, so a column asks the
same question of every row. A single `Status` column hides which question is
being answered, and is what makes a shared vocabulary read as bespoke.

**A scale may be labelled for its context.** "Reach" on an organisation asset
is really asking how it loads. The underlying scale stays one thing; the
heading says what it means here.

**Every tag must lead somewhere.** A tag links to the screen defining its
scale, so the explanation lives at the destination rather than in a legend that
drifts. An unlinked tag is a word the product invented and never explained, and
they accumulate silently as screens are added. The check is mechanical: every
value in the scale map needs a destination.

**A word may mean only one thing.** "Verified" once meant both *official build*
and *we checked it*; approval states are now `approved` / `beta` / `not
approved`, and `verified` belongs to certainty alone.

**4. Relationships are columns too, and every column names its unit.**
*Default for teams*, *Default for harnesses*, *Granted to teams*, *Only for
harnesses*, *Approved for providers*. A column of chips does not say what kind of
thing it lists, and a reader should not have to infer it from the values. Where
a scope is everything rather than a list, the cell reads **All teams** instead
of repeating the other table. A list
carrying only tags describes each row in isolation and leaves the data model to
be rebuilt by opening rows one at a time. A secret shows its vault, the security groups
that reach it and the teams behind those; a security group shows its secrets and the
teams it is granted to. Relationships render as linked values rather than tags,
because a tag is a value on a fixed scale and a relationship points at a
specific thing. No column ships without a heading — including the description.

**A derived fact is not shown as its own control.** Which rules a build
satisfies follows from its approval state; a harness that supports no provider
shows an empty column rather than a separate can-launch flag.

**5. What the console links to rather than owns.**

| | Owned by | Why |
| --- | --- | --- |
| What a credential may do — spend caps, data policies | the key manager | two teams can hold keys to one account with different rights |
| What an account may reach — scopes and permissions | the application's own console | the app owns this; we record that access exists |
| Spend and quota | the provider's dashboard | mirrored numbers go stale |

The rule for anyone adding a screen: **if changing it here would not actually
change it there, the control does not belong here.**

**6. Adding things is part of the screen.** A list without a way to add to it
describes a system nobody can operate. A harness provider is a repository plus
a pinned commit plus a name — nobody clones anything, and everyone scoped to it
runs `harness provider add <name>`. Pinning is to a commit, never a branch. A
model provider is a name, an endpoint and a wire format, with exactly one org
default.

**The navigation is grouped by what an admin is doing:** Providers, Credential
management, Logs, People, Assets. Harnesses sit with organisation assets,
because a harness is a rolled-up distribution of assets; filing it separately
implied it was a different kind of object.

A working prototype of these screens, on fixtures, is at `/org-preview` in
`web/app/org-preview/`, including a "How this works" screen explaining every
scale. It is not wired to anything.

### 10.2.3 A harness is the unit an audit is about

Everything on the other screens exists to decide what one harness can do, so
its row carries all of it: **assets** it includes, **security groups** it draws
credentials from, **extra boundaries** naming it or its teams, **model
providers** it routes to, **harness providers** it can run on, its **team**,
and whether **outside endpoints** are allowed. An auditor answering "what can this thing
reach, and who decided that?" should not have to open seven screens.

**Org-wide boundaries are not repeated per row.** They cover every harness, so
listing them everywhere buries the one line that is actually about this
harness. The list shows only what names it or its teams; the harness's own
reach table shows the full union with the source of each row.

**Organisation assets carry the reverse view**: which harnesses include them,
which teams they reach, and which security groups they need in order to work —
the incident runbook posts to Slack, so it requires the Support group. An asset
that is *always loaded* shows **all harnesses** rather than every row of the
other table.

### 10.2.1 People and teams

**People are a screen, not an implication.** Teams organise them, but an admin
needs somewhere to invite, see and deactivate, and the org table's "teams and
membership" row quietly assumed it.

**There is no per-person permission list, and that is the point.** A person
gets what their teams are granted. It follows that:

- **Adding someone to a team is the grant.** No second step, nothing to forget.
- **Removing them takes the access with it, in one step.** Session-scoped
  credentials die with their sessions; the only follow-up is rotating any
  stored key their teams shared, which the offboarding view names.
- **An invitation grants nothing.** Until it is accepted there is no
  membership, so there is nothing to revoke and no credential could exist.

**Three roles, and each is defined by what it may not do.** An **org admin**
approves builds, connects vaults and creates security groups. A **team admin** may
narrow what their team already holds — sub-granting (§8.2.2) — and may launch a
build still in beta; they cannot widen anything, create a security group, or change a
protection setting. A **member** uses what they are given.

**Teams render as a tree, collapsed to the top level.** The org's shape is its
top-level teams; sub-teams are detail you open when you want it. A sub-team is the mechanism for keeping something from part of a team
(§7), so a flat list hides exactly the fact an admin is looking for. Each team
shows what it sits inside, what sits inside it, who is in it, and which security groups
it holds.

### 10.2.2 A log per category, and one observed log

**One change log per macro category**, mirroring the navigation, because that
is how an audit is actually requested — *show me every permission change last
quarter*, not *show me everything and let me filter*:

| | Records | Source |
| --- | --- | --- |
| **Harness changes** | harnesses and organisation assets — pushed, promoted, accepted, declined, rolled back | git |
| **Permission changes** | vaults connected, security groups created and narrowed, boundaries set | git |
| **Provider changes** | builds approved, declined or moved to beta; routing defaults changed | git |
| **People changes** | invitations, role changes, deactivations | git |
| **Endpoints reached** | every endpoint a harness actually dialled | the fence and the broker |

**Permission and people changes were missing entirely**, which was the real gap
— those are the two an auditor asks for first. Because membership is the grant
(§10.2.1), the people log is also the record of who gained and lost access, and
when; no separate access-review report is needed to answer it.

**These logs are what git gives you that a settings page cannot.** Each row
carries an author, a time, the team it applies to, and the diff underneath. A
pending push shows what is waiting and on whom; a rollback shows what it went
back to. It is the same content as `git log`, shown to someone who does not
know git (§14, item 12).

Recording decisions matters as much as recording edits: *Aider declined,
3 March, no way to pin a build* is a row, so the next person to ask sees it was
decided rather than re-opening it.

The two logs also join up. `refund-lookup promoted to Marketing` notes that it
reached `api.stripe.com`, which is why that endpoint shows as new on the other
screen — a definition change explaining an observation.

### 10.2.4 Three surfaces, one model

The org console is the superset. The team and user surfaces are the **same
application** with different verbs — same chrome, same sidebar, same objects —
because a member who can see how a thing is put together can reason about it,
and one who is shown a summary page cannot.

**Both are navigable, not a single page.** A team has many harnesses and a
member runs several; the sidebar carries Harnesses, Changes, Conflicts, What we
hold, People. The counts in it are the work waiting.

**A harness opens into its files**, grouped by kind, each labelled with who owns
it — organisation, team, or you — and its state: unchanged, you changed it,
incoming, conflict, yours only. That ownership label is the whole inheritance
model made visible at the only place it matters, which is the file a person is
about to edit.

**This is where the git interface actually lives**, and it needs three screens
rather than a general-purpose git client:

| | What it answers |
| --- | --- |
| **A file's changes** | what changed, in a sentence, by whom and when — with *view as git* for the diff |
| **Conflicts** | you and your team both moved; nothing is overwritten and the session still runs on your copy |
| **Changes** | everything proposed or promoted, as a queue, with accept and decline for an admin |

**The conflict screen shows both texts side by side and offers exactly three
outs** — keep mine, take theirs, edit by hand. There is no automatic merge,
and the screen says why: a merge the platform got wrong would be
indistinguishable from one the person meant. This is `asset-sync.md` §4 row 5
given a face.

**The verbs differ, the screens do not.** A team admin sees *accept for
Marketing* and *narrow to a sub-team*; a member sees *push mine for review* and
*take the team's*. A member can read every file, including the organisation
ones they can never change, and each says so in place rather than being hidden.

Prototypes: `/team-preview` and `/user-preview`, sharing
`org-preview/scope-app.tsx`.

### 10.3 Who owns what

The org chart follows the two planes (§0), and the split answers most questions
about who may do a thing:

| | Owned by | Plane |
| --- | --- | --- |
| Harnesses, skills, tools, memories, prompts | **the team** | definition — their own branch |
| Vaults, secrets, security groups, providers, models, approval | **the org** | runtime |

**A team is the addressee of a grant, not the granter.** Teams manage what they
*do*; the org manages what they may be *given*. If a team admin could create an
security group, they could name a production secret, class it internal, and grant
it to themselves — which is precisely what the mint-time checks exist to prevent.

**Sub-granting is delegated, narrowing only.** An org admin creates a security group and
grants it to a team. A team admin may then pass it, or a narrower slice of it,
down to a sub-team within their own subtree. They may not add an entry their
team does not hold, change the class, or grant outside their subtree. This is
the tighten-only rule (§7, `prd.md` §1.3) applied to credentials, and it
removes the common request — a lead wanting an interns sub-team with a smaller
security group — without opening a path to self-elevation. Audit follows the tree: a
grant records who made it and which grant it was narrowed from.

---

## 11. Harness providers and approval

A **harness provider** is the runtime — Claude Code, Cursor, Pi. (It was called
an *agent* in `agents.md`; the rename is §1.)

**Approval is three states, and there is no separate policy object.** An org
arrives with every provider in the last of them.

| | Who may run it | Who may be handed credentials with it |
| --- | --- | --- |
| **Approved** | anyone it is scoped to | anyone |
| **Beta** | anyone it is scoped to | **admins only** |
| **Not approved** | nobody | nobody |

Beta covers both cases that matter — trying a third-party build before
committing to it, and reviewing a fork — and costs exactly one thing: until
approval, only an admin is handed a credential with it. Approval is a person
reading what the binary does with environment variables and network egress, and
a fork is pinned to a commit, never a branch, so what is reviewed is what runs.

**Not approved is a state, not an absence.** The catalogue lists every runtime
the platform knows about, all of it off until someone turns it on. A deliberate
no is recorded with its reason, so the next person to ask sees it was decided
rather than re-opening it.

The two fields are **approval status** and **approval scope** (org-wide, or
named teams) — one decision with two halves, named as a pair so the second does
not read as an unrelated property.

**Approval is about the runtime, never about what a team writes.** A team's new
tool, skill or prompt is never gated by it: those run inside a build that
already passed. The question is only whose program will hold the credential in
memory, and it binds when someone forks the runtime, which is rare. Read
carelessly this sounds like a gate on team innovation, which would be the
opposite of the product, so it is worth stating plainly.

**What approval does not cover, and what does.** A team's own tool can read the
environment it runs in, so approval does nothing about a careless or malicious
tool on a team branch. The egress fence covers that — there is nowhere to send
a stolen credential — and the team branch is reviewable because it is git.

**Model routing is two relations across three dimensions**, and the same two
words name all six columns:

| | teams | harnesses | harness providers |
| --- | --- | --- | --- |
| **Default for** | what this team's harnesses get | what this harness gets, whatever its team | what this runtime gets |
| **Approved for** | what this team may choose | what this harness may choose | which runtimes can speak to it at all |

*Default* is what you get; *approved* is what you may choose. Most specific
wins — harness, then harness provider, then team. Approved-for-providers is the
load-bearing one: a runtime absent there cannot route here at all, which is
what makes the pairing invariant checkable (`canRunOn`, below).

**There is no separate "org default" state.** It is *default for all teams* —
the same field with a wider scope. A distinct state added a concept and
answered no question the scope could not.

This is the third place the same scoping pattern appears — security groups
grant to teams and optionally name harnesses, boundaries apply to teams and
optionally name harnesses, routing defaults and approvals run across teams,
harnesses and providers. One vocabulary, three uses, which is what makes it
learnable.


**Compatibility is wire format, and it is derived rather than approved.** A
model provider exposes one or more API shapes — Anthropic, OpenAI-compatible —
and lists the models behind them. A harness provider **speaks** some set of the
same shapes: Claude Code speaks Anthropic, Cursor speaks OpenAI-compatible, a
self-hosted gateway usually exposes both. A runtime can reach an endpoint when
they share one. `wire_format` already exists in the schema (v3 A6), so this is
naming a fact the system has rather than adding one.

An earlier draft had an admin maintain an *approved for providers* list. That
said the same thing less accurately and went stale the first time a provider
added a format. Approval belongs on the build (§11); compatibility is arithmetic.

**Assets declare what they need from a model.** Most work against any shape; a
tool written against one API does not, and that is a property of the asset, not
of whoever happens to run it.

**So a harness can hold two things that disagree**, and this is the case worth
naming: an asset needing the Anthropic format, in a harness routed to an
OpenAI-only endpoint. Preflight catches it and **refuses, naming the asset** —
*Long-context summariser needs the anthropic format* — rather than starting and
dying halfway through with a stack trace from somebody else's API.

A harness therefore carries one derived **Preflight** state — passing or
failing, named for the check that produces it — with two possible causes: no runtime its team may use speaks its model
provider's format, or an included asset needs a format that provider does not
expose. Both are computed from wire format; neither is stored on the harness.

**A failing check says what is wrong, what to do, and links to the thing to
change.** *"Long-context summariser needs the anthropic format, and OpenRouter
exposes openai. Either drop it from this harness, or route it through a
provider exposing anthropic."* with a link straight to the asset. A status
that names no remedy and no destination is a status somebody has to come and
ask about, and the person asking usually cannot fix it themselves.

**An asset's security-group needs are aliases, not groups.** An asset says it
needs `slack`; any group with an entry aliased `slack` answers it, and which
one actually does depends on the team. So the console shows **compatible
security groups** — the candidates — rather than a binding that does not exist
at definition time. That is derivable precisely because a group's entries are
alias-to-secret pairs (§8.2.2). The invariant
follows: **every harness needs at least one valid pairing** — a provider its
team may run, and a model provider approved for that provider. A harness with
none cannot launch, and preflight says so before anything starts.

**A harness is never tied to a harness provider, and does not carry one as a
column.** A harness works on any runtime; which one is used is a launch choice.
The only thing worth surfacing is the failure case, so a harness shows **cannot
launch** when nothing its team may run shares a wire format with its model
provider — derived from `canRunOn`, which is itself derived from format and
team permission. Listing the compatible runtimes per harness implied a
constraint that belongs to the pairing, not to the harness.

**Where it is enforced.** The broker checks approval state and the `must expire`
requirement at mint (§12). Being granted a security group is necessary; these decide
whether it may actually be minted for the build in front of it.

## 12. Where enforcement lives

`plan-improvement.md` F1 settled this and it does not move: **the fence is
where the credentials and the network are; everything the client does is UX.**

| Control | Enforced at | Against |
| --- | --- | --- |
| Which branches you may read | the git server's per-ref authorization | everyone |
| Approval state — and admin-only for a build in beta | **the broker, at mint** | everyone |
| `must expire` on a security group | **the broker, at mint** | everyone |
| Egress and filesystem scope | the sandbox / jail | the agent |
| Provider binary pinned to a hash | the launcher | the agent |
| Drift, unsatisfied needs, adapter output validation | preflight | nobody — it is a check, not a fence |

**Preflight is a detector, not a boundary.** It runs where the person is, and a
user with administrator rights owns that machine. So both mint-time rules are
recomputed by the broker, server-side; preflight's copy
of it exists to give a good error before launch rather than a cryptic failure
after.

Every claim is worded the `enforcement-philosophy.md` §1 way — *the agent
cannot exceed the boundary*, never *the user cannot*. Per-ref authorization is
the one control in this document that holds against a user too, and only
because unread bytes have no route to the machine.

---

### 12.1 Reach: two ends and one switch

**Decided.** What a harness may reach has two ends that need no decision, and
one gradient that does:

| | Reachable? | Authored by hand? |
| --- | --- | --- |
| **Credentialed endpoints** — behind the security groups it holds | always | no — derived from grants already made |
| **Its model provider** | always | no — derived from its routing |
| **Boundaries** | never | yes, deliberately |
| **Everything else** | only if **outside endpoints** are allowed | one switch per harness |

**The switch is called _outside endpoints_, allowed or prohibited** — the same
word as the log of what was actually dialled (*Endpoints reached*, §10.2.2).
A permission and its record should not use different vocabulary for the same
thing.

**It is a grant, not a switch.** It is a security group like any other — its
entry is the search provider's key — so it goes through the same machinery as
every other credential: granted to teams, and **optionally narrowed to named
harnesses**.

That optional third dimension is what makes per-harness control possible
without a second mechanism. A grant that names no harnesses covers every
harness its teams own, which is the usual case. A grant that names them covers
only those. So Marketing has outside-endpoint access throughout, while Engineering has it
for Code review and not for Schema migrations, which touches the production
database and has no business browsing.

It is **least privilege by job rather than by person**, and it does not
reintroduce the per-person list deleted in §6 — a harness is a context, not a
person.

**Scope is a property of the grant, so a differently-scoped grant is a
different grant.** One security group cannot be team-wide for Marketing and
harness-specific for Engineering at once; that is two grants, and the list
shows them as two. Trying to express both in one was the first thing that
broke when this was built.

Whether a harness has outside-endpoint access is therefore **derived** from the grants that
cover it, never stored on the harness — the same rule as §11's computed
provider list.

**Outside endpoints prohibited** means the harness reaches what it was granted and nothing
more.

This is why the allowlist objection does not apply. The problem with
deny-by-default was never the list; it was making a human author one endpoint
at a time. Here the list is almost entirely *derived* from grants already made,
and the only human decision is a single switch.

**Boundaries override everything**, including outside-endpoint access.

**They compound, by union.** A harness is covered by every boundary that names
it, its teams, or the whole organisation. Union is monotone: adding a source
can only ever narrow reach, which is what makes "set it once at the org" safe,
and what lets a team add its own without anyone checking whether it conflicts.

**Every boundary declares whether it is enforced or advisory**, because a
control that only looks like a fence is worse than none — people plan around
it.

| | What it is | What it holds against |
| --- | --- | --- |
| **enforced** | no route, no permission, or the binary is not there | whatever the agent tries |
| **intercepted** | every invocation checked before it runs | the thing attempted directly; not the same thing written another way |

**Command boundaries ship as a real feature, paired with a capability boundary
behind them.** Both halves are needed and neither replaces the other.

*Intercepted* is the command layer, and it is made properly rather than
token:

- **Checked in two places** — the provider's permission hook before any tool
  call, and a shim ahead of the real binary in the sandbox, so a script hits it
  too.
- **Matched on the resolved command**, not the raw string: binary path resolved
  and flags normalised, so `/bin/rm` and `rm -r -f` read the same as `rm -rf`.
  Naive string matching is the version that is worth nothing.
- **Starts from a curated list we ship** — the commands that destroy machines.
  An org adds to it; nobody invents it from scratch.
- **Every block is logged** with the exact command, the harness and the person,
  so the layer feeds the change record rather than failing silently.

*Enforced* is the capability layer behind it: **writes outside the work tree**
is a filesystem permission the sandbox applies regardless of what program asks,
and **privilege escalation** is enforced by `sudo` not being in the sandbox at
all. A boundary enforced by leaving something out is the strongest kind —
there is no lever to find.

**What interception will not catch** is the same effect written another way: a
Python script, a compiled binary, a novel flag order. That is not a reason to
skip it — it catches what actually happens, which is an agent running the
command directly — it is the reason the capability boundary sits behind it.
`enforcement-philosophy.md` §2 applied to commands: the check is real and the
coverage is stated, and neither is described as more than it is.

**A boundary takes the same scoping as a security group** — org-wide, named
teams, or named harnesses — so a single restriction never needs a sub-team
invented to carry it.

**Security groups and boundaries are deliberately separate objects that share
one scoping model.** Both apply org-wide, to named teams, or to named
harnesses; they compose in opposite directions. That symmetry is a feature —
the scoping vocabulary is one thing to learn, and "Applies to / Only for" means
the same on both screens. The distinction is a sentence on each: a security
group **gives**, a boundary **takes away**.

**Their union is computed, on the harness.** The *What it may reach* table is
where the two meet: every row names the object that decided it — security
group, boundary, model provider, or web grant. That is the one place policy
actually lands, and it is derived, never authored.

**Merging them was considered and rejected.** The dispositive reason:
`prd-v2.md` already delegates *narrowing* a security group to a team admin
(§8.2.2). If one object carried both grants and denials, narrowing would be a
privilege-escalation path — a team admin drops a denial by narrowing a grant
they hold. Three further reasons are in §16.

**A boundary is never carried by a security group.** Grants and denials compose
in opposite directions: if a group held both a credential and a denial, then
removing that group from a harness would remove the denial too, and revoking
access would *widen* reach. That inversion is hard to see coming and impossible
to reason about afterwards. Boundaries attach to the tree and to named
harnesses; they relate to groups by covering the same things, never by being
held inside one.

**Three layers, in order of how hard they hold:**

| | What it is | Holds against |
| --- | --- | --- |
| **Boundaries and the web switch** | no route exists | the agent, absolutely |
| **Credentials** | nothing reachable is useful without one, minted per session | the agent and the person |
| **Memories and prompts** | standing instructions not to do a thing | nothing — guidance, worth having anyway |

**What the product may claim, and it now depends on the harness.**
`enforcement-philosophy.md` §2's claim survives, conditionally:

- **Outside endpoints prohibited** — *the agent reaches only what it was granted.* The strong
  claim, intact.
- **Outside endpoints allowed** — *the agent cannot cross a boundary.* Weaker, and honest.

Both are enforced the same way: a packet with nowhere to go. The switch is
shown on the harness, so which claim applies is visible rather than assumed —
and that visibility is the point, because a conditional claim stated
conditionally is still true.

**The deny list must be well made**, which is why boundaries are a screen with
reasons attached rather than a config file, and why the endpoint log exists: an
unaccounted-for endpoint is how the next boundary gets found. `api.openai.com`
appearing in the log and becoming a boundary the same week is the loop working.

**Boundaries live under Permissions**, with the credential screens. A boundary
takes something away from everyone; an asset is something given to someone.

---

## 13. Surfaces

**Local, general-purpose** (chat, shell, full repo access) is the product.
Full filesystem access, offline capability, composable tools; the launcher runs
on the person's own machine. The honest claim is entitlement enforced per
session — that machine can still read its own environment during that session,
and this is not a claim that keys never touch it.

**Narrow-scope (TUI, fixed jobs)** is architecturally reserved, not a near-term
requirement. A menu whose options come from preflight's satisfied list, so
nothing is offered that will not work; a form with typed fields cannot wander
outside its job or be prompt-injected the way open text can. All that must be
true now is that the IR carries a per-asset audience flag and the provider
registry is general enough to carry a custom render target. Both are free
today and expensive to retrofit.

---

## 14. Build inventory

### Keep — built, load-bearing, unchanged

- `asset-sync.md` §3–§8 entire: the local git work tree, `refs/harness/remote`,
  the §3.1 invocation flags, the §4 hydration table and its idempotency test,
  `shadows`, and the five commands.
- `resolve.py` resolution semantics — nearest-ancestor-wins becomes branch
  precedence, but the rule and its tests survive.
- `harness push` → `push_review` → `/approve`, and `promote` / `rollback`.
- `org_unit_boundaries` + `merge_boundaries`: top-down, tighten-only.
- `harnesses.md` in full: the harness as a filter, the empty harness, the
  `model-default` connection resolving over the whole set.
- Adapters and the adapter registry; the filesystem enforcer; the egress fence.
- Capability vocabulary and tool gating (v3 A1); model policy and `wire_format`
  (v3 A6).
- `enforcement-philosophy.md` entire.
- Audit split into authoritative and attested (F9).

### Drop

- `asset_scopes`: table, endpoints, backfill, and the owned/available concept
  (§6).
- Nested orgs (§2).
- Definitions as the primary copy in Postgres (§3.1).
- Harness contents keyed by `(kind, name)` (§5.1).
- Postgres via pgsodium as the *permanent* home for secret values (§8.2).
- `asset-sync.md` §9's "no server-side git."
- The word *agent* for a runtime (§11).
- **Sensitivity classes and a policy object** — production / internal /
  development, and the screen that held them (§11, §16).
- **Agent self-reporting of activity** — no required tool asks a harness to log
  what it touched (§10.2.2, §16).
- **Any binding of a harness to a provider** (§11, §16).

### Add

1. **Durable asset id** in a uniform sidecar; validated at push and preflight.
2. **Git server with per-ref authorization** — what makes §7 a boundary rather
   than a convention.
3. **Definition migration**: repos become source of truth, Postgres index
   derived, rebuildable, and storing **edges** as well as assets (§3.1).
4. **Sparse-checkout materialization** driven by the harness subscription list.
5. **`probe()` per resource kind**, and the three evidence levels through the
   whole status path.
6. **Preflight**: dependency walk, drift detection by rehydrate, adapter output
   validation, chain composition.
7. **Exit reconciliation**, with preflight as the unclean-exit fallback.
8. **Credential chain**: fixed order (explicit → vault → ambient), `sources
   allowed` per security group collapsing it to one entry where required,
   fail-closed rather than fall-through, and **`resolved from` reported per
   slot by preflight and retained with the session**.
9. **Broker**: resolver interface, session-scoped mints, and both rules
   recomputed at mint — approval state and `must expire` (§12).
10. **Security groups as security groups**: alias → secret entries, mint
   parameters, the `must expire` switch, and narrowing sub-grants (§8.2.2).
11. **Vault inventory**: list-permission reads, provider → group → secret,
    orphan and broken-pointer detection, honest degradation without list access.
12. **Provider registry**: three approval states, approval scope, pinned
    provenance for forks, and the model-provider pairing (§11).
13. **`canRunOn`** — computed provider list per harness, and the refusal to
    launch when it is empty.
14. **How an organisation asset loads**: always loaded, or when chosen (§10.1).
15. **Boundaries**: a deny list of endpoints, commands, filesystem and
    capability rules on the org branch, each declaring whether it is enforced
    or intercepted; command interception via provider hook plus sandbox shim,
    matched on the resolved command, seeded from a curated list we ship,
    inherited downward and tighten-only, with a team able to add for itself and
    never to lift (§12.1).
16. **Two logs** (§10.2.2): changes, from git; endpoints reached, from the
    fence and the broker. Neither is agent-reported.
17. **People**: invitations, three roles, deactivation, and the offboarding view.
18. **Rehydrate** in the compiler — native config back to IR.
19. **Console as a git client**: an admin edit is a commit, approve is a merge,
    promote moves one path, rollback is a revert. Presentation is decided —
    plain language by default, "view as git" on demand, and the two views must
    never disagree.
20. **Terminology rename** through `agents.md`, the CLI, and the homepage.

### Later

- **OpenBao** as the bundled provider, behind the same `resolve()`/`probe()`
  interface. Verify licensing and fork status first; bundling a vault means
  owning seal/unseal, backup and DR, so it is a deliberate later step.
- **Brokered OAuth** — platform-run consent and refresh, tokens in the org's
  own vault under per-person paths, which is what moves Slack and Google from
  *declared* to *verified* (§8.4).
- **A publishing source above the orgs** — a publisher, not a parent: a
  repository each company's root may pull from, holding no policy and granting
  nothing. Deferred until a customer has the problem; the durable asset id
  means hand-made copies can be recognised as the same asset later.
- **Narrow-scope TUI** as a third render target (§13).
- **Automations and the customer-owned runner** (F3), SCIM/SAML offboarding
  (F8) — unchanged by this document, still required for GA.

## 15. Open questions

Settled during this document's revision and recorded above: grant versus
self-subscribe (§6), console presentation (§10.2), the three deep key vaults
(§8.2.1), delegation of sub-grants (§8.2.2), the shape of a cross-company
publisher (§14), and **egress posture** — derived reach, one web switch, a deny
list (§12.1). The `rerere` question is void — the platform composes rather
than merges (§3.2).

What remains:

1. **Where `must expire` belongs, and what it is called.** It sits on the
   security group (§8.2.2) because the security group is what gets minted, and a security group holding
   a stored string cannot carry it. The alternative — declaring it on the
   secret and inheriting it — was never properly weighed once the class model
   collapsed.
2. **OpenBao licensing and fork status.** A lookup, not a judgement.
3. **Console git legibility, as a design.** The presentation is decided; how
   promote, approve and rollback are actually drawn for an admin who does not
   know git is unwritten, and is the largest piece of design work this document
   creates.
4. **Cross-company administration.** An agency admin holding admin in several
   sealed companies can act inside each. That it must appear in *both* audit
   trails is stated; whether more is required — notice, consent, a distinct
   role — is undecided.

---

## 16. Decisions reversed

Ideas this document held and replaced. Recorded so they are not re-proposed,
and so the sections above can be read as normative rather than as history.

| What we had | What replaced it | Why |
| --- | --- | --- |
| Three sensitivity classes (production / internal / development) and a Launch rules screen | Three **approval states** on the provider, plus one `must expire` switch on the security group (§11, §8.2.2) | The middle class was identical to the loosest in practice, and the rest restated provider approval. Two booleans had been dressed as three presets. |
| Agents self-report what they connected to | The **egress fence and the broker** (§10.2.2) | The model describing its own behaviour is *reported* at best, and is what a prompt injection would falsify. Both replacements are observed facts. |
| A resource catalogue an admin maintains | **Endpoints reached** — an observed, past-tense log (§10.2.2) | Nothing can scan a company and enumerate its databases, and nothing hooks a resource. Only an security group can be refused. |
| A harness bound to a provider | **`canRunOn`**, computed (§11) | Modelling the runtime as an attribute asserts the opposite of portability. |
| A grant as one alias → one secret | A **security group** of alias → secret entries (§8.2.2) | Matches what vaults already call a role, and a team with three secrets needed three objects. |
| `required` / `optional` on org assets | **always loaded** / **when chosen** (§10.1) | The question is what the org is doing with the asset, not what a permission forbids. |
| Sensitivity on the resource | The credential rule on the **security group** | The security group is what gets minted, so it is the only thing that can be refused. |
| One object carrying both grants and denials ("security groups with deny entries") | **Two objects, one scoping model, union computed on the harness** (§12.1) | Narrowing a group is delegated to team admins, so a merged object makes narrowing a privilege-escalation path. Grants and denials also compose in opposite directions, so a merged object is monotone in neither, and `prd.md` §1.3 already separated them — capabilities resolve bottom-up, boundaries inherit top-down and tighten only. |
| *Credential strength*, then *lifetime*, on a secret | **Where it comes from** — vault-supplied or locally-owned (§8.2.2) | "Strength" read as a security grade and "lifetime" still had us judging how a customer manages keys. The only distinction that is ours is whether we supply the credential. |
| `must expire` on a security group | **Sources allowed** — vault only, or vault or local (§8.2.2) | The conventional control is which entries are in the credential chain, not how long a credential lives. It also stated a group-level fact about lifetime when a group's entries can span vaults. |
| A hygiene column — rotation age, unused flags | **Nothing.** We record what a provider reports and never grade it | Rotation cadence is the vault's business and unused-key policy is the customer's. Inventing one on their behalf is overreach dressed as helpfulness. |
| Egress allowlist as the record of expected reach | **Derived** expected reach, deny list as the control (§12.1) | An allowlist an admin must author is a gate on ordinary work; what is wanted is knowing what a harness will probably touch. |
| Deny-by-default egress with an authored allowlist | **Derived reach + one web switch + a deny list** (§12.1) | The objection was never the list, it was authoring it. Derived from grants, the list needs no author; the strong claim survives for any harness with outside endpoints prohibited. |
