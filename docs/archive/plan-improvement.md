# Architecture Critique & Plan-Improvement Plan

**Status:** Draft for review — this document critiques the current build plan (`harness_company_platform` plan), identifies where the architecture breaks down, and defines the process for revising the plan before execution.

**Method:** Each finding states what we decided, where it breaks, why it will hurt, and the direction of the fix. Findings are severity-ranked. Section 3 adds the requirement specificity the PRD leaves open. Section 4 is the meta-plan: the ordered steps to turn this critique into a revised build plan.

---

## 1. Critical findings — decisions that will screw us

### F1. The security model is inverted: enforcement lives on hardware we don't control

**What we decided:** The policy extension (deploy gates, egress checks, manifest-only loading, audit upload) runs inside pi on the user's machine. The CLI verifies the signed manifest — also on the user's machine.

**Where it breaks:** A user, malware, or a prompt-injected model can bypass every one of these: run vendored pi directly, run upstream `pi-coding-agent` from npm, edit the materialized files, patch the extension, or simply not send audit events. Client-side signature verification verifies nothing an adversary cares about.

**Why it screws us:** The PRD sells "boundaries enforced in software, not model discretion" (§1.9) to CIOs. If we claim the extension enforces boundaries, the first serious security review will shred it — and worse, we'll have designed the real controls as afterthoughts.

**Fix direction:** Adopt an explicit **enforcement matrix** separating *guarantees* (server-enforceable) from *experience* (client-side):

- **Guaranteed server-side:** credentials (only obtainable via proxy/lease per-call, re-authorized every call), push-time asset validation, audit of every proxied action, model access (through the gateway), boundary changes (take effect at the proxy immediately — see F8).
- **Guaranteed-with-sandbox:** local egress and filesystem scoping — only real once execution is sandboxed. Pull the sandbox spike from Phase 4 into early phases; pi already has sandbox extension examples and `@anthropic-ai/sandbox-runtime` in its dev deps.
- **Experience layer (valuable, not security):** plan-then-act, deploy confirmations, plain-language actions, load policy. These make the product; they just aren't the fence.

The honest one-liner for the revised plan: *the fence is where the credentials and the network are — everything the client does is UX.*

### F2. The credential model is wrong for the connectors that matter most

**What we decided:** Secrets are static keys in Infisical, referenced by `secret://` refs, injected via proxy or short-lived lease.

**Where it breaks:** Tier-1 surfaces — Microsoft 365, Google Workspace, Slack — don't use static keys. They use **OAuth 2.0 per-user delegated tokens**: app registration, consent screens, scoped grants, refresh-token lifecycles, revocation on offboarding. "Connect once at the org level, members inherit use" (§1.4) means org-level *app registration* plus per-user *token grants* — two different objects our current model conflates. Infisical stores static secrets; it is not an OAuth token broker.

**Why it screws us:** The day-one magic ("grab the file Tim just DM'd me") is 100% OAuth territory. We'd discover this mid-Phase-2 and bolt on a token store under pressure.

