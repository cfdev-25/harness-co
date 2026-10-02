# Product Requirements v2 — The Management Framework

How capability, access, and policy are structured, managed, and inherited
across an organization.

**This document supersedes [`prd.md`](prd.md).** Where the two disagree, this
one wins. **Part I and Part II are normative: if code and this document
disagree, the code is wrong.** Part III is delivery — what to build, what was
decided along the way, and what is still open.

> **Governing principle, unchanged from `prd.md`.** Every capability removes
> stress from the foreground by doing more in the background. We ship
> explainability, not features. If a capability adds a concept the user must
> learn, it does not ship.

**How this document is written.** A decision appears in exactly one section.
Everywhere else refers to it by number. History — what was tried and why it
was replaced — lives only in §25, so the sections above it read as rules, not
as a record of arriving at them.

Related: [`asset-sync.md`](asset-sync.md) (the work tree),
[`harnesses.md`](harnesses.md) (the harness as a filter),
[`enforcement-philosophy.md`](enforcement-philosophy.md) (what a boundary is),
[`plan-improvement.md`](plan-improvement.md) (ratified fixes F1–F9),
[`scoping.md`](scoping.md) (the model this reverses).

---

# Part I — The rules

Seven rules carry the whole design. Each has a section; the sections after
them say how the rules combine.

| # | Rule | § |
| --- | --- | --- |
| 1 | Definitions are git. Credentials are not. | 1 |
| 2 | An org is a chain of branches, composed by precedence, never merged. | 2 |
| 3 | Presence on a branch in your chain is reach. A harness only takes away. | 5 |
| 4 | Per-user content is additive. Withholding is placement, a narrower group, or a boundary. | 5 |
| 5 | Grants give, boundaries take away; both use one scoping model; a team admin may only narrow. | 6, 7, 13 |
| 6 | Enforcement is the broker and the fence. Preflight is a detector. | 11 |
| 7 | Every fact is declared, observed, or derived, and says which. | 6.6, 14 |

---

## 1. Two planes

> **Definitions are git. Credentials are not. Nothing else may blur that line.**

| Plane | Holds | Where |
| --- | --- | --- |
| **Definition** | tools, skills, prompts, memories, MCP definitions, permission rules, the harness itself | git — branched, reviewed, diffed, blamed, rolled back for free |
| **Runtime** | credentials | the broker and the launcher — resolved at launch, never written to the repo, never versioned |

Nothing in the definition plane is secret, which is what makes a harness
portable: it compiles *to* each provider and is authored *for* none. The
consequence we care about: reviewing a skill never requires touching a secret,
and rotating a secret never requires a code review.

---

## 2. The org is a chain of branches

```
Org                      exactly one root. Policy lives here and nowhere else.
├── Team                 n layers deep. A team may contain teams.
│   ├── Team (sub-team)
│   │   └── User         leaves.
│   └── User
└── Team
    └── User
```

**One org root.** Org-level configuration (§15) is admin-only by construction
because exactly one node can hold it. A holding company or an MSP tenant is
its own org, not a subtree; cross-tenant sharing is out of scope for v2.

**n team layers.** Depth is free and is the mechanism for withholding (§5.3).
Subsidiaries, divisions, squads and sub-teams are all team layers.

**Users are leaves.** A user node is a branch like any other; nothing forks
from it.

**Every node is a branch.** Team branches fork from their parent, user
branches from their team. A person's machine holds a clone, and their local
work tree is a branch off their user branch — `asset-sync.md` §3 already
implements this with a real git directory at `~/.harness/assets.git`.

**Precedence is branch topology.** A team's version of an asset supersedes the
org's for that team because it is the version on that branch.

**The platform never runs `git merge`.** The effective harness is *composed*
from the refs in the chain by precedence and delivered per `asset-sync.md`
§4 — build `incoming` from the resolved chain, reconcile per key against the
work tree. A new org asset reaches every chain that includes org with nothing
to propagate; a team branch holds only its own content and overrides. A child
branch therefore **starts empty**: there is no copy-down step and nothing on
it to delete.

**A technical user may merge by hand in their clone.** A branch keeping its
own version of a path declares it with `.gitattributes` `merge=ours`, so the
exception is content — visible in a diff, reviewable in a pull request. An
exception that stops conflicting also stops receiving fixes, and
`asset-sync.md` §5's `shadows` reports that at preflight: *the parent's
version advanced while your override is in effect*. Never auto-resolved.

---

## 3. Storage

| | Lives in | Source of truth | Rebuildable |
| --- | --- | --- | --- |
| Assets, harnesses, policy, catalog, registries | bare git repos, one ref per node | **git** | — |
| Definition index — what resolves where, and the **edges** between things | Postgres | derived | yes, by re-reading the repos |
| Records — audit, sessions, cost, run-state | Postgres | **Postgres** | no |

**The index stores edges, not just assets.** An admin's questions are
relational — *rotate this and what breaks?*, *revoke this team and what do
they lose?* — and span every branch in the org. Git cannot answer them without
walking every ref, so relationships are part of the index (§14).

**One restore order:** repos, reindex, records. No moment where two stores
must agree about the same fact. `assets`, `asset_versions` and `asset_files`
were already content-addressed and immutable, so this is a change of storage,
not of model.

---

## 4. Assets

### 4.1 Identity

Every asset carries a **durable id in its own files** — the uuid it already
has in `assets.id` — in **one uniform sidecar per asset directory**. A tool is
a directory with an executable `run` and nowhere for frontmatter, so a sidecar
keeps the layer kind-agnostic (`asset-sync.md` §2: a new kind costs one line).

The path cannot be the identity: renaming `tool/deploy` to `tool/ship` would
silently unsubscribe everyone. This is a deliberate exception to *as
git-native as possible*, taken because subscription and audit both need an
identity that survives a rename.

| Same path, two branches | Meaning | Result |
| --- | --- | --- |
| same id | an override | branch precedence decides |
| different ids | a conflict | surfaced, never silently shadowed |
| **Same id, different paths** | the same asset, renamed | subscription follows it |

Git carries whatever id a file claims, so all three are validated at push and
again at preflight.

### 4.2 Subscription and materialisation

A harness is a list of asset ids. On disk the working copy is **sparse**: the
chain provides everything; the working copy holds only what the person
subscribes to — the union of their harnesses' contents plus what is always
loaded — and per-session filtering happens at render. The mechanism is the
hydration table (`asset-sync.md` §4, engine plan 01), not git's
`core.sparseCheckout`: an unsubscribed path is simply never materialised, so an
upstream change to it collides with nothing, and a push carries only the paths
it names, so nobody else's paths are ever deleted.

The only conflict left is the honest one — you edited a path and the parent
edited the same path. `asset-sync.md` §4 row 5 handles it: refuse to write,
notify, let the person `push` to keep theirs or `reset` to take the parent's.

### 4.3 Dependencies

`needs:` covers assets as well as resources. A subscribed skill calling an
unsubscribed tool is an unsatisfied need, and preflight (§10) walks
asset→asset dependencies alongside asset→credential ones.

---

## 5. Reach: grant, filter, withhold

### 5.1 Grant and filter are different questions with different owners

| | Question | Owner | Mechanism |
| --- | --- | --- | --- |
| **Grant** | May you have this? | an admin | the asset's presence on a branch in your chain |
| **Filter** | Which of what you have does this harness load? | the person | the harness's subscription list (§4.2) |

