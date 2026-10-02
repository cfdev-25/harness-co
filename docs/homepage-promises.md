# What the homepage promises

The public site at [theharnessmanager.com](https://theharnessmanager.com) makes
claims about a product that is partly built. This document is the inventory of
those claims: what a visitor is told, where the copy lives, and whether the
code behind it exists today.

It is not normative. `prd.md`, `agents.md`, `harnesses.md`, `asset-sync.md`,
and `enforcement-architecture.md` say what the system *should* do; this says
what we have told strangers it *does*. When the two disagree, one of them has
to change — and which one is a judgement call each time.

Status is one of:

| | |
| --- | --- |
| **shipped** | Code exists and runs. Someone could see this today. |
| **partial** | The mechanism exists; the claim is broader than the mechanism. |
| **planned** | Designed in `docs/`, not built. The copy is ahead of the code. |
| **staged** | True of the demo, which is a scripted animation, not a recording. |

Source files: `web/app/hero-lead.tsx`, `hero-terminal.tsx`, `pillars.tsx`,
`approval-scroll.tsx`, `home.tsx`, `site-chrome.tsx`, `terms/page.tsx`,
`privacy/page.tsx`, `request/`.

## 1. The hero

> **Secure, manage, and scale harnesses across *\<rotating\>*.**
> Every agent in harness. Your people at the reins.
> A harness-agnostic management and collaboration solution for preserving,
> iterating, and proliferating agentic work across your organization.

The rotating word cycles: your side projects, engineering, marketing, sales,
support, finance, research, ops. **This is the broadest claim on the site** —
that the product suits any department, not only engineering. Nothing in the
code is engineering-specific, so it holds in principle; no non-engineering
team has used it.

`harness-agnostic` is the load-bearing word. It is backed by the adapter
design in `agents.md` §0: one manifest, many renderers. See §3.1.

## 2. The hero terminal

`web/app/hero-terminal.tsx`. A scripted animation, **not** a recording of a
real session. Every line is a promise about what the CLI will feel like. The
CLI package is `pi/packages/harness-cli`.

### Phase 1 — startup

| Line shown | Status | Where it lives |
| --- | --- | --- |
| `% harness run pi --marketing` | **shipped** | `harness-cli/src/index.ts`; the agent-positional, harness-flag shape is `agents.md` §2 |
| `Securing environment ✓` | **partial** | The filesystem enforcer (`enforcers/filesystem.ts`) removes excluded tools at spawn; the full jail is `enforcement-architecture.md` |
| `Loading skills ✓ 3` | **shipped** | Resolve + hydrate: `backend/app/domain/resolve.py`, `harness-cli/src/hydrate.ts` |
| `Loading tools ✓ 2` | **shipped** | Same path; tool gating per `agents.md` §7.1.1 |
| `Loading memories ✓ 1` | **shipped** | Same path |
| `Issuing session key ✓` | **partial** | `/v1/api-keys/deliver` issues a scoped credential. "Expires on exit" is the intent; revocation on exit is not yet enforced end to end |
| `Pi marketing started` | **shipped** | Pi adapter: `harness-cli/src/adapters/pi.ts` |

The counts (3 skills, 2 tools, 1 memory) are **staged** — invented for the
demo, not read from a real harness.

### Phase 2 — work

| Line shown | Status | Note |
| --- | --- | --- |
| `% Rebuild the Q2 launch deck in dark mode` | **staged** | The prompt implies the agent *edits its own tool* to satisfy a new requirement |
| `▖ Editing tool · marketing-deck` | **planned** | An agent modifying a team tool mid-session, and that edit surviving as an asset, is the story `asset-sync.md` supports but no code demonstrates |
| `✓ Creating deliverable` | **staged** | Generic agent work |
| `Wrote ~/marketing/q2-launch-deck.pdf ✓` | **staged** | A path, not a real artifact |

**This is the weakest phase.** It shows an agent improving its own tooling,
which is the emotional centre of the pitch, and it is the part with the least
code behind it.

### Phase 3 — exit

| Line shown | Status | Where |
| --- | --- | --- |
| `Closing session ✓` | **shipped** | `harness_sessions` close path |
| `Revoking session key ✓` | **planned** | The key is scoped and versioned; automatic revocation at session end is not implemented |
| `Checking changes ✓ 1` | **shipped** | Dirty detection against `refs/harness/remote`, `asset-sync.md` §1 |
| `Keep the change to marketing-deck?` → Yes/No | **partial** | `harness push` exists and is interactive; this exact prompt at exit does not |
| `Progress saved ✓` | **shipped** | Push publishes to the user's own unit; an admin promotes. `asset-sync.md` §1 |

The demo implies push happens **at exit, by prompt**. Today it is a separate
command the person runs. Either build the exit hook or soften the demo.

## 3. The three promises

`web/app/pillars.tsx`. Section heading: *Built on trusted technology, for
portability, scalability, and security.*

### 3.1 Portable — "Write it once. Use it everywhere."

> One harness definition renders into Claude Code, Cursor, Pi — whatever comes
> next. No team is tied to one vendor, and trying a new tool never means
> building it all again.

The card shows four logos: **Claude Code, Cursor, Pi, and a dashed
"What's next" slot.**

| Agent | Status |
| --- | --- |
| Pi | **shipped** — `adapters/pi.ts` |
| Claude Code | **partial** — `adapters/claude.ts` exists; `agents.md` §3 defines what it can and cannot honour |
| Cursor | **planned** — no adapter. The logo is on the homepage anyway |
| "What's next" | the dashed slot is honest about being aspirational |

**Cursor is the exposure here.** We display a third party's mark to imply
compatibility we have not built.

### 3.2 Scalable — "Capability at the speed of git."

> New capability isn't a purchase order, it's a commit… every team beneath
> inherits it. The organization sees what changed, and who approved it.

The diagram animates **org → team → you** lanes, a commit travelling up and
being inherited back down, labelled improve → team → company → everyone has it.

| Claim | Status |
| --- | --- |
| Git is the engine | **shipped** — `asset-sync.md`; the work tree is a real git repo |
| Push to your own profile, shadowing the team | **shipped** |
| Admin promotes to the team | **shipped** — `/v1/assets/{id}/promote` |
| Review gate before publishing | **shipped** — `boundary.build_policy.push_review` |
| Inheritance down the tree | **shipped** — nearest-ancestor-wins, `resolve.py` |
| "The organization sees what changed, and who approved it" | **shipped** — hash-chained audit log, `0006_audit_log.sql` |

**This card is the best supported on the page.** Nothing here is ahead of the
code.

### 3.3 Secure — "Security you can trust."

> Keys and passwords are never handed out for keeps. People — and the agents
> working for them — reach sensitive systems for exactly as long as the job
> takes, then that access is taken back. **Keep the key manager you already
> trust, or use ours.** Nothing is left lying around.

The card shows three logos: **OpenBao, AWS KMS, HashiCorp Vault.**

| Claim | Status |
| --- | --- |
| Credentials scoped to a session | **partial** — `/v1/api-keys/deliver` issues per-session; lifetime enforcement is incomplete |
| Encrypted at rest | **shipped** — libsodium secret box over a master key, `backend/app/crypto.py`, `api_key_versions.ciphertext` |
| Nothing at rest on the machine | **partial** — `enforcement-architecture.md` is the design; the sandbox is not fully landed |
| **OpenBao** | **planned** — named once in `plan-improvement.md` §116 as an adapter that "must be a real option." No code |
| **AWS KMS** | **planned** — appears nowhere in the codebase |
| **HashiCorp Vault** | **planned** — appears nowhere. `plan-improvement.md` §42 mentions Supabase Vault / pgsodium, which is a different product |

**This is the largest gap on the site.** Three vendor marks imply three
integrations, and there are none: secrets today live in Postgres under our own
master key. If a customer asks "can we bring our own KMS?", the answer is not
yet.

Also note HashiCorp's trademark policy is stricter than most about implying
endorsement. The footer carries a general trademark line; it does not name
these products.

## 4. In practice — four stories

`web/app/approval-scroll.tsx`. Heading: *How managed harnesses reshape work.*
Each story runs in a dark macOS window over a Company → Sales/Engineering →
people tree. **Every name, date, and system in them is invented.**

### 4.1 Instant propagation
Ana in Sales finds a faster pricing quote → her lead approves → the team has
it → promoted company-wide → Engineering studies it → **Ben adds the SAP data
structures so prices come from the system of record** → the upgrade flows back
to Sales.

Mechanism (promote, share, inherit) is **shipped**. The **SAP** reference is
**planned** in the strongest sense: there is no SAP connector, and a named
enterprise system reads as an integration claim.

### 4.2 Membership-based access
Priya joins Engineering Monday; by 9am she has the team's code, test servers
and error logs, and nothing more; when she leaves, access leaves with her.

**shipped** — membership is the grant (`org_unit_members`), resolution is by
tree position. The named resources are illustrative.

### 4.3 Policy inheritance
Legal says customer records must never leave the company's own systems →
Security sets it once at the top → every team inherits → Cal's agent tries to
upload a customer list to an outside service and is **blocked**.

Inheritance and tightening-only boundaries are **shipped** (`merge_boundaries`,
`org_unit_boundaries`). **Egress enforcement is partial**: outbound network
control is designed in `enforcement-architecture.md` and listed among the open
items in `enforcement-gaps.md`. The blocked arrow is the strongest enforcement
claim on the site.

### 4.4 Single source of truth
An auditor asks who can see payment data → one lookup finds Ben → through
Engineering → **approved by Maya, Head of Security, on March 14**.

**shipped** — the audit log is hash-chained and attributable, and
`/v1/org-units/{id}/audit/verify` checks the chain. Maya and the date are
invented.

## 5. Compounding innovation

> Approve a resource once, and every team authorized to use it inherits that
> decision automatically… capability scales with the number of decisions an
> organization is willing to make.

Paired with a chart contrasting "one relationship at a time" against "approve
once, inherit below". The chart is **illustrative, not measured** — no axis
carries units, deliberately. The underlying inheritance claim is **shipped**.

## 6. Access, sign-in, and the request form

| Promise | Status |
| --- | --- |
| "Invite only. Ask an admin on your team to invite this address." | **retired** (W7-D1) — `/signup` is self-serve behind one access code, `NEXT_PUBLIC_ALLOW_SIGNUP` is gone, and the header and hero now say *Create an account*. `/login` is sign-in only; the invite path itself is unchanged |
| The request form at `/request` | **shipped** — writes via the `request_access` definer function, migration `0029` |
| "We'll email you an invitation from this address" | **manual** — no automation reads `access_requests`; someone must query the table and invite |
| Sign in works | **partial in production** — Supabase auth works, but the console's `/v1/*` calls need a deployed backend, and there is none yet |

**Supabase sign-ups must be disabled in the dashboard.** Until they are, the
anon key can call `signUp` directly and the invite-only claim is only true of
the UI.

## 7. Legal claims

`web/app/terms/page.tsx`, `privacy/page.tsx`. Party:
**New Pacific Technologies LLC**, California law. These are commitments, not
descriptions, and they are the claims most likely to matter later.

| Promise | Status |
| --- | --- |
| "We do not use your content to train machine-learning models" | **true today** — no training pipeline exists |
| "We do not receive or store the prompts you type or the responses the model returns" | **true today**, and **conditional**: it breaks the moment a proxied model mode routes inference through us. `agents.md` §5 describes exactly that mode |
| "We encrypt credentials at rest" | **shipped** — `crypto.py` |
| "Audit records are tamper-evident" | **shipped** — hash chain |
| "Export your content for 30 days after closure, then we delete it" | **planned** — no export endpoint, no deletion job |
| "Deleted data may remain in encrypted backups for up to 30 more days" | depends on the Supabase plan's backup retention |
| "We do not use advertising or third-party analytics trackers" | **true today** — no analytics in `web/` |
| Liability capped at fees paid in 12 months, or US$100 | a commitment, unreviewed by a lawyer |
| Registered address and contact email | **unfilled** — `web/app/legal.ts` still has bracketed placeholders that render on the live pages |

## 8. The short list

If the site had to become fully honest tomorrow, in order of exposure:

1. **Three key-manager logos with no integrations** (§3.3). Either build one —
   OpenBao is the designed choice — or relabel the row as roadmap.
2. **Cursor's logo with no adapter** (§3.1).
3. **SAP named in a story** (§4.1) — easily reworded to something generic.
4. **Egress blocking shown as enforced** (§4.3) while `enforcement-gaps.md`
   still lists it open.
5. **Session keys revoked on exit** (§2, §3.3) — shown twice in the demo.
6. **An agent editing its own tool mid-session** (§2) — the demo's centrepiece.
7. **Legal placeholders** (§7) — visible on the live site right now.
8. **Data export and deletion** promised in the Privacy Policy (§7).
