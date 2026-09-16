# The Harness Company — Product Requirements

> **Governing principle.** Every capability removes stress from the foreground by doing more in the background. We ship explainability, not features. If a capability adds a concept the user must learn, it does not ship. The product is the translation layer between the system's power and the human's stress level — everything below serves usability, ease of experience, and enterprise deployability.

---

## Section 1 — The Platform

### 1.1 The Harness

The unit of work. Everything a person or automation needs to do a job, in one runtime.

- **Context** — the information the harness puts in front of the model: what it sees, from where, and how much.
- **Connections** — the configured links to systems of record and external services the harness can reach.
- **Tools** — the actions the harness can take (local and server-side; see §1.8).
- **Skills** — a procedure written down once, so the model follows it instead of reinventing it.
- **Automations** — a skill promoted to run on a schedule or trigger, unattended. This is the "cron job": the maturity endpoint of a skill, and the platform's north-star KPI (§1.10).

### 1.2 The Asset Tree

The core architecture. Capabilities live on a recursive tree, and every node holds the same four asset types — **connections, tools, skills, and memories**. This uniformity is what makes the platform extensible: sharing anything is just moving an asset through the tree, so a new connector, skill, or memory never needs a new sharing mechanism.

```
Node (recursive) — every node has:
  • role:      Org | Team | User        (constrains nesting; see below)
  • assets:    Connections · Tools · Skills · Memories
  • boundary:  permissions · egress · approvals · load policy
  • records:   audit · cost · sessions · run-state   (see §1.10)
  • children:  [ Node, ... ]

Org: HoldCo
├── Org: Subsidiary A
│   ├── Team: Finance
│   │   ├── User: Ana
│   │   └── User: Ben
│   └── Team: Engineering
│       └── User: Cass
└── Org: Subsidiary B
    └── Team: Support
        └── User: Dev
```