**A person may subscribe to anything present in their chain.** There is no
per-person availability list. Subscribing loads an asset into a session; it
does not hand over the credential the asset needs (§6), and withholding is a
structural decision an admin takes deliberately (§5.3), not a checkbox they
forget.

**Granting is committing onto a branch.** An org gives a connector to five of
ten teams by committing it onto those five team branches — reviewable,
revertible, attributable. `asset_scopes` and the owned-versus-available
distinction are retired; their semantics survive as branch membership.

### 5.2 The one exception to "a filter only takes away"

A compliance memory a person can unsubscribe is not a compliance rule. So each
org asset declares how it loads:

| | Meaning |
| --- | --- |
| **Always loaded** | into every harness; no filter can leave it out; preflight refuses to launch without it |
| **When chosen** | published and available; whoever builds the harness includes it |

Framed as *how it lands*, not *whether it can be removed*: the question is
what the org is doing with the asset.

### 5.3 Withholding

**Per-user branch content is additive.** Every member of a team must read the
team branch for inheritance to work, so removing a file from one person's
branch withholds nothing — they can fetch the team ref, and `asset-sync.md` §1
makes the working copy theirs to check it back out. Subtraction therefore
happens by structure, never by per-person filtering.

Three instruments hold. A fourth looks like one and is not.

| To give someone less | Instrument | Holds because |
| --- | --- | --- |
| **Credentials** | a narrowed security group — a subset of the entries handed down (§6.4) | the entry resolves to nothing; enforced at mint |
| **What it may reach** | a boundary scoped to the sub-team; shrinks reach by *adding* denials (§7) | enforced by the fence |
| **Files** — guides, tools, memories | place the file on a sub-team they are not in | the git server authorises per ref (§11): a branch you are not on is a branch you cannot read |
| *Harness contents* | *leave the file out of the harness* | **it does not.** Context only: the file is on a branch they *are* on, and they can put it back |

**Credentials and reach hand down as things a team admin may issue less of.
Files are the exception:** a team admin can issue a sub-team *more* files than
they hold and never fewer. That asymmetry is why withholding a file is
placement on a sibling, not removal from a child — the senior-only tool is
committed to `marketing/senior`, and interns forking from `marketing` never
see it. **Nobody reorganises a team to withhold something for the first
time**: the withheld thing is new work placed one level down, not existing
work moved.

Placement governs read access going forward; anyone who leaves a sub-team
keeps the clone they already had, the same way a rotated key leaves old
copies behind.

**Give someone more** the same way: a memory for one person is a commit on
their user branch.

**There is no team-level asset-reduction surface.** A harness already filters
its own contents; a team-scoped copy of the same idea reintroduces the
owned/available toggle retired in §5.1.

### 5.4 Sub-teams

A sub-team is a branch under its parent (§2). Creating one asks **name,
parent, who is in it** — nothing else, because it starts empty and
composition supplies the rest. *Create a sub-team* and *narrow a security
group into it* (§6.4) are two verbs, kept apart: folding the second into the
first would imply a sub-team is defined by its credentials.

---

## 6. Credentials

### 6.1 The platform holds references

The platform's code path never holds a secret value. It holds a reference and
asks a **resolver**. Every provider — AWS Secrets Manager, Azure Key Vault,
HashiCorp Vault, 1Password, the one we host, and the person's own machine —
implements the same two calls:

| Call | Does |
| --- | --- |
| `resolve()` | mint a credential against a security group: read-only on the secrets the grant names, tagged with person and session, expiring with the session |
| `probe()` | is this ready — without returning a value |

`probe()` is the primitive the whole status model rests on (§6.6, §10).

### 6.2 Providers

**The bundled provider.** "Go stand up Vault first" is a bad first step, so we
host our own vault behind the identical interface. The paste-a-key, name it,
scope it, rotate-as-a-new-version experience ratified in `plan-improvement.md`
F2-bis survives on it. Until it ships, the existing registry *is* the bundled
resolver; the swap is a resolver implementation, not a change to anything that
calls it (OpenBao: §22 Later).

**One interface, no grades.** Every vault implements the same two calls and
every vault can be confirmed before launch. What a customer needs to know is
that the key exists and is secured; that is what the console says. What
differs between providers is an engine fact, stated per slot and never as a
rank: whether the vault hands us something **minted** for this session that
expires with it, or a **stored** value we hold under a lease and stop
supplying when the session ends. Neither is "weaker" to the person; both
resolve at launch or the launch fails.

The first three providers are **AWS Secrets Manager, Azure Key Vault,
HashiCorp Vault** — the two dominant clouds and the on-premises standard;
Azure because the Tier-1 OAuth surface is Microsoft 365. Others follow
behind the same interface without callers changing (engine plan 11).

**What we read and never write.** Listing is a separate permission from
reading in all three, so an inventory of names, groups, tags
and rotation age costs the customer no value exposure. We ask for list
permission and say what it buys; without it the console shows what an admin
declared and says it can show no more. **We never write to a customer's
vault** — creating or rotating lives on our hosted vault only; for theirs, the
console reads and links out.

**The person's own machine is listed as a key vault.** It is somewhere
credentials come from, so no row in the inventory has a blank provider. Its
screen states the limits: we can probe whether a login is present and show the
command that creates it; we cannot read it, rotate it, hand it to a harness,
or confirm it before launch.

### 6.3 A security group is a named set of secrets

A security group has a **name**, the **teams** it is granted to, optionally
the **harnesses** it is narrowed to (§13), the **parameters used to mint**
(assume-role duration, session tag, lease TTL), which **sources** may fill it
(§6.5), and a list of **entries** — each an **alias** and the secret it
resolves to. Marketing holds `crm` and `email`; Marketing interns holds `crm`.

Why an object rather than joining teams to secrets:

- **The alias.** A harness declares `needs: db`, never `secret/db/all-read`.
  The group binds the alias per team, so one harness runs at two teams with
  different vaults. Without it, vault layout is hard-coded into a shared
  definition and portability is gone.
- **How to mint, not just what.** A property of this team's grant, not of the
  secret.
- **It always exists.** For a vault we cannot list, the group is all there is.

It stands in for what the vault already calls a role or an AppRole. **The
vault sets the ceiling and we lower it, never the reverse**: a shared role
referenced by three groups renders from the secret's side as three teams, and
what the platform decides is which of them may have it minted.

**An asset's needs are aliases, not groups.** An asset says it needs `slack`;
any group with an entry aliased `slack` answers it, so the console shows
**compatible security groups** — candidates — rather than a binding that does
not exist at definition time.

### 6.4 Sub-granting is delegated, narrowing only

An org admin creates a security group and grants it to a team. A team admin
may pass it, or a narrower slice of it, to a sub-team in their own subtree.
They may not add an entry their team does not hold, change which sources it
accepts, or grant outside their subtree. A grant records who made it and which
grant it was narrowed from. This is one use of the narrowing primitive (§13).

If a team admin could create a group they could name a production secret and
grant it to themselves — which is what the mint-time checks exist to prevent
(§11). **A team is the addressee of a grant, not the granter.**

### 6.5 Where a credential comes from

The only distinction that is ours:

| | Meaning |
| --- | --- |
| **vault-supplied** | we resolve it at launch from a key vault. We can confirm it before the session starts and stop supplying it |
| **locally-owned** | a browser sign-in or machine login the person made. We never hold it, cannot inject it, and learn of it once the session is up |