**Fix direction (ratified, amended):** OAuth becomes a **strong first module** — a variety of OAuth workflows shipped early: user login SSO (Supabase Auth's OIDC/social providers cover this) and, separately, the **connection grant broker** for org app registrations plus per-user delegated grants (M365, Google, Slack). Build the broker in-house for Tier 1 using standard OAuth/OIDC libraries (authlib) with encrypted token storage and a refresh worker — three suites is a manageable surface, and it avoids a dependency we'd have to pay for later; Nango's free self-hosted tier stays on the bench as an accelerator if provider breadth outpaces us. The connection asset's boundary half references either a `secret://` ref (static keys) or a `grant://` ref (OAuth, resolved per-user).

### F2-bis. Key management stays — in-house, simple, non-technical (ratified)

Dropping the inference proxy does not drop key management. Enterprise integrations (an Oracle system, Snowflake service accounts, any API-key vendor) require **rotation**, and the PRD requires that a non-technical admin can run it. Replace the Infisical dependency (its rotation/dynamic-secrets tier is enterprise-licensed — violates the no-future-paid-deps constraint) with an **in-house key registry** on infrastructure we already pay for:

- A key is three things a marketing manager can understand: **the key, its friendly name, and its scope** (which node in the tree can use it — org, team, or user).
- Values encrypted at rest in Postgres (pgsodium / Supabase Vault); only the stable ref (`secret://finance/oracle-erp`) ever appears in assets, sessions, or context.
- **Rotation = a new version under the same ref**: paste the new key, old version enters a grace period then retires; nothing in the tree changes; every rotation is audited. Scheduled rotation reminders per key.
- Delivery: injected into the harness/tool process environment at session or automation start — never written to disk, never in model context; redaction filter scrubs values from tool output.
- Team admins manage their team-scoped keys and who can use them from the web app — the §1.4 "connect once, inherit safely" story without a technical UI.

### F3. Automations have nowhere to run

**What we decided:** "Scheduler + headless runners on pi-agent-core durable sessions" — Phase 3, one line.

**Where it breaks:** An unattended automation that touches anything local — on-prem systems of record, file shares, local credentials (§1.8's whole point) — has no execution home. The user's laptop is off at 3am. Our server-side runners are outside the customer's fence by definition.

**Why it screws us:** Automations are the north-star KPI (§1.10). If the architecture only supports server-side-connector automations, the KPI caps at trivial workloads, and we retrofit an agent-in-customer-network component late — the hardest kind of component to retrofit (installation, updates, security review, NAT traversal).

**Fix direction (ratified, amended):** The runner is **customer-owned, tmux-style** — not our infrastructure. `harness runner` is the same CLI in a persistent daemon mode, run on any machine the customer chooses (a workstation left on, a VM in their VPC, an on-prem box). It keeps durable pi sessions alive (pi-agent-core survives restarts), connects **outbound-only** to the backend to pull scheduled jobs, and reports run-state back. Our side stores only schedule definitions, the job queue, and run history — no execution fleet, no inbound holes, maximum customer ownership. Runners register as node-attached entities in the tree with their own boundary. Schema impact today is small (a `runners` table and a `target` on automations); retrofit cost later would have been enormous.

### F4. Git-on-a-volume makes the backend stateful and unscalable

**What we decided:** One bare git repo per org via pygit2 on a persistent volume inside the FastAPI service.

**Where it breaks:**

- The API becomes a **stateful pet**: horizontal replicas need shared disk (libgit2 + NFS locking is misery) or repo sharding with routing. Kills cattle-style deployment and most managed platforms.
- **Two sources of truth:** Postgres index (`head_commit`) and git content must stay transactionally consistent across two storage systems — a distributed-transaction problem we created for ourselves.
- **Write serialization per repo:** commits to one branch serialize; a busy org contends on a mutex.
- **Two DR stories:** Postgres PITR plus volume snapshots, restored to a mutually consistent point. Painful.

**Why it screws us:** This is the classic "cool tech in the hot path" mistake. The PRD requires versioned, attributable, reversible, promotable assets with plain-language history — that's a *semantics* requirement, not a git-runtime requirement.

**Fix direction:** Implement **git's data model in Postgres** (content-addressed blobs, version DAG, immutable commits-as-rows with author/message/provenance) — single source of truth, transactional with the rest of the schema, scales with Postgres, zero new stateful infrastructure. Provide **export to a real git repo** on demand (compliance mirrors, enterprise backup) — cheap to generate from the CAS, and it keeps the "industry-standard engine" story true where anyone actually touches it. Keep the storage behind a repository interface so a real-git backend remains swappable if bidirectional git interop ever becomes a genuine requirement.

### F5. Streaming every token through the CRUD API

**What we decided:** `/v1/inference` inside the FastAPI backend proxies all model traffic.

**Where it breaks:** Inference is thousands of concurrent long-lived SSE/streaming connections. Inside the same Python service that does resolve/push/audit: worker starvation, memory growth, and — worst — **every API deploy severs every live session in every org**. Availability coupling is backwards: the data plane (inference) must outlive control-plane restarts.

**Fix direction (ratified, amended):** The inference proxy is **dropped as a requirement for now**. pi already speaks to every major provider natively; orgs bring their own provider keys, which are governed by our key registry (F2-bis below) and injected into the harness process environment at launch — we manage the keys, not the traffic. Consequences accepted and recorded: cost metering becomes client-attested usage reporting (see F9's attested class) rather than authoritative token metering, and model-key revocation is effective at next session start rather than per-call. A gateway remains a clean future insert (the provider config is generated at resolve time, so pointing it at a gateway later is a config change, not an architecture change).

---

## 2. High and medium findings

### F6. (High) Deployment model is undefined and it decides everything

Multi-tenant SaaS, single-tenant managed, or BYO-VPC changes: managed Supabase vs self-hosted vs plain Postgres; where the connector proxy and runners live; data residency; compliance scope. The PRD's "enterprise deployability" plus deny-by-default egress strongly suggests single-tenant/BYO-VPC will be demanded by exactly the customers the product targets. **Fix:** declare multi-tenant SaaS as the launch target, but enforce seams that keep single-tenant possible: no Supabase-exclusive features in critical paths (auth behind an adapter, Postgres kept vanilla), all services containerized, no hard dependency on Supabase Storage/Realtime.

### F7. (High) Supabase Auth is not enterprise identity

Verified (Sept 2026): SAML SSO is Pro-plan-plus with no Single Logout; **SCIM is not GA** (implementation still in draft PRs on `supabase/auth`). The PRD's §1.5 (SSO/RBAC) and the turnover story (§1.5, offboarding revocation) effectively require SAML + **SCIM deprovisioning**. **Fix:** keep Supabase Auth for MVP (it's fine for email + basic SAML), but put identity behind an interface from day one and plan a WorkOS-class provider or self-managed OIDC bridge before GA. Offboarding must chain: SCIM deprovision → memberships revoked → leases revoked → OAuth grants revoked → sessions invalidated.

### F8. (High) Boundary changes don't reach live sessions

A signed manifest resolved at session start is stale the moment an admin tightens a boundary or revokes a connection. Long-running automations make this worse. **Fix:** manifests get a short TTL and a session re-resolves on expiry; but the *real* mechanism is F1's: the proxy re-authorizes **every call** against current boundaries, so revocation is immediate where it matters regardless of what the client has cached. State this explicitly as the revocation model.

### F9. (Medium) Audit ingestion will drown Postgres — and half of it is untrustworthy anyway

Every tool call from every session appended to one hot table grows without bound. And per F1, client-reported audit events are unverifiable. **Fix:** two audit classes — **authoritative** (generated server-side at the proxy/gateway/push/resolve: complete and trustworthy) and **attested** (client-reported local tool calls: best-effort, labeled as such). Batch ingestion endpoint, time-partitioned tables with a retention policy from day one, roll-up aggregates for the cost dashboard, object-storage archive later.

### F10. (Medium) The build-fence draft flow breaks the iteration loop

"A draft cannot load into any session including the current one" means a user can't *test* a skill before pushing — the §2.3 maturity ladder becomes a bureaucratic chore, violating the PRD's own governing principle. **Fix:** drafts are loadable **only in the authoring session**, visibly marked, with boundary lint run locally as a pre-check; push (with server-side validation) remains the only path to persistence, sharing, or any other session. The fence holds — construction still can't escape the session that built it — without killing iteration.

### F11. (Medium) Upstream drift and experimental foundations

pi moves fast; its protocol/server/client packages are explicitly experimental with no compatibility guarantees, and its Unix transport has no peer auth. Subtree pulls will conflict in proportion to how much we edit upstream files. **Fix:** (a) discipline — changes land in our packages by default; every upstream-file edit is recorded in `docs/pi-patches.md` with rationale; pin the upstream ref; scheduled subtree pulls. (b) Session sharing gets a relay service we own (auth, tenancy, TLS) with pi-server treated as reference design, not foundation.

### F12. (Medium) The CLI can't actually be deployed to enterprise users

`npm install -g` with Node ≥22 is a developer flow, not an enterprise one. Unaddressed: signed/notarized installers (macOS, Windows), a bundled runtime (or a compiled binary via Bun/SEA), org-controlled update channels, and MDM-friendly packaging. This is a product requirement the PRD implies ("nothing requires setup to start") and the plan skips. **Fix:** add a distribution workstream; decide runtime-bundling strategy early because it constrains how the harness package loads extensions.

### Smaller items (tracked, not elaborated)

- **Load policy (§1.4)** — dynamic task-aware loading is asserted in the PRD and undesigned in the plan; needs a design note (likely: manifest marks assets load-on-demand; extension loads on first relevant plan step).
- **RLS honesty** — the backend uses the service role, so RLS protects little; either implement RLS for web-app direct reads or drop the "defense in depth" claim.
- **Infisical licensing** — dynamic secrets/rotation are enterprise-licensed even self-hosted; the adapter must make OpenBao a real option, and F2 reduces how much this matters (OAuth tokens move to the broker).
- **Backend availability tiering** — resolve/push can tolerate brief maintenance; the gateway, token broker, and lease endpoint cannot; deploy and scale them as separate availability tiers (falls out of F5).

---

## 3. Requirement specificity — proposed targets to ratify

The PRD defines behavior, not envelopes. These are proposed concrete targets; confirming or amending them is Step 1 of the improvement plan, because several architecture choices (F4, F5, F9) are only judgeable against numbers.

**Scale design point (initial):**
- 100 orgs; up to 5,000 users in the largest org; tree depth ≤ 6; ≤ 50,000 assets per org.
- 2,000 concurrent live sessions platform-wide; 1M proxied tool/model calls per day.
- 50,000 automation runs/day platform-wide; individual runs up to 4 hours, survivable across runner restarts (pi-agent-core durable sessions).

**SLOs:**
- Resolve p95 < 500 ms; push validation p95 < 2 s.
- Gateway added latency p95 < 150 ms; time-to-first-token overhead < 300 ms.
- Data plane (gateway, token broker, lease endpoint) 99.9% monthly; control plane (resolve/push/admin) 99.5% with maintenance windows.
- Boundary revocation effective at the proxy < 60 s from admin action.

**Durability/DR:** RPO ≤ 15 min, RTO ≤ 4 h; asset version history is never lossy (immutable CAS rows, no retention limit); audit retention default 13 months, org-configurable.

**Identity:** SAML SSO and SCIM deprovisioning are GA requirements. Offboarding chain (deprovision → membership → leases → OAuth grants → sessions) completes < 5 min.

**Deployment:** Multi-tenant SaaS at launch. Single-tenant BYO-VPC must not be *precluded* by any launch decision (see F6 seams); targeted as a year-one sales-qualified option.

**Threat model (ratify explicitly):**
- Trusted: backend services, secret engine, token broker, gateway.
- Untrusted: the model (always), the user's machine (for enforcement), client-reported telemetry.
- Guarantees only via: server-held credentials re-authorized per call, push-time validation, server-side audit, sandboxed execution (once shipped).
- The client layer (plans, confirmations, plain language) is experience, not enforcement, and is never represented otherwise in security documentation.

**Compliance posture:** SOC 2 Type II on the roadmap; per-org data residency (US/EU) as a schema-level assumption (org → region pinning), not a retrofit.

**Dependency policy (ratified):** No dependencies with future paid tiers in critical paths. Acceptable spend: Supabase and commodity cloud infrastructure (AWS-class). Consequences applied: Infisical is out (enterprise-licensed rotation) — key registry built in-house; LiteLLM gateway dropped with the inference proxy; OAuth broker built in-house for Tier 1 (Nango free tier optional, never load-bearing); WorkOS-class identity deferred — Supabase Auth behind an adapter with a documented upgrade path.

---

## 3-bis. CIO review — holes found, adds ratified

A simulated CIO/CISO procurement review against the revised architecture. All items below are ratified adds. The governing principle: **each lands in the foundation as a schema or protocol primitive now; product surface can follow later.**

### F13. Model-traffic visibility and the positioning that covers it

Dropping the inference proxy (D2) means prompts flow directly from client machines to providers — no central log, no DLP hook, attested-only cost data. This contradicts a literal PRD claim ("nothing the harness does is invisible") unless positioned correctly. **Adds:** (a) official positioning — *your keys, your provider agreements (DPA/ZDR), your endpoint*: the PRD's §2.8 org-endpoint default keeps model traffic inside the customer perimeter, and BYO keys means the org's own provider terms apply; (b) the gateway remains the documented upgrade for central-inspection demands (already a config-level insert per D2); (c) provider config in the manifest records *which* endpoint/model each session used, so authoritative metadata exists even where content doesn't.

### F14. Provider keys in client env are stealable by the model itself

With keys in process env, unsandboxed bash, and open egress, `echo $KEY | curl` is a one-liner — and a prompt-injected model can do it unprompted. Violates §1.9's "raw keys never exposed" for model keys. **Adds:** (a) **sandbox/egress moves from Phase 4 to Phase 2** as a guarantee-tier deliverable, not polish; (b) key registry supports per-user provider keys (blast radius = one user) and provider-side spend caps as recommended defaults; (c) strongest answer stays the in-fence org endpoint, where a leaked credential is worthless outside the network.

### F15. Budgets and quotas — the missing feature a CIO expects on the demo

Metering without caps is not cost governance. **Adds:** per-node **budget and quota policy** as a boundary type (inherits top-down, tightens only — same single rule): spend limits, token/run quotas, rate limits. Enforced server-side at the choke points we still own: resolve (deny/degrade at budget exhaustion), key/grant delivery, schedule admission for automations. Schema lands in Phase 1; dashboard UX later.

### F16. Audit integrity and SIEM export

Attested client events are self-reported; a CIO wants tamper-evidence and their own pane of glass. **Adds:** (a) **hash-chained audit records** (each record carries the previous record's hash per node-stream) so gaps and edits are detectable — trivial to add at table-design time, near-impossible to retrofit over live data; (b) **SIEM export** (webhook/stream to Splunk, Sentinel, Datadog) as a Phase 3 deliverable on the existing audit schema.

### F17. Session sharing crosses permission boundaries

User B joining user A's live session may see data B's resolved set doesn't permit. **Adds:** a session **join access model** designed before the feature ships (Phase 4): join requires shared node ancestry or an explicit owner grant, every join/leave is authoritative-audited, and sessions are flagged when participants' capability sets differ. Session records get an `access` field in the Phase 1 schema so history is never ambiguous about who could see what.

### F18. Runner registration and job authenticity

Customer-owned runners hold credentials and execute unattended work — the self-hosted-runner attack surface (GitHub Actions' lessons apply directly). **Adds:** runner **registration requires an admin-issued, node-scoped enrollment token**; runners hold their own scoped identity (not a user's), rotated like any key; job payloads are **signed by the backend** and verified by the runner; runner credentials are included in the offboarding/revocation chain (an automation whose owner departs is suspended pending reassignment, not silently continued).

### F19. Compliance and vendor-security posture pack

Named, documented stances — mostly paper and roadmap, but the schema hooks land now:
- **Retention, legal hold, eDiscovery:** sessions are business records; per-org retention config and a hold flag on sessions/assets in the Phase 1 schema; export tooling later.
- **BYOK/CMK:** who holds encryption keys in multi-tenant SaaS; document the path (pgsodium key hierarchy → per-org keys → customer-managed) without building it yet.
- **Prompt-injection stance:** a written design position — untrusted content is fenced by the same machinery (deploy gates, egress allowlist, no raw credentials in context), not by model good behavior.
- **Vendor readiness:** SBOM + dependency scanning over the vendored pi tree in CI (Phase 1), pen-test cadence and vulnerability disclosure policy pre-GA, subprocessor list (model providers are subprocessors the moment an org routes traffic to them).

## 4. The plan-improvement plan

How this critique becomes a revised build plan, in order:

**Step 1 — Ratify the envelope (with founder).** Confirm/amend Section 3 targets and the threat model. Decisions gate everything below.

**Step 2 — Adopt the enforcement matrix (F1).** Rewrite the plan's security sections around server-enforceable guarantees; reclassify the extension as experience layer; move a sandbox spike into the first build phase.

**Step 3 — Revise the component architecture.** Apply to the main plan:
- Versioning → Postgres content-addressed store with git export, behind a repository interface (F4).
- Inference/connector data plane → separate gateway service(s); LiteLLM evaluation (F5).
- Token broker for OAuth connections; Nango evaluation; `grant://` vs `secret://` ref split (F2).
- Runner as a first-class tree entity; automations get a `target`; org-deployed runner pattern documented (F3).
- Manifest TTL + per-call proxy re-authorization as the revocation model (F8).
- Audit: authoritative vs attested classes, batching, partitioning, retention (F9).
- Draft flow: session-scoped loading (F10).
- Identity adapter; deployment seams (F6, F7).
- CLI distribution workstream (F12).

**Step 4 — Time-boxed spikes (pass/fail, before committing the revised plan):**
1. **pi gating spike:** prove the extension API can intercept/block every tool call and prevent unregistered tool activation; prove `--no-extensions -e ours` + disabled package manager leaves no load path we missed. (Validates the experience layer *and* documents its limits per F1.)
2. **Gateway spike:** LiteLLM (or thin Node gateway) streaming to pi's custom provider with short-lived scoped tokens and per-user metering.
3. **Token broker spike:** self-hosted Nango free tier — org app registration + per-user Slack OAuth grant + proxied API call, token never touching the client.
4. **CAS spike:** blob/commit schema in Postgres; measure promote/rollback/history at the Section 3 scale numbers; generate a valid git export.
5. **Headless runner spike:** pi in a container via `--mode json` on a durable session; kill and resume.
6. **Sandbox spike:** evaluate pi's sandbox extension path (`@anthropic-ai/sandbox-runtime`, or OS-level: Seatbelt/bubblewrap) for filesystem + egress scoping of tool execution.

**Step 5 — Rewrite the main plan.** Fold Steps 2–4 results into `harness_company_platform` plan; re-sequence phases (data plane and enforcement earlier; web admin later); then begin execution.

---

## 5. Decision register

| # | Decision | Recommendation | Status |
|---|----------|----------------|--------|
| D1 | Versioning engine | Postgres CAS (git data model) + git export; not git-on-volume | Ratified |
| D2 | Inference data plane | Dropped: direct provider access with org keys from the key registry; gateway is a future config-level insert | Ratified (amended) |
| D3 | OAuth module | Strong first module: SSO logins + in-house Tier-1 grant broker (authlib); Nango free tier optional, never load-bearing | Ratified (amended) |
| D4 | Automations execution | Customer-owned tmux-style runners (`harness runner` daemon, outbound-only); we store schedules and run-state only | Ratified (amended) |
| D5 | Enforcement matrix | Server = guarantees; client = experience; sandbox pulled earlier | Ratified |
| D6 | Deployment target | Multi-tenant SaaS launch; BYO-VPC-preserving seams | Ratified |
| D7 | Identity | Supabase Auth MVP behind adapter; upgrade path documented, no paid provider for now | Ratified (amended) |
| D8 | Scale/SLO envelope | Section 3 numbers | Awaiting ratification |
| D9 | Draft fence semantics | Session-scoped draft loading | Ratified |
| D10 | CLI distribution | Signed installers + bundled runtime; org update channels | Ratified |
| D11 | Key management | In-house key registry: key + friendly name + scope; pgsodium encryption; versioned rotation under stable refs; non-technical admin UX | Ratified |
| D12 | Dependency policy | No future-paid dependencies in critical paths; Supabase + commodity cloud only | Ratified |
| D13 | Model-traffic posture | "Your keys, your DPA, your endpoint" positioning; gateway as documented upgrade; endpoint/model metadata in manifest | Ratified |
| D14 | Sandbox timing | Sandbox/egress enforcement pulled to Phase 2 (guarantee tier); per-user provider keys + spend caps as defaults | Ratified |
| D15 | Budgets & quotas | Budget/quota as a boundary type, tighten-only, enforced at resolve/key delivery/schedule admission; schema in Phase 1 | Ratified |
| D16 | Audit integrity | Hash-chained audit records from day one; SIEM export in Phase 3 | Ratified |
| D17 | Session-join ACL | Shared ancestry or owner grant; audited joins; capability-mismatch flagging; schema hook in Phase 1 | Ratified |
| D18 | Runner security | Admin-issued node-scoped enrollment; runner-scoped identity; backend-signed jobs; in offboarding chain | Ratified |
| D19 | Compliance pack | Retention/hold schema hooks now; BYOK path documented; prompt-injection stance written; SBOM scanning in CI | Ratified |