- **Recursive, with role-constrained nesting.** Every node is the same shape, so the tree nests to any depth — an org can contain orgs (subsidiaries, divisions, an MSP's client tenants) before reaching teams and users. Nesting follows a fixed role order — **Org › Org › Team › User** — so structure stays legible and the permission model stays predictable. Depth is free: a single startup, a holding company, and a multi-tenant deployment all use the identical model.
- **Every node has connections, tools, skills, and memories.** Same four types at every level.
- **A user operates with a resolved set** — their own assets combined with everything inherited from their ancestors up the tree.
- **Governance is movement through the tree.** *Promote* lifts a user's asset to their team; *share* lifts it toward the org; *port* moves it sideways to another node. All admin-scoped and recorded.

### 1.3 Resolution — Two Directions

The single rule that governs the whole tree.

- **Capabilities resolve bottom-up, most-specific-wins.** Connections, tools, skills, memories, and behavior preferences: a user's own asset overrides the team's, which overrides the org's. Individuals freely adapt *how* work gets done.
- **Boundaries inherit top-down and tighten only.** Permissions, egress rules, approved connectors, approval requirements, and load policy: the org sets the outer fence; a team may narrow it; a user may narrow it further — but no level can widen what a level above it set.

The result, in one sentence: **a user can change how a task is done, but can never grant themselves access, egress, or an action a level above them has fenced off.** Security is a floor you can raise, never lower.

### 1.4 Connections

Connections are first-class because they sit exactly where capability, cost, and security meet — and they carry both halves of the two-direction model at once.

- **Capability half** — a connector exists and exposes tools; this is shareable and inherits bottom-up like any capability.
- **Boundary half** — which instance, which credentials, scoped to what; this is a boundary, inherits top-down, and its secret is handled by key management (§1.9).
- **Connect once, inherit safely** — an admin configures a connection at the org or team level; members inherit the ability to *use* it without ever seeing the credential.
- **Load policy (context-cost control)** — every connection and tool loaded into a session consumes context before the first prompt. Load behavior is governed like any boundary: a **user sets their own default onload behavior** (load-on-demand vs. always-load), an **org or team can prescribe it** top-down, and a user can always revert to their default teamspace configuration if a prescribed setting gets in their way. Dynamic, task-aware loading is the default, so sessions stay cheap and reasoning stays sharp.

### 1.5 Teams & Users

The people layer mapped onto the tree.

- **Roles** — Org, Team, and User nodes carry platform / admin / member permissions respectively, mapped to enterprise identity (SSO / RBAC).
- **Teamspace** — a team node's shared capability surface, curated by a team admin who decides which connections, tools, skills, and automations members inherit.
- **Per-user scoping** — each user is a leaf with its own assets and its own permission scope, always inside its ancestors' boundaries.
- **Admin visibility, promotion, portability** — an admin can see each user's skills and memories, promote them into the team, or port them to another node in the org. Institutional knowledge is a governed asset that follows need and survives turnover — never a private silo lost when someone leaves.

### 1.6 Collaboration

Where enterprise safety meets real-time collaboration — what makes the harness more than a better chat window.

- **Session sharing** — one live session, shared. A teammate joins another's session and both work in the same prompt window: no branches, pure synchronous presence. It scales by depth — from "here's my context, take a look" to "come drive," where the teammate types alongside you to demonstrate a prompt, correct a task, or show how it's done. SSH for a harness.

### 1.7 Deliverable-in-View & The Previewer

The harness always renders a deliverable, not a transcript. Whatever is in view is the thing that matters — a plan or an output — while the code being written and the data being pulled stay in the background as necessary plumbing. Because the interface is TUI-based, the previewer is how that deliverable becomes real and, critically, editable.

- **Native handoff** — file-based deliverables open in their native viewer or true location, not a lossy in-terminal approximation, so the user picks up editing exactly where the harness left off.
- **Live application integration (the powerful case)** — for applications with an automation surface — Excel foremost, then Word and PowerPoint — the harness connects to the *running* application through its native API (the Office object model / COM, or an Office Add-in via Office.js), reads the user's live in-memory state without a save, layers its changes on top, and writes back into the open document. The user's in-progress work is preserved; the harness edits the file you're working in rather than regenerating it.
- **Capture-then-apply (fallback)** — where no live API exists, the harness triggers a save of the user's current state, treats that as the base, applies its changes on top, and the app reloads. Same guarantee — the user's edits come first — achieved through disk.
- **Write-and-reopen** — formats without a live-editable host application (e.g. PDF) get a fresh version the viewer reopens.
- **In-terminal preview** — lightweight formats (markdown, data tables, code, charts) render inline so the user never leaves the harness.

### 1.8 Tool Surface — Local vs. Server-Side

The split that makes enterprise connectivity safe: sensitive actions run where the data and credentials live; shared, stateless actions run centrally.

- **Server-side** (our infrastructure; shared, stateless) — web search / fetch, model inference endpoint, shared connectors, scheduled automation runners.
- **Local** (the customer's machine, inside their fence, with their access) — file system, local shell, on-prem systems of record, local credential use.

### 1.9 Security Boundaries

The harness is powerful because it can act. That power is safe only if the boundaries of action are explicit and enforced in software, not left to the model's discretion. Boundaries inherit top-down through the tree (§1.3) and can only tighten.

- **Key management (enterprise "env file" model)** — secrets are submitted once, obfuscated to an internal reference, and injected as environment variables into the target machine at runtime. Raw keys are never exposed to the user, the model, or the session; only the reference is.
- **Deny-by-default network egress** — the harness cannot reach the open internet. Outbound connections are blocked except to an explicit allowlist. It cannot post, exfiltrate, or call arbitrary endpoints, even if instructed to. Web access happens only through the sanctioned server-side search/fetch tool, which is logged.
- **Filesystem scoping** — local tools operate only within an explicitly granted working directory and the systems that node is already permissioned for. The harness inherits the user's access, never more.
- **Credentials never enter the context** — keys are injected at the machine level and never surfaced to the model or session, so they cannot leak into a prompt, a log, or a shared session.
- **Human-in-the-loop for consequential actions** — actions that write to a system of record, send externally, or spend money require explicit approval. The default posture is propose-then-confirm, not act-then-report. (Sending is the corporate deploy; see §2.1.)
- **Sandboxed execution** — code and tool execution run in an isolated environment that cannot escalate privileges or reach the host beyond its granted scope, so a bad instruction or output can't break out of the runtime.

### 1.10 Observability & Records

What the runtime records. These are not shared assets — they are generated by the system, attributed to the node that produced them, and roll up the tree for governance and reporting.

- **Audit trail** — every tool call, connection access, automation run, and shared session is logged and attributable to a user within a node. Nothing the harness does is invisible. (Much of this falls out of Version History for free; see §2.7.)
- **Cost & usage** — consumption is metered per node and rolls up the tree, against committed capacity. This is where the CIO dashboard and the **cron-jobs KPI** — recurring work converted to standing infrastructure — are measured.
- **Run-state** — automation schedules, run history, and checkpoints persist so long-running and scheduled work survives restarts.
- **Sessions** — live and historical sessions, including shared ones, are retained and attributable.

---

## Section 2 — Out-of-the-Box Capabilities

> The magic is the platform doing real work the moment it's installed, with zero setup — *"grab the file Tim just DM'd me and drop a summary in the deck."* Everything here is chosen to deliver that on day one, and every capability is an act of subtraction: hiding machinery, surfacing meaning.

### 2.1 Connections — the daily surfaces and the systems of record

Every connection is one of two kinds, and the distinction *is* the safety model:

- **Gather (read)** — pulling the inputs of work: the message, the thread, the file, the record. Liberal and instant.
- **Deploy (send / write)** — the corporate equivalent of pushing to prod: the email sent, the message posted, the record updated, the file shared. Every deploy routes through the human-in-the-loop approval gate (§1.9). Sending is a deploy, and deploys always confirm first.

**Tier 1 — The daily surfaces.** Where work arrives, lives, and leaves. Shipped as full suites, since an organization is typically standardized on one.

- **Microsoft 365** — Outlook / Exchange, Teams, OneDrive / SharePoint, Word, Excel, PowerPoint, Calendar.
- **Google Workspace** — Gmail, Drive, Docs, Sheets, Slides, Calendar, Chat.
- **Slack** — messaging as both a gather surface ("the file Tim sent") and a deploy surface.

**Tier 2 — Systems of record.** The core platforms new software exists to patch around; connecting them is what makes the harness infrastructure rather than a convenience.

- **CRM** — Salesforce, HubSpot, Microsoft Dynamics.
- **ITSM & ticketing** — ServiceNow, Jira, Zendesk.
- **Data warehouse** — Snowflake, BigQuery, Databricks.
- **ERP & finance** — NetSuite, SAP, QuickBooks.
- **Code** — GitHub, GitLab.

**Tier 3 — Connective tissue.** Added for breadth as demand warrants: Confluence, Notion, Box, Dropbox, DocuSign, Workday.

### 2.2 Plain-language actions

The harness never shows the user code, queries, or commands. Before any data operation runs, it states in one plain sentence what it is about to do and against what.

- *"I'll pull the 40 contacts who opened last week's campaign from Salesforce."* — not a SQL block.
- *"I'll fetch the attachment from Tim's Slack message and read the first tab."* — not a curl command.
- The technical detail is available on request (a "show me the query" affordance for the one technical user in the room), but it is never the default surface. The marketing manager sees intent; the analyst can expand the mechanics. Same action, two audiences, one interface.

### 2.3 Work happens in plans

The default unit of work is a plan, not a running process. The harness proposes the steps in plain language, the user glances and approves, and only then does it act.

- A plan reads like a short list a colleague would send: *"1. Pull the opens. 2. Cross-reference against the deal list. 3. Draft the follow-up. 4. Hold for your approval before sending."*
- Plans make the harness legible and safe by construction: the human sees the whole shape before anything happens, which is where the §1.9 approval gate lives without feeling like a gate.
- Plans are also the maturity ladder: an approved plan is one step from becoming a **skill**, and a skill is one step from an **automation** (manual → skill → cron job) — with no new concept to learn.

### 2.4 Default skills

The starter library that makes the harness useful before a team has built anything. Each is a plan the user runs by asking in plain language, chosen to span the extract-transform-deliver shape of real work.

- **Summarize & catch me up** — a thread, an inbox, a channel, a document: *"what happened in #launch while I was out?"*
- **Draft the reply / the deliverable** — turn a request or a source into a first draft, held for approval before it sends.
- **Pull & compile** — gather from a connection and shape it into a table, a summary, or a chart, described in plain language as it goes.
- **Find it for me** — locate the file, message, or record across connected surfaces: *"the contract Tim sent last week."*
- **Prep me** — assemble context for a meeting, a call, or a deal from calendar, mail, and CRM.

These are not distinct "apps" — they are the same gather → shape → hold-for-deploy motion pointed at different surfaces, which is why they feel consistent rather than like a menu of features.

### 2.5 Default tools

Populating §1.8's local / server split, kept intentionally small. The user never chooses a tool; the harness selects and loads what a plan needs (per the load policy in §1.4).

- **Server-side** — web search / fetch, the shared inference endpoint, the scheduled automation runner.
- **Local** — scoped file access, the previewer, and read access to connected surfaces inside the user's fence.
- Tools stay invisible: the user asks for an outcome, and tool selection is a background decision explained only as plain-language intent (§2.2).

### 2.6 Seed memories & how assets are stored

A small set of standing instructions so the harness feels oriented from the first session, with no configuration required.

- **Who the user is** — their team, role, and working surfaces, inherited from their node in the tree.
- **House defaults** — the org's tone for drafts, its formats for deliverables, its approval norms — set once at the org or team node, inherited quietly.
- **Captured by offering, never by setup** — when the harness notices a durable preference (*"you always want these as a bulleted summary"*), it asks once whether to remember it. Configuration accretes from use, not from a wizard.

**Storage: files as format, the tree as source of truth.** Skills and memories are portable markdown artifacts — human-readable, model-friendly, versionable. Unlike a local-first agent, the authoritative store is **server-side, attached to nodes in the asset tree**, not to a machine. At session start a harness resolves its skills and memories by pulling the union of its node and its ancestors (§1.3) and materializing them locally for the run.

- **Why server-side** — promotion, portability, admin visibility, and survival past turnover are only possible if an asset lives on the tree, not on an individual's laptop. This is the difference between institutional knowledge and a scattered pile of local files.
- **Why still files** — local materialization keeps the model's context legible and keeps local tools working inside the fence.
- **Governance for free** — because assets are server-side and attributed to nodes, they fall under the same audit and boundary model as everything else.

### 2.7 Version History (the engine underneath)

Every skill, memory, and connection on the tree is **versioned**. This is what makes promotion, portability, rollback, and audit trustworthy rather than best-effort. It is built on a mature, industry-standard version-control engine under the hood — but the engine is never the interface. Users never see branches, commits, or merges; they see the *meaning* of those operations in plain language.

- **History** — *"Version 4 — the tone was made more formal, last Tuesday, by Ana."* Every change is attributable and reversible.
- **Promotion & portability** — moving a skill up or across the tree (§1.2 / §1.3) is a governed, recorded operation: *"Promote this skill to the whole Finance team?"*
- **Rollback** — *"Go back to the version from before yesterday's change."* Essential once skills become unattended automations: a misbehaving cron job reverts to its last good version instead of becoming an incident.
- **Conflict, when it happens** — because capabilities resolve most-specific-wins (§1.3), edits at different levels of the tree don't collide. In the rare case two people edit the same asset at the same node, the harness shows each change in plain language and asks which should win — never a raw merge.
- **Audit for free** — the version history *is* the change log: immutable, attributable, and feeding directly into the audit trail (§1.10).

The principle, consistent with §2.2: the platform exposes *versioned, reversible, promotable knowledge* — the powerful, proven machinery that provides it stays in the background where it belongs.

### 2.8 Model access

Inference is a **connection governed by the tree** (§1.4), not a hardcoded key.

- **Default** — the organization's own dedicated endpoint: committed-capacity, open-source models we host, inside the security boundary. This is the baseline and the cost model the platform is built on.
- **Optional providers** — an org may add a provider connection (a direct model vendor, Azure OpenAI, or an aggregator such as OpenRouter for breadth of model choice) as an **allowlisted egress**, set at the org or team node, inherited down, with credentials handled by key management (§1.9). A skill author may pin a specific model to a skill; the user never sees the choice.
- **Why not a shared aggregator key by default** — a per-request aggregator is the metered pricing model the platform exists to replace, and routing prompts through a third party punctures the deny-by-default egress boundary. It remains available as a governed, opt-in choice — never the foundation.

### 2.9 The experience contract

The through-line that makes all of the above deployable, not just usable:

- **Nothing technical in the foreground** — code, queries, and tool calls are background machinery, surfaced only on request.
- **Nothing happens without a plan you can read** — legibility is the safety model.
- **Nothing deploys without a confirmation** — sending is prod (§2.1).
- **Nothing requires setup to start** — value on day one; configuration accretes from use.
- **Everything is explainable** — a non-technical user can always answer "what did it just do?" in their own words. That sentence is the real product.