How long a key lives, when it was last rotated, and whether anything still
uses it are the vault's business and the customer's. We record what a
provider reports and never grade it: **no hygiene column, no overdue flag, no
disuse signal, no recommendation.**

**Credentials resolve down a fixed chain — explicit override, then vault,
then ambient login — and each security group says how far down it will go:**

| Sources allowed | Meaning |
| --- | --- |
| **vault only** | one entry in the chain. If the vault does not resolve, the launch **fails**; it never falls back to what the person happens to be logged into |
| **vault or local** | an ambient sign-in is acceptable, and the fallback is never silent |

**Fail closed, not fall through.** A chain that quietly falls back works on
one laptop and not another and uses the wrong identity in CI. The order is
fixed and not configurable per person; what varies is how far down a group
permits. The broker enforces this at mint (§11): a vault-only group is never
minted from a non-vault source.

**Preflight reports which source resolved each slot** — *resolved from the
Finance group*, *resolved from your local AWS session* — **and the session
keeps that record**, so *how did this run as that identity three weeks ago* is
answerable from our logs. This one field is what makes a chain safe to have.

### 6.6 Three evidence levels

Status is never a boolean. Every slot reports how it was established, and
nothing rounds up:

| Level | Meaning |
| --- | --- |
| **verified** | the platform confirmed it |
| **harness-reported** | the provider says so |
| **declared** | expected, unobserved |

This is what stops the class of overclaim inventoried in
[`homepage-promises.md`](homepage-promises.md).

### 6.7 What the broker cannot hold

**OAuth** (Slack, Google, Jira, Outlook) is minted by browser consent and held
in the provider's own store. Preflight treats it as **deferred** — declared,
checked once the provider is up, never counted as satisfied. Brokering it is
§22 Later; if we ever do, the brokered tool performs the call and returns
results, never a token.

**Ambient CLI logins** (`gh auth login`, `aws sso login`) cannot be held or
injected, but the platform can **detect** (probe), **guide** (show the
command), **upgrade** (inject a brokered token to convert ambient into
managed), and **constrain** (command boundaries, §7).

**The inventory is the whole authentication surface**, named *Secrets
inventory*: secrets in vaults, personal sign-ins held by the harness provider,
and ambient machine logins — one answer to *how does this authenticate*. Each
row says what we can and cannot do with it. Browsing is provider → group →
secret, and two findings fall out: a **secret nothing covers** and a **group
pointing at a secret that no longer exists**.

---

## 7. Boundaries

A boundary is a **deny**: an endpoint, a command, a filesystem or capability
rule. Boundaries live on the org branch, are inherited downward, and
**tighten only** — a team may add for itself and below, never lift.

**They compound by union.** A harness is covered by every boundary naming it,
its teams, or the whole org. Union is monotone, so *set it once at the org* is
safe and a team can add its own without checking for conflict.

**They scope like every other policy object** (§13): org-wide, named teams,
named harnesses. A single restriction never needs a sub-team invented to
carry it.

**Every boundary declares how it holds:**

| | What it is | Holds against |
| --- | --- | --- |
| **enforced** | no route, no permission, or the binary is not there | whatever the agent tries |
| **intercepted** | every invocation checked before it runs | the thing attempted directly — not the same thing written another way |

A boundary enforced by leaving something out — no `sudo` in the sandbox — is
the strongest kind; there is no lever to find. Writes outside the work tree
are a filesystem permission the sandbox applies regardless of what asks.

**Command boundaries** are the intercepted layer, made properly or not at all:
checked in the provider's permission hook *and* a shim ahead of the real
binary; matched on the **resolved** command (`/bin/rm`, `rm -r -f` and
`rm -rf` read the same); seeded from a curated list we ship; every block
logged with the command, harness and person. What it will not catch is the
same effect written as a script — which is why the enforced layer sits behind
it, and why coverage is stated rather than implied. Build timing: §22.

**A security group and a boundary are separate objects that share one
scoping model.** A group *gives*, a boundary *takes away*, and they compose in
opposite directions. Two reasons they can never be one object: narrowing a
group is delegated to team admins (§6.4), so a merged object would let a team
admin drop a denial by narrowing; and if a group carried a denial, revoking
the group would *widen* reach.

**Their union is computed on the harness.** The *What it may reach* table
names, per row, the object that decided it — group, boundary, model provider,
or outside-endpoints grant. That is the one place policy lands, and it is
derived, never authored.

**Three layers, by how hard they hold:**

| | Holds against |
| --- | --- |
| boundaries and the outside-endpoints grant — no route exists | the agent, absolutely |
| credentials — nothing reachable is useful without one, minted per session | the agent and the person |
| memories and prompts — standing instructions | nothing; guidance, worth having anyway |

**The deny list must be well made**, which is why boundaries are a screen with
reasons attached rather than a config file, and why the *Endpoints reached*
log exists (§19): an unaccounted-for endpoint is how the next boundary is
found.

---

## 8. Outside endpoints

What a harness may reach has two ends that need no decision and one that does:

| | Reachable? | Authored? |
| --- | --- | --- |
| **Credentialed endpoints** — behind the groups it holds | always | no — derived from grants |
| **Its model provider** | always | no — derived from routing |
| **Boundaries** | never | yes, deliberately |
| **Everything else** | only under an **outside endpoints** grant | one grant, scoped |

**Outside endpoints is a grant whose payload is reach rather than a secret.**
It has no entries. It uses the same scoping as every grant — teams, optionally
narrowed to named harnesses (§13) — because it must be able to *widen*
downward (the org gives it to Marketing throughout, and to Engineering for
*Code review* but not *Schema migrations*), and a boundary, being tighten-only,
cannot express that. It is the one grant the egress fence reads.

Whether a harness has it is **derived** from the grants covering it, never
stored on the harness. A differently-scoped grant is a different grant.
Boundaries override it.

**The claim the product may make depends on it, and the harness shows which:**

| | Claim |
| --- | --- |
| **Outside endpoints prohibited** | *the agent reaches only what it was granted* — the strong claim, intact |
| **Outside endpoints allowed** | *the agent cannot cross a boundary* — weaker, and honest |

Both are enforced the same way: a packet with nowhere to go. The permission
and its record share a word — *outside endpoints* allowed, *endpoints reached*
logged.

---

## 9. Harness providers, approval, routing

A **harness provider** is the runtime — Claude Code, Cursor, Pi. A **fork** is
a provider too: a repository plus a pinned commit plus a name, admitted with
provenance. Pinning is to a commit, never a branch, so what is reviewed is
what runs. Nobody clones anything; everyone scoped to it runs
`harness provider add <name>`.

### 9.1 Approval

Three states, no separate policy object. An org arrives with every provider in
the last of them.

| | Who may run it | Who may be handed credentials with it |
| --- | --- | --- |
| **Approved** | anyone it is scoped to | anyone |
| **Beta** | anyone it is scoped to | **org admins and team admins only** |
| **Not approved** | nobody | nobody |

**Approval status** and **approval scope** (org-wide, or named teams) are one
decision with two halves. *Not approved* is a state, not an absence: a
deliberate no is recorded with its reason so the next person sees it was
decided.

**Approval is about the runtime, never about what a team writes.** A team's
tool, skill or prompt is never gated by it; those run inside a build that
already passed. Approval binds when someone forks the runtime, which is rare.
A careless tool on a team branch is the fence's job (§7) and the team branch
is reviewable because it is git.

### 9.2 Model routing

Two relations across three dimensions, the same two words on all six columns:

| | teams | harnesses | harness providers |
| --- | --- | --- | --- |
| **Default for** | what this team's harnesses get | what this harness gets | what this runtime gets |
| **Approved for** | what this team may choose | what this harness may choose | which runtimes can speak to it |

*Default* is what you get; *approved* is what you may choose. Most specific
wins: harness, then provider, then team. There is no separate org default —
it is *default for all teams*, the same field with a wider scope. A team admin
choosing their team's default from what is already approved for it is the one
team-admin verb that is not narrowing, and it is safe because approval
happened above them.

### 9.3 Compatibility is derived

A model provider exposes one or more **wire formats** (Anthropic,
OpenAI-compatible) and lists models behind them; a harness provider *speaks*
some set of the same formats. A runtime can reach an endpoint when they share
one. `wire_format` already exists (v3 A6); this names a fact the system has.

Assets may declare a format they need. So a harness can hold two things that
disagree — an Anthropic-only asset routed to an OpenAI-only endpoint — and
preflight **refuses, naming the asset and the remedy**: *Long-context
summariser needs the anthropic format, and OpenRouter exposes openai. Drop it
from this harness, or route through a provider exposing anthropic*, linking
to the asset.

A harness therefore carries one derived **Preflight** state — passing or
failing — never a stored one. **A harness is never tied to a provider**; which
runtime is used is a launch choice. `canRunOn` computes the pairings, and a
harness with none shows *cannot launch* and does not.

---

## 10. Launch

### 10.1 Five layers

| # | Layer | Does | Today |
| --- | --- | --- | --- |
| 1 | **Definition** | the canonical manifest per branch | `assets` tables → git (§3) |
| 2 | **Compiler** | harness-agnostic IR → native config, and back | `adapters/pi.ts`, `adapters/claude.ts`; **rehydrate is new** |
| 3 | **Preflight** | compose the chain, detect drift, probe every need, report per slot | `resolve.py` + `hydrate.ts`; **probing and drift are new** |
| 4 | **Broker** | mint session-scoped credentials; **enforce at mint** | `api_keys.py`, `/v1/api-keys/deliver`; **resolver and enforcement are new** |
| 5 | **Launcher** | bind the environment and files — never a credential — and exec the binary behind the proxy that attaches credentials | `supervise.ts`; deliberately dumb; **the proxy is new** |

Layers 2 and 4 never talk; they meet only through 3. A live value is held
only by the supervisor — the `harness` process outside the jail — and is
attached to outbound requests by its proxy; the launcher binds no credential
and the provider process never holds one. That is what lets the compiler be
open to community adapters while the broker stays closed.

**The compiler is not safe because it is pure.** A permissive render is an
escalation. Preflight rehydrates the rendered config back to IR and refuses to
launch on divergence. This is a control against a *buggy adapter*, not a
hostile user — see §11 for the difference.

### 10.2 Preflight

Resolves the effective harness for this person, provider and ref; composes
the chain; rehydrates the native config to catch drift and hand-edits; walks
every `needs:` — assets and credentials — and probes each; reports
satisfied / unsatisfied / deferred with an evidence level (§6.6) and a
*resolved from* (§6.5) per slot. Only on success does it hand off to the
compiler and launcher.

If the previous session ended without a clean exit, preflight folds in what it
finds — same code as exit reconciliation, called from the other end *(ships
with §10.3, not with the first preflight)*.

### 10.3 Exit

Re-probes every slot, diffs what is present against what the harness
declared, and offers to record newly discovered needs into the definition.
This is how a harness's needs are grown from observed use. Two rules:
sessions do not always exit (hence §10.2's fallback), and **recording a need
does not make it verified** — a `gh` login someone made themselves probes as
harness-reported at best. Exit reconciliation is only as good as the probes.
Build timing: §22.

---

## 11. Where enforcement lives

**The fence is where the credentials and the network are; everything the
client does is UX** (`plan-improvement.md` F1).

| Control | Enforced at | Against |
| --- | --- | --- |
| Which branches you may read | the git server, per ref | everyone |
| Approval state; beta admin-only (§9.1) | **the broker, at mint** | everyone |
| Sources allowed — vault-only never minted from a non-vault source (§6.5) | **the broker, at mint** | everyone |
| Egress, outside endpoints, filesystem scope | the sandbox and the fence | the agent |
| Provider binary pinned to a hash | the launcher | the agent |
| Drift, unsatisfied needs, adapter output validation | preflight | a buggy adapter — it is a check, not a fence |

**Preflight is a detector.** It runs where the person is, and a person with
administrator rights owns that machine, so both mint-time rules are recomputed
server-side; preflight's copy exists to give a good error before launch.

Every claim is worded the `enforcement-philosophy.md` §1 way — *the agent
cannot exceed the boundary*, never *the user cannot*. Per-ref authorisation is
the one control that holds against a user too, because unread bytes have no
route to the machine.

---

## 12. People and roles

**People are a screen, not an implication.** An admin needs somewhere to
invite, see and deactivate.

**There is no per-person permission list.** A person gets what their teams
are granted, so:

- **Adding someone to a team is the grant.** Nothing to forget.
- **Removing them takes it back in one step.** Session credentials die with
  their sessions; the only follow-up is rotating a stored key their teams
  shared, which the offboarding view names.
- **An invitation grants nothing** until accepted.

**Three roles, each defined by what it may not do:**

| | May | May not |
| --- | --- | --- |
| **Member** | use what they are given; create a harness (§17.4); offer changes; read every log about themselves | change anything above their own branch |
| **Team admin** | everything a member may; invite and remove; create a sub-team (§5.4); narrow a group into it (§6.4); add a boundary for their team and below (§7); accept requests (§17.3); read any member's branch (§18); choose the team's model default (§9.2); be handed a beta build (§9.1) | widen anything; create a group; change a group's sources; appoint a team admin; lift a boundary |
| **Org admin** | everything; approve builds; connect vaults; create groups; appoint admins; set the visibility switch (§18) | — |

**A team admin cannot appoint another team admin.** That is granted from
above, like every widening. **Anyone may ask** — a request (§13) that
appears in the team's People screen, marked with the org admin it waits on.

**Who owns what** follows the two planes (§1):

| | Owned by | Plane |
| --- | --- | --- |
| harnesses, skills, tools, memories, prompts | **the team** — its own branch | definition |
| vaults, secrets, groups, providers, models, approval | **the org** | runtime |

### 12.1 Editions: personal and enterprise

**One model, two shapes.** A personal account is an organization with no
teams: the root and the person's own node are the two nodes of the chain,
and the person is the org admin of their own organization. Nothing in Part I
changes — composition, groups, boundaries, the broker, the fence, providers
and preflight run identically — because the enterprise rules were written
for *n* team layers and *n* = 0 is a value, not a special case.

What differs is what has meaning, and the console shows only that:

| | Personal | Enterprise |
| --- | --- | --- |
| Chain | org · me | org · teams… · me |
| Credentials | *my keys*: one group granted to the org, in the bundled vault or the person's own cloud | groups, grants, narrowing |
| Providers | every provider the platform knows is available; the person may still pin a version and choose a model default | approval states and scope |
| Boundaries | a personal deny list | org and team layers, tighten-only |
| Harnesses | cards, repository, files, history; `push` keeps; there is nobody to *offer* to, so no requests | plus requests, accept, decline |
| People | nobody | teams, sub-teams, roles, invitations |
| Logs | the person's own | per category, per team |
| Sign-up | self-serve | by invitation |

**Upgrading is adding a team.** A personal organization becomes an
enterprise one the day its admin creates a team and invites someone; no
migration, no export, no second account. **Importing is the first act**: a
person arrives with a Claude Code or Pi setup and `harness import` makes it
their first harness (engine 07 §4a).

**Two ways to pay for the model.** Most personal users arrive with an
OpenRouter, Anthropic or OpenAI key: it goes in *my keys*, the harness
attaches it on the way out, and one OpenRouter key runs Pi and Claude Code
alike because it speaks both wire formats. The other way is the provider's
own sign-in — a claude.ai subscription, Pi's `/login` — which the harness
seeds into the session and never meters. Both work on macOS and Linux from
the first release that runs sessions (engine 09 M3); neither waits on
anything (engine D11).

### 12.2 The platform, above the organizations

An internal staff surface — every account, its shape, its providers and
usage; and the ability to publish assets *to* organizations — is not built
now, and its surface is reserved so it is not a retrofit:

- **A fourth scope, `platform`**, for a `staff` role that is not an org role.
  Staff read the index across organizations; every staff read of a customer
  organization is an authoritative audit event in *both* trails (§24.3).
- **Publishing is the publisher of §22 Later**: a platform repository that
  holds assets and no policy. Nothing from it composes into any
  organization by itself. Pushing a tool to an organization opens a
  *request* (§13) in that organization with subject `publish`; its admin
  accepts or declines like any other. The platform never writes to a
  customer's branch directly.
- Reserved now: the `platform` scope in the console's route and type
  (console 00 §4.1), `/v1/platform/*` in `api` (engine 00 §4.10), the
  `staff` role, the `publish` request subject, and the platform repository
  in `definitions` (engine 02). Screens: console 08.

---

## 13. Primitives built once

Each row is one implementation. **A second implementation of any row is a
defect**, and the reviewer's question for any new screen or endpoint is *which
row is this*.

| Primitive | Definition | Used by |
| --- | --- | --- |
| **Scoping** | applies org-wide, to named teams, or to named harnesses; a differently-scoped instance is a different instance | security groups (§6.3), boundaries (§7), outside endpoints (§8), approval scope (§9.1), routing defaults and approvals (§9.2) |
| **Composition** | resolve a chain of branches by precedence into one effective set | preflight (§10.2), the console's effective view of any harness (§15), *what it may reach* (§7) |
| **Narrowing** | issue a subset of a scoped thing to a scope inside your own; records who and from what | a security group into a sub-team (§6.4), approval scope (§9.1), *approved for* routing (§9.2) |
| **Request** | ask for something decided above you: subject, reasoning, one decision, recorded with reason; withdrawable by the author; open or closed | promotion of paths (§17.3), team-admin role (§12), a platform publication into an organization (§12.2) |
| **Decision record** | who, when, what, reason — for a yes *and* a no | requests, provider approval and refusal (§9.1), boundaries (§7) |
| **Resolver** | `resolve()` / `probe()` | every vault, the bundled one, the person's machine (§6.1) |
| **Evidence level** | verified / harness-reported / declared, never rounded up | preflight, exit, every *observed* cell in the console (§6.6, §14) |
| **Two-column compare** | left and right text, changed lines coloured, *view as git* on demand | conflicts, differences, a stale request, a file's history (§17.2) |
| **Log = `git log` at a scope** | rows with author, time, team, diff underneath; the org's log filtered to a team or a person | four change logs (§19), the team and member *Changes* screens (§16) |
| **Accept = promote** | move a set of paths to the team branch | accepting a request, accepting from a read branch (§18) |

---

# Part II — The console

Decided, stated once. Prototypes on fixtures: `/org-preview`, `/team-preview`,
`/user-preview` in `web/app/org-preview/`. Not wired to anything.

## 14. Principles

| # | Principle | In practice |
| --- | --- | --- |
| 1 | **Every object is a destination and every relationship walks both ways** | from a vault to its secrets, groups, teams; from a secret back. The second hop is its own section and the walk is directed — *what rests on this* and *what this rests on* are never merged |
| 2 | **Every fact is declared, observed or derived, and never mixed** | *Set by an admin* (a commit) · *Checked just now* (`probe()`, stored nowhere) · *Connected to / What would break* (the graph) |
| 3 | **A scale is a column, not a "status"** | every tag is a value on a named scale — approval, source, certainty, reach, role, state, how a boundary holds. A scale may be relabelled for context (*Reach* on an org asset asks how it loads). Every tag links to the screen defining its scale. A word means one thing: *verified* is certainty, never approval |
| 4 | **Relationships are columns, and every column names its unit** | *Granted to teams*, *Only for harnesses*, *Approved for providers*. Linked values, not tags. *All teams* where the scope is everything. No column without a heading |
| 5 | **A derived fact is not a control** | *cannot launch* is an empty `canRunOn`, not a flag |
| 6 | **Link to what you do not own** | spend caps and data policy → the key manager; scopes → the app's console; spend and quota → the provider. *If changing it here would not change it there, the control does not belong here* |
| 7 | **Adding is part of the screen** | a list without a way to add describes a system nobody can operate |
| 8 | **Explain the vocabulary, not the screen** | what a *skill* is belongs on a hover, once. Pages do not narrate themselves; buttons carry their explanation as a tooltip |
| 9 | **Plain words, git on demand** | *your version*, *the team's*, *offer to the team*; *view as git* on any diff shows the commit, the ref and the hunk. The two views must never disagree |

**Navigation is grouped by what an admin is doing:** Assets · Permissions ·
Logs · People (plus Providers at the org). A harness sits with organization
assets because it is a rolled-up distribution of assets.

## 15. Objects

What an org admin sets up, each a commit on the org branch:

| Object | Establishes | § |
| --- | --- | --- |
| **Key vaults** | which secrets managers exist | 6.2 |
| **Teams and membership** | the structure grants map onto; membership is the grant | 12 |
| **Security groups** | a team's scoped entry into a vault: entries, mint parameters, sources allowed | 6.3 |
| **Outside endpoints** | which teams, and optionally which harnesses, may reach beyond their grants | 8 |
| **Boundaries** | the deny list, each declaring how it holds | 7 |
| **Harness providers** | which runtimes and forks may run, at what approval, for whom | 9.1 |
| **Model providers** | where models come from; default for and approved for across teams, harnesses, runtimes | 9.2 |
| **Organization assets** | skills, tools, prompts, memories for every harness; each *always loaded* or *when chosen* | 5.2 |

**A harness is the unit an audit is about**, so its row carries everything
the other screens decide: assets, security groups, boundaries naming it or
its teams, model provider, `canRunOn`, team, outside endpoints, preflight.
Org-wide boundaries are not repeated per row; the harness's *what it may
reach* table shows the full union with the source of each line.

**Organization assets carry the reverse view** — which harnesses include
them, which teams they reach, which groups they need to work. *Always loaded*
shows *all harnesses* rather than every row.

## 16. Three surfaces, one application

The org console is the superset. The team and member surfaces are the **same
application** at a narrower scope — same chrome, same sidebar groups, same
objects — with different verbs. Three surfaces would be three places for one
idea to drift.

| Sidebar | Org | Team | Member |
| --- | --- | --- | --- |
| Harnesses | all | the team's | those the member runs |
| Security groups — and outside-endpoints grants | create, grant | narrow into a sub-team | read |
| Boundaries | set | add for the team and below | read, in full |
| Changes, Endpoints reached | all | filtered to the team | filtered to you |
| People | invite, roles, deactivate | invite, remove, sub-teams, requests | your account: teams, logins, what you may ask for |

**Transparency is the default.** Everything the org decides about somebody is
visible to them — every boundary, every log of what they did — unless an org
admin turns that view off. When a view is hidden the screen says so, never a
shorter list, never silence. A refusal you cannot look up is indistinguishable
from a bug, which is why boundaries are listed in full, never summarised.

**Viewing is not an administrative power.** A member reads every log about
themselves and edits none of it.

## 17. The harness

### 17.1 A card, then a repository

**Listed as a card:** name, description, the 16×16 drawing `harnesses.md`
already gives it, team, file count. **No tags, no status.** A card is how you
find a harness; what is true of it belongs inside it.

**Inside, a repository.** Header: drawing top left, name and description
beside it, six facts — team, preflight, model provider, security groups,
outside endpoints, file count — in a **two-by-three grid** to the right, all
three blocks one height. Below, a **flat file list**, one row per file:
**type · name · last editor · their note · when**. Type is a column with the
hover explainer; per-file state is not a column. **Every file has an owner —
organization, team, or you — which is the branch it comes from, and the file's
page states it with what it permits**: an organization file cannot be changed
below the organization, a team file can be offered changes, a file of yours is
on your branch only. That label is the inheritance model made visible at the
one place it matters, the file someone is about to edit. Security groups and
boundaries are not repository content — they do not diff — so they sit in the
sidebar as reference.

**One *New harness* button, then a choice inside:** empty, or start from a
copy.

### 17.2 Versions

The control is a **compare control, not a checkout**: it changes which copy
you are reading and, in *Differences*, which two are compared. **Files /
History** sits directly beside it — together they say whose copy and which
view.

| Role | Options |
| --- | --- |
| Member | **Your version · Team version · Differences** |
| Team admin | those, plus **one entry per member of the team** (§18) |

| View | Under the control |
| --- | --- |
| Your version | `harness switch <name>` — run the session on your copy |
| Team version | `harness switch <name> --team` — run the session on the team's copy. **Anything you change during it lands on your own version**, as always: a person only ever commits to their own branch, and the team's copy moves only by promote (§17.3) |
| Differences | *you are working in your copy · 4 of 7 files differ*, and the two bulk verbs — **offer everything**, **take the team's for everything** — which live only here, because offering "everything" from a screen not showing it asks someone to agree to a list they cannot see |

- **A conflict exists only in a comparison.** The badge appears in
  *Differences* and nowhere else.
- **The editor column follows the selected copy.**
- **History exists at both levels**, and the compare control picks whose.
  Each version is a plain sentence with the files it touched underneath and
  its short reference as a chip. A file's own page carries its history from
  both copies, labelled. *Differences* is hidden in History — a difference is
  a state, not an event.
- **For an organization file all three views are the same file**, and the
  control says so.
- **No merge button.** A member offers and an admin accepts.
- **A member sees their copy and the team's, and no other member's.** A
  personal branch people know is readable is one they stop experimenting on.
  The team admin's sight is the exception, and the member is told (§18).

**The conflict screen** is the two-column compare (§13) with exactly three
outs — keep mine, take theirs, edit by hand — and no automatic merge, because
a merge the platform got wrong is indistinguishable from one the person meant.

**A Commands sheet** opens every command behind the page — switch, start,
status, diff, log, push, offer, reset, adopt, create — each with a plain
description and a copy button. It is also where a member who prefers the
terminal stops needing this interface, which is the correct outcome.

### 17.3 Requests

A promotion request is a **pull request over a set of paths**, and it lives
**inside the harness** as a third panel beside Files and History. There is no
sidebar inbox: a queue across harnesses detaches a request from the files it
is about.

| | |
| --- | --- |
| **Shape** | title, author, file count, the author's reasoning; a card per file with path, **+added −removed**, and the diff, added lines green and removed red |
| **Layout** | the change on the left; on the right the discussion, the decision, and the buttons — one place for *what do I do about this*, staying put while the diffs scroll |
| **Discussion** | hangs off the request, not off a file |
| **Filters** | **Open · Closed.** No state badge on a row — the filter says it; in Closed the outcome rides in the row's line |
| **Verbs** | team admin: *accept all n* · *decline*; author: *withdraw* |
| **Refusal** | a member reads all of it and, where the decision would be, sees **Permission not cleared** — *accepting publishes to everyone on Marketing, so a team admin decides it.* A sentence naming who decides, not a greyed button |
| **Stale** | if the team's copy moved while it waited, the file shows *proposed* beside *the team's copy has since changed* — the two-column compare, because that is what it has become |
| **Record** | a decision carries its reasoning, including a refusal, because a declined request with a reason is how the next person learns where the thing belongs |

Accepting is **promote** applied to every path — the same verb as accepting
from a read branch (§18).

### 17.4 The member's verbs

| Button | Underneath |
| --- | --- |
| **Offer to the team** | `push`, plus a request |
| **Keep as mine** | `push` to your own branch — no request, nobody reviews it; it follows you between machines |
| **Take the team's** | check out the delivered version over yours; destructive, so it confirms |
| **Keep mine · Take theirs · Edit by hand** | conflict resolution |
| **Withdraw** | close your own request |
| **New harness** → empty or **start from a copy** | create |

**Push and promote are two buttons.** Collapsing them loses the thing members
want most — *keep this as mine, I am not proposing it for everyone*.

**Deliberately not wrapped:** branch, rebase, cherry-pick, stash, tag. Those
are what *clone it, it is real git* is for.

**A member may create a harness, and nobody approves it.** It starts empty
plus whatever is always loaded (§5.2), and inherits exactly what they already
hold — same groups, same boundaries, same model provider — so it cannot grant
access they did not have. A new harness is a new *filter*, never a new
*permission*. The dialog ends with `harness switch <name>`, because the next
thing that happens is in the editor.

## 18. Administration at each scope

**A team admin's verbs are all narrowing** (§12), which is what makes the
surface safe to hand over.

| Verb | Screen |
| --- | --- |
| **Create a sub-team** | name, who is in it (§5.4). The dialog says it starts empty and inherits everything, and that keeping something from it means placing that thing on a different sub-team |
| **Narrow a group** | pick the sub-team, untick entries, read one sentence saying what the result grants — *Marketing interns will be able to resolve crm. They will not get email.* There is nowhere to type an entry the team does not hold |
| **Add a boundary** | for the team and below; the org's are shown and cannot be lifted |
| **Remove a member** | shows what it takes with them before confirming |
| **Read a member's branch** | the compare control gains one entry per member. History follows the selected branch; *Differences* is that branch against the team's. Reading it says so on screen — *they have not offered these; you can take one anyway* — and offers exactly one action, **promote a file**, which is `prd.md` §1.5's turnover story with no second mechanism |

**And the member is told.** Their account screen states that their team admin
can see their versions.

**A member's account screen answers "why can I not reach X":** their teams,
the logins present on their machine and the commands that create the missing
ones, and the one thing they may ask for — to be a team admin — which is a
request (§13) and appears in the team's People screen and the org admin's.

## 19. Logs

One change log per navigation group, because that is how an audit is
requested — *every permission change last quarter* — plus one observed log.

| | Records | Source |
| --- | --- | --- |
| **Harness changes** | pushed, offered, accepted, declined, rolled back | git |
| **Permission changes** | vaults connected, groups created and narrowed, boundaries set, outside endpoints granted | git |
| **Provider changes** | approved, declined, moved to beta; routing changed | git |
| **People changes** | invitations, role changes, deactivations — and therefore who gained and lost access, and when | git |
| **Endpoints reached** | every endpoint a harness dialled | the fence and the broker — never the agent's own report |

Each row is `git log` shown to someone who does not know git: author, time,
team, and the diff underneath. A decision is a row (*Aider declined, 3 March,
no way to pin a build*). The logs join: *refund-lookup promoted to Marketing*
notes it reached `api.stripe.com`, which is why that endpoint is new on the
other screen.

## 20. Surfaces

**Local, general-purpose** — chat, shell, full repo access on the person's
own machine — is the product. The honest claim is entitlement enforced per
session, not that keys never touch the machine.

**Narrow-scope** (TUI, fixed jobs) is architecturally reserved: a menu whose
options come from preflight's satisfied list. All that must be true now is
that the IR carries a per-asset audience flag and the provider registry can
carry a custom render target — free today, expensive to retrofit.

---

# Part III — Delivery

## 21. What this amends

| Document | Amendment |
| --- | --- |
| `prd.md` §1.2 | Nested orgs become one root, n team layers, users (§2). A holding company or MSP tenant is its own org. |
| `prd.md` §1.2 | "A recursive tree" becomes "a chain of branches." The tree survives; its storage is git. |
| `prd.md` §1.3 | The resolved set — own assets plus everything inherited — is **restored** and sharpened: inherited means *present on a branch in your chain* (§5). |
| `prd.md` §1.9 | Secrets are still submitted once and referenced, but the platform holds references and asks a resolver (§6.1). |
| `prd.md` §2.7 | "Users never see branches" is **softened**: abstracted for non-technical users, present for technical ones (§14 principle 9). |
| `scoping.md` §0 | **Reversed.** "Nothing is shared by containment" becomes "presence on a branch in your chain is reach." `asset_scopes` retired (§5.1). |
| `scoping.md` §2 | "A team is like a security group" **retired**: a security group is the credential object (§6.3); a team is a team. |
| `enforcement-philosophy.md` §2 | **Amended.** Reach is derived from grants, plus one outside-endpoints grant, minus a deny list (§8). The no-route claim becomes conditional and the condition is shown. |
| `asset-sync.md` §9 | **Reversed.** Real bare repositories server-side with per-ref authorisation (§3, §11). |
| `asset-sync.md` §1–§8 | Unchanged and load-bearing. |
| `harnesses.md` §0 | A harness is still a filter that only takes away, with one exception: *always loaded* (§5.2). Contents key on asset id (§4.1). |
| `agents.md` | An *agent* is a **harness provider** (§9). |
| `plan-improvement.md` F2-bis | The key registry is re-seated behind the resolver interface, not deleted (§6.2). |
| `plan-improvement.md` F4 | Partially reversed for definitions only; records and the index stay in Postgres (§3). |

## 22. Build inventory

The engine half of this inventory — everything from the person's machine to
the broker — is planned in detail in [`engine/00-overview.md`](engine/00-overview.md)
and the documents beside it; `engine/09-sequencing.md` orders it. The console
(Part II) is planned in [`console/00-overview.md`](console/00-overview.md);
`console/06-sequencing.md` says what can be observed and driven through it at
each engine milestone.

### Keep — built, load-bearing, unchanged

- `asset-sync.md` §3–§8: the local work tree, `refs/harness/remote`, the
  hydration table and its idempotency test, `shadows`, the five commands.
- `resolve.py` resolution semantics — nearest-ancestor-wins becomes branch
  precedence; the rule and its tests survive.
- `harness push` → `push_review` → `/approve`; `promote` / `rollback`.
- `org_unit_boundaries` + `merge_boundaries`: top-down, tighten-only.
- `harnesses.md` in full; adapters and the registry; the filesystem enforcer;
  the egress fence; capability vocabulary and tool gating (v3 A1); model
  policy and `wire_format` (v3 A6); `enforcement-philosophy.md`; the
  authoritative/attested audit split (F9).

### Drop

- `asset_scopes`: table, endpoints, backfill, owned/available (§5.1).
- Nested orgs (§2). Definitions as the primary copy in Postgres (§3).
- Harness contents keyed by `(kind, name)` (§4.1).
- Postgres via pgsodium as the permanent home for secret values (§6.2).
- `asset-sync.md` §9's "no server-side git."
- The word *agent* for a runtime (§9).
- Sensitivity classes, the Launch rules screen, `must expire`, agent
  self-reporting, any harness→provider binding, a hygiene or disuse column
  (§25).

### Add — in dependency order

| # | Build | Rule it serves |
| --- | --- | --- |
| 1 | **Durable asset id** in a sidecar, validated at push and preflight (§4.1) | 3 |
| 2 | **Git server with per-ref authorisation** (§11) — what makes §5.3 hold | 4 |
| 3 | **Definition migration**: repos as source of truth; Postgres index derived, rebuildable, storing edges (§3) | 1 |
| 4 | **Sparse-checkout materialisation** from the subscription list (§4.2) | 3 |
| 5 | **Resolver interface** and `probe()` per resource kind; three evidence levels through the whole status path (§6.1, §6.6) | 7 |
| 6 | **Security groups**: entries, mint parameters, sources allowed, narrowing (§6.3–6.5) | 5 |
| 7 | **Broker**: session-scoped mints; approval state and sources allowed recomputed at mint (§11) | 6 |
| 8 | **Credential chain**: fixed order, fail closed, `resolved from` per slot retained with the session (§6.5) | 6 |
| 9 | **Rehydrate** in the compiler (§10.1) | 6 |
| 10 | **Preflight**: composition, dependency walk, drift by rehydrate, adapter output validation (§10.2) | 6 |
| 11 | **Boundaries — enforced layer**: endpoint, filesystem and capability denials on the org branch, union computed on the harness, team may add and never lift (§7) | 5 |
| 12 | **Outside endpoints** as a scoped grant read by the fence (§8) | 5 |
| 13 | **Provider registry**: three states, scope, pinned forks with provenance; **model routing**; **`canRunOn`** (§9) | 5 |
| 14 | **Organization assets**: always loaded / when chosen (§5.2) | 3 |
| 15 | **People**: invitations, three roles, deactivation, offboarding view; **the request primitive** for promotion and roles (§12, §13) | 5 |
| 16 | **Logs**: four change logs from git; endpoints reached from the fence (§19) | 7 |
| 17 | **Console** as in Part II, on the primitives of §13 | — |
| 18 | **Terminology** through `agents.md`, the CLI and the homepage (§9) | — |

### Later — decided, not needed for the seven rules

- **Exit reconciliation** (§10.3). Preflight's unclean-exit fallback ships
  with it.
- **Secrets inventory** (§6.7): list-permission reads, provider → group →
  secret, orphan and broken-pointer detection.
- **Command interception** (§7): provider hook plus sandbox shim, resolved
  command matching, curated list. The enforced layer ships in #11.
- **OpenBao** as the bundled vault behind the same interface; verify
  licensing and fork status first, and bundling means owning seal/unseal,
  backup and DR.
- **Brokered OAuth** — platform-run consent and refresh, tokens in the org's
  vault under per-person paths (§6.7).
- **A publisher above the orgs** — a repository a company's root may pull
  from, holding no policy and granting nothing. The durable id lets hand-made
  copies be recognised as the same asset later.
- **Narrow-scope TUI** as a third render target (§20).
- **Automations and the customer-owned runner** (F3), SCIM/SAML offboarding
  (F8) — unchanged, still required for GA.

## 23. Decisions taken in this restructure

Calls made while consolidating, each reversible in one line unless marked
decided. Confirm or reverse.

| # | Decision | Where | Reverse by |
| --- | --- | --- | --- |
| 1 | **Outside endpoints is a grant whose payload is reach, with no entries** — not a security group with a search key, not a per-harness switch. Same scoping as every grant. | §8 | making it a security group whose sole entry is a search provider's key; the fence then opens for that endpoint only, and "everything else" needs another mechanism |
| 2 | **Beta builds may be handed credentials to org admins *and* team admins.** | §9.1, §11 | org admins only — one word in the broker rule |
| 3 | **Requests, narrowing, decision records are each one primitive** with two or three subjects, not separate builds. | §13 | building them per screen — and accepting the drift §16 warns against |
| 4 | **Custom distributions are harness providers** — a fork pinned to a commit with provenance. The separate row is gone. | §9, §15 | restoring a *Custom distributions* object if a fork turns out to need fields a provider does not have |
| 5 | **Exit reconciliation, the secrets inventory, and command interception move to Later.** None of the seven rules depends on them. | §22 | moving any back to Add; the designs are unchanged and stated in §10.3, §6.7, §7 |
| 6 | **A file's owner is stated on the file's page, not as a list column.** | §17.1 | adding an *Owner* column to the list — one column, the data already carries it |
| 7 | **Edits during a `--team` session land on your own version.** A person only ever commits to their own branch; the team branch moves only by promote. | §17.2 | decided by the owner |

## 24. Open questions

Settled and recorded above: grant versus self-subscribe (§5.1), the first three
vaults (§6.2), delegation of sub-grants (§6.4), egress posture (§8), where the
credential rule lives — *sources allowed*, on the group (§6.5), the console's
presentation and the accept/promote/decline screens (§17). `rerere` is void:
the platform composes rather than merges.

1. **Rollback, as a screen.** Accept and decline are drawn (§17.3). How an
   admin who does not know git rolls a promotion back — and what the log row
   reads — is not.
2. **OpenBao licensing and fork status.** A lookup.
3. **Cross-company administration.** An agency admin holding admin in several
   sealed companies must appear in both audit trails; whether notice, consent
   or a distinct role is also required is undecided.

## 25. Decisions reversed

Recorded so they are not re-proposed, and so Parts I and II read as rules
rather than history.

### Model

| What we had | Replaced by | Why |
| --- | --- | --- |
| Three sensitivity classes and a Launch rules screen | three **approval states** on the provider (§9.1) plus **sources allowed** on the group (§6.5) | the middle class equalled the loosest in practice; the rest restated approval. Two booleans dressed as three presets |
| `must expire` on a security group | **sources allowed** — vault only, or vault or local | the conventional control is which entries are in the chain, not how long a credential lives; and a group's entries can span vaults |
| *Credential strength*, then *lifetime* | **where it comes from** — vault-supplied or locally-owned | "strength" read as a grade; "lifetime" still had us judging how a customer manages keys |
| A hygiene column; a disuse signal on grants | **nothing** — record what a provider reports, never grade it | rotation cadence is the vault's business, unused-grant policy the customer's; a heuristic we invent grades their team structure |
| Agents self-report what they connected to | **the fence and the broker** (§19) | the model describing its own behaviour is what an injection would falsify |
| A resource catalogue an admin maintains | **endpoints reached**, an observed past-tense log | nothing can enumerate a company's databases; only a grant can be refused |
| A harness bound to a provider; a per-harness list of compatible runtimes | **`canRunOn`**, computed; only the failure case shown | the runtime as an attribute asserts the opposite of portability |
| An admin-maintained *approved for providers* list | **wire format**, derived (§9.3) | went stale the first time a provider added a format |
| A grant as one alias → one secret | a **security group** of entries | a team with three secrets needed three objects; matches what vaults call a role |
| One object carrying grants and denials | **two objects, one scoping model, union computed on the harness** (§7) | narrowing is delegated, so a merged object makes narrowing an escalation; and grants and denials compose in opposite directions |
| `required` / `optional` on org assets | **always loaded / when chosen** | the question is what the org is doing with the asset |
| Deny-by-default egress with an authored allowlist | **derived reach + one outside-endpoints grant + a deny list** (§8) | the objection was never the list, it was authoring it |
| A restructure or move-asset flow for sub-teams | **nothing** — withholding is placement of new work one level down (§5.3) | the problem it solved does not exist in a composition model |
| "Assets are curated, credentials and boundaries enforced" | **all three instruments hold; the harness filter is context only** (§5.3) | placement is backed by per-ref authorisation; the earlier line confused it with the filter |
| Vault *tiers* — deep / shallow | **none.** One interface; per-slot evidence; `minted` or `stored` as an engine fact | a grade on a customer's vault is the hygiene column again; what the person needs to know is that the key exists and is secured |
| *Access points* | **security groups** | two things cannot share a name with *team* for the admins most likely to know it |

### Console

| What we had | Replaced by | Why |
| --- | --- | --- |
| A `Status` column | **a named scale per column** (§14) | a single status hides which question is being answered |
| Tags on harness cards — conflicts, readiness | **none** (§17.1) | a grid of badges turns choosing into reading a report |
| Files grouped by kind, with a per-file state label | **a flat list**, type as a column, editor and note instead of state | a repository listing; two memories are two rows |
| Sidebar inboxes *Changes* and *Conflicts* | **requests inside the harness**; conflicts reached from their harness (§17.3) | both were filters over things already visible; *Changes* was two jobs under one name |
| A branch dropdown for members | **a compare control** — your version, team version, differences (§17.2) | a member cannot check out the team's branch to edit; the control shows views, not checkouts |
| *Yours / the team's / what differs* | **Your version / Team version / Differences** | plainer |
| Requests filtered *open / settled*, with state badges | **open / closed**, no badges | accepted work is in the team version by definition; a row repeating its filter is noise |
| One column with diff and discussion | **split: change left, discussion and decision right** | a reviewer scrolls between the thing and their opinion of it |
| A thread per file | **one discussion per request** | disagreement is usually about the change, not a file |
| Two *New* buttons — empty, from a copy | **one button, a dropdown inside** | the reader decides before they have the information |
| A greyed-out Accept for members | **Permission not cleared**, naming who decides | a disabled button teaches nothing |
| Admin sight as a permission | **a branch picker** sized to what you may see (§18) | every person is on a branch already; nothing new to grant |
| Narrowing and sub-team creation as one dialog | **two verbs** (§5.4) | a sub-team is not defined by its credentials |
| Type as a prefix in the name column | **a column** | scanning by it |
| A no-admin state and a disuse warning on People | **nothing** | the same overreach as the hygiene column |
