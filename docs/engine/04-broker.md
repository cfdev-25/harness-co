# Engine Plan — 04 · Broker

The broker is the part of `api` that turns a security group into a credential
for one session, and refuses when the organisation's rules say so. It is the
enforcement point behind every decision preflight makes about credentials
(`00` I4): preflight predicts, the broker decides, the proxy applies.

Read `00` §3 rows 5/12/13, §4.3, §4.6, §4.9, §4.10, §6, §7 D5/D9, and `10`
first. `prd-v2.md` §6 and §11 are the product rules this document implements.

## 1. Purpose

One request — `POST /v1/sessions` — does four things in order: checks the
person may run this provider and this model, works out which grant answers
each credential alias the harness needs, mints or fetches the credential from
the vault the group names, and records the session with everything it ran on.
Everything else here (revocation, close, rotation, audit) keeps that record
true for the life of the session.

## 2. Invariants

| # | Invariant | Source |
| --- | --- | --- |
| B1 | A value leaves the broker only inside a `MintedCredential`, only to the session's owner, only over TLS, and only for an alias a covering grant provides. | `00` I3, I4 |
| B2 | A vault-only alias is never filled from anything but its vault. The broker does not know what "local" means and never returns a value it did not get from a resolver. | prd-v2 §6.5; C4 |
| B3 | Approval and sources are re-derived here from the index, never trusted from the request. The request names aliases; it does not name grants, groups or vaults. | `00` I4 |
| B4 | A session that is not `active` mints nothing. | survey: today's deliver ignores status |
| B5 | Every refusal is a `Blocker` with a `broker.*` code and is an authoritative audit event. | `00` §4.7; C29 |
| B6 | Values are never logged, never stored on the session record, never in an audit payload. `slots` stores provenance only. | prd-v2 §6 |
| B7 | The covering-grant rule is the same function as preflight's (`03`), proven by the shared conformance fixtures. | `00` D2, §10 |

## 3. Contracts used

From `00` §4 by name: `Chain`, `ChainNode`, `Scope`, `SecurityGroup`,
`SecretRef`, `Grant`, `ModelProvider`, `HarnessProvider`, `Routing`,
`HarnessDef`, `Evidence`, `SlotState`, `ResolvedFrom`, `Slot`,
`MintedCredential`, `Blocker`, `Resolver`, `Probe`, `Minted`, and the
endpoints in §4.10.

**`Slot.via`** (`00` §4.6, D60): a `vault-or-local` alias the vault did not
fill comes back `deferred`, and the CLI must know *which group* deferred it
to check that group's `sources` before consulting a local login, so the
broker names the grant and group it chose even when it filled nothing.

From `02 §8.6`, three read seams over the index: `org_policy(org_id) ->
EffectivePolicy` (the org node's groups, providers, routing, kinds,
always-loaded, org-level grants and boundaries), `harness(org_id,
harness_id) -> HarnessDef | None`, and `effective_for(org_id, user_id) ->
{ chain, grants, boundaries, assets }` — the person's chain with every
grant on it, narrowed grants included and already validated at push. Each
raises `IndexStale` when any `idx_stale` row exists for the org.

`SessionContext`, private to the broker, is what a resolver receives so a
vault's own audit carries attribution:

```py
@dataclass(frozen=True)
class SessionContext:
    session_id: UUID
    person_id: UUID
    person_email: str
    org_id: UUID
    group: str
    grant: str
```

## 4. Module layout

Ceiling 700 source lines across the Python below. Azure and Vault resolvers
are counted when they land (`09`), 120 each.

| File | Exports | ≈LOC |
| --- | --- | --- |
| `backend/app/domain/broker.py` | `open_session`, `covers`, `pick_grant`, `Refusal` | 200 |
| `backend/app/domain/sessions.py` | `create_record`, `mark_revoked`, `retire_alias`, `close`, `owned_active` | 110 |
| `backend/app/domain/resolvers/__init__.py` | `registry`, `resolver_for(vault_id)` | 30 |
| `backend/app/domain/resolvers/bundled.py` | `Bundled` | 70 |
| `backend/app/domain/resolvers/aws.py` | `AwsSecretsManager` | 110 |
| `backend/app/domain/resolvers/azure.py` · `vault.py` | `AzureKeyVault` · `HashicorpVault` | later, 120 each — over the ceiling when they land, said here |
| `backend/app/api/routes_sessions.py` | the five routes in §4.10 plus `/endpoints` | 100 |
| `backend/app/api/routes_internal.py` | `POST /v1/internal/policy-changed` | 25 |
| `backend/app/domain/audit.py` | +`ensure_partition_for(created_at)` | +15 |

Sum ≈ 660 against the 700 ceiling (`00 §8`).

Deleted in the same milestone (`00` §6, `09`): `routes_api_keys.py`'s
`deliver` route, `api_keys.delivered_value`, `api_keys.key_is_visible`,
`harness_sessions.py` (folded into `sessions.py`).

## 5. Algorithms

### 5.1 `covers(grant, chain, harness_id) -> bool`

The one scoping rule (`prd-v2` §13). Identical in `03`; the fixtures in
`engine/compose/fixtures/scope/` are run by both.

1. If `grant.scope.teams == "all"` → team-covered. Else team-covered iff any
   `t ∈ grant.scope.teams` equals the `path` of some node in `chain` with
   `kind === "team"` — team nodes only, exactly as `engine/compose/src/scope.ts` and 03 §5.1; `scopeSpecificity` is `-1` for `"all"`.
2. If not team-covered → `False`.
3. If `grant.scope.harnesses` is absent → `True`.
4. Else `True` iff `harness_id ∈ grant.scope.harnesses`. A session with no
   harness (`harness_id is None`) is covered only by grants with no harness
   narrowing.

### 5.2 `pick_grant(alias, grants, groups, chain, harness_id) -> Grant | Refusal`

1. Candidates := covering grants (5.1) whose `group` names a group with an
   entry for `alias`. For a `narrowedFrom` grant, the entry must also be in
   `narrowedFrom.aliases`.
2. None → `Refusal("broker.no_grant_for_alias")`.
3. Specificity of a candidate := `(depth of the deepest chain node its scope
   names, 1 if scope.harnesses is set else 0)`. `"all"` has depth 0.
4. Take the maximum. Two candidates tie **and** resolve `alias` to different
   `SecretRef`s → `Refusal("broker.ambiguous_alias")`. Ties to the same
   secret are one answer; take the first by grant id.

### 5.3 `open_session(request) -> Response`  —  `POST /v1/sessions`

Request body:

```py
class OpenSession(BaseModel):
    id: UUID                           # client-generated, as today
    provider: str                      # HarnessProvider.id
    provider_version: str              # from Adapter.locate(); locate precedes mint
    harness: UUID | None
    model: tuple[str, str]             # (ModelProvider.id, model)
    aliases: list[str]                 # ≤ 64
    commits: dict[str, str]            # ref → commit, the chain as fetched
    workspace: str | None = None       # absolute; the folder the session runs in (08 D141)
    hostname: str | None = None        # the machine's name
```

`workspace` and `hostname` are optional: a CLI one version behind sends
neither and still opens a session. They are stored on `harness_sessions`
in step 8 and appear in **no** audit payload — `session.open` is readable
by an admin over the chain, and a person's paths are not (08 D141).

Steps. Each refusal names the step; the whole request is one transaction
that is rolled back on refusal except for the `session.refuse` audit event,
written in its own transaction.

1. **Authenticate.** `current_principal`; the person's user unit and `Chain`
   from `org_units` (`api` owns the tree). Rate limit: 10 opens per person
   per minute → `429 broker.rate_limited`.
2. **Load policy** — `org_policy`, `harness`, and `effective_for(org,
   person)`; the grants used below are `effective_for.grants` (B3: the
   person's own chain, from the index, never from the request). `IndexStale`
   → `409 broker.index_stale` (02 §8.4: the org's index is being repaired;
   nothing mints until it is). Otherwise, if the index's commit for any ref
   in `request.commits` is *older* than the commit the client fetched →
   `409 broker.index_behind` (the client composed a policy the server has
   not indexed yet; retry in a moment). Never the reverse check: a client on
   an older commit is fine — sessions record what they ran on.
3. **Harness.** `request.harness` set and not on the chain → `404
   broker.harness_not_found`.
4. **Provider approval.** `p := policy.harnessProviders[request.provider]`;
   missing → `broker.provider_unknown`. `p.approval == "not-approved"` →
   `broker.provider_not_approved` with `p.reason`. `covers(p, chain,
   harness)` false → `broker.provider_not_in_scope`. `p.approval == "beta"`
   and the caller holds no `org_unit_admins` row at any `org`/`team` node of
   the chain → `broker.provider_beta_admins_only`. Version below
   `p.pin.minVersion` (located pin) → `broker.provider_below_pin`.
5. **Model approval.** `(mp, m) := request.model`; `m ∉
   policy.modelProviders[mp].models` → `broker.model_unknown`. Then **the key**
   (W6-D6): `needs_key(policy.groups, mp)` — no `credential.alias`, or an alias
   no security group entry in a connected vault holds.
   **Unless the runtime signs in to it itself** (W7-D2, D156):
   `signs_in(request.provider, mp)` — `mp` is in that `HarnessProvider`'s
   `modelNative` list, which is the presets' and never a branch's
   (`seed.preset_model_native`, 07 §6). Then this session is
   **native**: `native := needs_key(…) and signs_in(…)`, it is allowed, it is
   recorded `native: true` on `session.open` and it is **not metered** (C22) —
   the request leaves the machine on the person's own login, not on a key this
   organisation minted. Otherwise, keyless → `403
   broker.provider_needs_key`. It is checked before approval, because a
   provider nobody holds a key for and no runtime can sign in to can serve
   nobody and approving it would change nothing; it is the same pair of
   functions (`broker.needs_key`, `broker.signs_in`) the console's
   Status column, `console.speaks_routed` and `PUT /v1/routing` read, so the
   row a console greys out is exactly the session this step refuses. *Held* is
   not *granted*: the alias the person's own grants must reach is step 6's, and
   its refusal is `broker.model_credential_missing`. W6-D6 retires the keyless
   gateway provider (00 §4.3): `credential` is now how a model provider is
   usable at all — and W7-D2 is not a way back to it, because a native session
   attaches the runtime's own credential rather than none. Approved iff
   `mp ∈ routing.approvedFor.harnesses[harness]` or `∈ .providers[provider]`
   or `∈ .teams[t]` for some team on the chain; else `broker.model_not_approved`.
   The engine speaks the model provider through the proxy; no wire-format
   check here — that is `03`'s and it is a detector.
6. **Aliases → grants.** For each alias, `pick_grant` (5.2). A `Refusal` is a
   `Blocker` on that slot, not a refusal of the session: the person may still
   run with the other slots satisfied and this one `unsatisfied` — preflight
   decides whether that is a launch (`03`). Exception: the alias the model
   provider's `credential` names is required; unsatisfied → the session is
   refused with `broker.model_credential_missing`. **Not in a native session**
   (W7-D2): no group holds that alias — that is what made the session native —
   so it is not added to `aliases` at all and no slot is made for it. Asking
   would refuse at this step the session step 5 just allowed; the CLI keeps its
   own `deferred` slot for it (03 §5.6) and the runtime uses its own login.
7. **Resolve.** For each alias with a grant, `g := groups[grant.group]`,
   `entry := g.entries[alias]`, `r := resolver_for(entry.secret.vault)`
   (missing → `broker.vault_unknown`). Then:
   - `g.sources == "vault"`: `r.resolve(entry.secret.ref, ctx, g.mint)`. On
     any failure the slot is `unsatisfied`, `evidence: "declared"`,
     `resolvedFrom: null`, `blocker: broker.vault_unavailable`, `via` set.
     **No fallback exists in this branch** (B2).
   - `g.sources == "vault-or-local"`: same call. On failure the slot is
     `deferred`, `evidence: "declared"`, `resolvedFrom: null`, no blocker,
     `via` set with `sources: "vault-or-local"`. The CLI may then consult a
     local login for *this alias only* (`03`).
   - Success: `MintedCredential{alias, value, kind, expiresAt, resolvedFrom:
     {source:"vault", vault, group, grant}, evidence}` and a `Slot` with
     `state: "satisfied"`, the same `resolvedFrom` and `evidence`, `via` set.
8. **Record.** `sessions.create_record` (§6) with `slots` = provenance only,
   plus `workspace` and `hostname` verbatim (08 D141; migration
   `0040_session_workspace.sql`).
9. **Audit.** One authoritative `session.open` event at the person's unit
   (§8). Commit.
10. **Return** `{credentials, slots, blockers}` — `blockers` is the session-
    level list (empty on success); per-slot blockers ride on their slot.

A step-4/5/6-exception refusal returns `403` (or `404`) with `{blockers:
[…]}`, writes `session.refuse`, and creates no record.

### 5.4 `GET /v1/sessions/{id}`

Owner only (`404` otherwise, as today's `owned_session`). Returns
`{status, retired: [alias…], revoked_reason}`. The supervisor polls this on
its interval (`08`); the proxy refuses injection for `retired` aliases and the
supervisor terminates on `revoked`/`closed`.

### 5.5 `POST /v1/internal/policy-changed`

Called by `definitions` post-receive (`02 §8.3` step 5b), authenticated by
`HARNESS_SERVICE_TOKEN` (shared secret, `Authorization: Bearer`). Body:
`{ org: UUID, refs: [{ ref, commit, paths: string[] }] }` (`00 §4.10`) —
`definitions` sends it only for a push that touched `policy/` or
`harnesses/` on an org or team ref, so every listed ref is a policy change.

1. For every `active` session in `org` whose `commits` names any listed
   `ref` → `mark_revoked(reason="policy_changed")`. Asset-only pushes never
   reach this endpoint.
2. Append `session.revoke` per session.

This is C33: a policy change ends the session. It is coarse by design — the
alternative, re-deriving each session's grants against the new policy,
duplicates `open_session` for a rare event.

### 5.6 Rotation → retire

`POST /v1/api-keys/{id}/rotate` (unchanged UX) additionally: for every
`active` session with a slot whose `resolvedFrom.vault == "bundled"` and whose
group entry's `ref` is this key's ref → `retire_alias(session, alias)` and
`session.retire` audit. The session continues; the proxy stops injecting that
alias (`05`). Rotation is a credential event, not a policy change, so C33 does
not apply — the person restarts when they need the new value.

### 5.7 Close

`PATCH /v1/sessions/{id} {status: "closed", endpoints: EndpointTally[]}`:
`r.revoke(minted)` for every `kind: "minted"` slot (best-effort; failures
audited as `session.revoke_failed`, never raised to the client); status →
`closed`; `endpoints_tally` stored; `session.close` event. `POST
/v1/sessions/{id}/endpoints` accepts `{ events: EndpointEvent[] }` (`00
§4.7`) during the session → one `session.endpoint` event per row
(authoritative — they come from the proxy, C29). `EndpointTally` is `00
§4.7`'s `{ host, port, alias?, count, refused, firstAt, lastAt }`, computed
by the supervisor (08 §10) and stored verbatim.

## 6. Schema deltas

```sql
-- 0030_sessions_broker.sql
alter table harness_sessions
  drop column access,                                   -- never read
  add column provider_id       text not null default 'pi',
  add column provider_version  text not null default '',
  add column model_provider    text,
  add column model             text,
  add column commits           jsonb not null default '{}',   -- ref → commit
  add column slots             jsonb not null default '{}',   -- alias → {state, evidence, resolvedFrom, via, kind, expires_at, version}  (version: the provider's version id, compared at the next open to mark retired — 11 §rotation)
  add column revoked_reason    text,
  add column endpoints_tally   jsonb,
  add column preflight         jsonb;                          -- the CLI's PreflightReport, posted once (console D7); never a value
alter table harness_sessions drop constraint harness_sessions_status_check;
alter table harness_sessions add constraint harness_sessions_status_check
  check (status in ('active','revoked','closed'));
create index harness_sessions_active_by_org on harness_sessions (org_unit_id) where status = 'active';

alter table api_key_versions add column grace_until timestamptz;
```

Immutable after create: `id`, `owner_auth_user_id`, `org_unit_id`,
`provider_id`, `provider_version`, `harness_id`, `model_provider`, `model`,
`commits`, `slots[*].resolvedFrom`. Mutable: `status`, `revoked_reason`,
`slots[*].retired`, `endpoints_tally`, `last_active_at`, and `preflight`, which is written once by the first supervise tick and never again. A heartbeat `PATCH` answers with the same body as `GET /v1/sessions/{id}` — `{status, retired, revoked_reason}` — so the supervisor's tick is one request (08 D145).

**Grace expiry (never existed).** `rotate` sets the old version's
`grace_until = now() + interval '24 hours'` (admin-settable per key, Later).
An hourly task in `api` sets `status = 'retired', retired_at = now()` where
`status = 'grace' and grace_until < now()`. `Bundled.resolve` reads `active`
only; `grace` exists so a bad rotation can be rolled back (`rotate` with the
previous value) within the window.

**Audit partitions.** `append_event` calls `ensure_partition_for(created_at)`
which is a no-op when the month matches a module-level cached month, and
otherwise creates this and next month's partitions idempotently
(`create table if not exists`). The pool-start call stays. Test
`audit_insert_survives_month_rollover`.

## 7. Resolvers

Registry: `resolvers.registry: dict[str, Resolver]` keyed by vault id;
`resolver_for(vault_id)` raises `Refusal("broker.vault_unknown")`. Vault ids
come from `SecretRef.vault` in the org branch's groups (`01 §4.2`), and the
same ids configure the registry in `api` settings (credentials for reaching
the vault are `api`'s own configuration, never on a branch). A vault id is
not validated at push (02 §7 step 11); an unknown one is refused here.

The person's machine is not a resolver here. It is a probe-only source that
lives in the CLI (`03`), consulted only for `deferred` slots — the seam is
`Slot.via.sources`.

**We never write to a customer's vault** (`prd-v2` §6.2). No resolver has a
`create` or `rotate` method; rotation on the bundled vault is `api_keys.rotate`.

### 7.1 `Bundled` — build first

The existing SecretBox registry behind the interface. Hands the proxy a `stored` value.

- `probe(ref)`: an `api_key_versions` row with `status = 'active'` exists
  for `api_keys.ref = ref` → `ready`, `evidence: "verified"`, detail
  `"active version N"`. Else not ready, `detail: "no active version"`.
- `resolve(ref, ctx, mint)`: decrypt the active ciphertext with
  `HARNESS_MASTER_KEY` → `Minted{value, kind: "stored", expires_at: None,
  evidence: "verified"}`. **What `verified` means here:** the platform
  confirmed a value exists and decrypts. It does not confirm the value is
  still accepted upstream — that is learned at first use, through the proxy,
  and reported by the session's endpoint log. The doc says this; the console
  says it on the vault's row.
- `revoke`: no-op.

### 7.2 `AwsSecretsManager`

Hands the proxy a `stored` value fetched with `minted` temporary keys (D68). Configured with a role `api` may assume in the customer's
account (their CloudFormation stack grants `sts:AssumeRole` + `secretsmanager:
DescribeSecret` + `secretsmanager:ListSecrets`; **never** `PutSecretValue`).

- `probe(ref)`: `DescribeSecret(SecretId=ref)` → ready with `evidence:
  "verified"`, detail `LastChangedDate`/`RotationEnabled` as reported (never
  graded, `prd-v2` §6.5). Access denied on describe but the secret is named
  in a group → ready `False`, detail `"list permission not granted"`.
- `resolve(ref, ctx, mint)`: `AssumeRole(RoleArn=mint["role_arn"],
  RoleSessionName=f"harness-{ctx.session_id}", DurationSeconds=mint.get
  ("duration_seconds", 3600), Tags=[harness:person=ctx.person_email,
  harness:session=ctx.session_id, harness:group=ctx.group],
  Policy=<session policy: GetSecretValue on ref only>)` → temporary keys. The
  proxy attaches them by signing? No — SigV4 is out of scope for inject mode
  (`05`); the minted value is the **secret's value fetched with the temporary
  keys** (`GetSecretValue` under the session policy), returned as `kind:
  "minted"`, `expires_at` = the role session's expiry. The temporary keys are
  discarded by `api` immediately. Attribution lands in the customer's
  CloudTrail via the session tags.
- `revoke`: STS sessions cannot be revoked early. Best-effort: nothing to
  call; documented. Revocation of *use* is the proxy ceasing to inject
  (`prd-v2` §11), which is why `expires_at` is short and the proxy re-checks
  `GET /v1/sessions/{id}`.

### 7.3 `AzureKeyVault` · `HashicorpVault` · others — the same shape, designed in 11

Each customer vault is specified in full in `11-vault-integrations.md`
(auth without a stored secret, list/read, probe, attribution, rotation
signal, failure codes, customer checklist, tests). Two facts from there
bind this document (11 D120, D125, D126):

- **What the proxy receives.** A static secret is `kind: "stored"` however
  it was fetched — AWS, Azure, GCP, 1Password, Conjur, HashiCorp KV v2 and
  the bundled vault all hand `stored` under a lease (`expires_at` = the
  smaller of the customer credential's expiry and `mint.lease_seconds`,
  default 3600). Only HashiCorp **dynamic** engines (database, AWS, …) hand
  `kind: "minted"` with the lease's `expires_at`, and `revoke` = lease revoke.
- **How `api` authenticates.** Federation from `api`'s own OpenID issuer
  (11 §4) — AWS `AssumeRoleWithWebIdentity` or role trust with `ExternalId`,
  Azure workload identity, GCP workload identity, HashiCorp **JWT auth**
  (not AppRole: its `secret_id` is a stored secret), Conjur `authn-jwt`.
  1Password's service-account token is a long-lived secret `api` holds, and
  its vault row says so. No response wrapping anywhere.
## 8. Audit events

All authoritative, at the person's unit, hash-chained as today.

| Action | Payload (never a value) | When |
| --- | --- | --- |
| `session.open` | `provider, provider_version, harness, model, commits, slots: [{alias, state, evidence, resolvedFrom, via, kind, expires_at}]` | 5.3 step 9 |
| `session.refuse` | `provider, harness, model, blockers: [codes]` | any 5.3 refusal |
| `session.revoke` | `reason, refs` | 5.5 |
| `session.retire` | `alias, key_id` | 5.6 |
| `session.endpoint` | one `EndpointEvent` (`00 §4.7`), verbatim | 5.7 batches |
| `session.close` | `endpoints_tally, minted_revoked: n, revoke_failed: [alias]` | 5.7 |

`session.mint` is folded into `session.open`: one event per session start,
one row per alias inside it. A separate event per alias would triple the
chain's growth for no query anyone asks.

## 9. Failure modes

| Code | HTTP | Message | Remedy |
| --- | --- | --- | --- |
| `broker.rate_limited` | 429 | You started more than ten sessions in a minute. | Wait a moment and run again. |
| `broker.index_stale` | 409 | Your organisation's definitions are being re-read after a failed update; sessions cannot start until that finishes. | Run again in a minute; if it persists an operator has been paged (02 §8.4). |
| `broker.index_behind` | 409 | The server has not finished reading the latest change to your organisation. | Run again in a few seconds. |
| `broker.harness_not_found` | 404 | That harness is not one you can see. | `harness switch` to pick another. |
| `broker.provider_unknown` | 403 | `{provider}` is not a harness provider your organisation has listed. | An organisation admin adds it under Providers. |
| `broker.provider_not_approved` | 403 | `{provider}` is not approved: {reason}. | An organisation admin can approve it under Providers. |
| `broker.provider_not_in_scope` | 403 | `{provider}` is approved, but not for your team. | Ask an organisation admin to widen its scope. |
| `broker.provider_beta_admins_only` | 403 | `{provider}` is in beta, so only admins are handed credentials with it. | Run with an approved provider, or ask an admin to approve it. |
| `broker.provider_below_pin` | 403 | Your `{provider}` is version {v}; your organisation requires {min}. | Update it and run again. |
| `broker.model_unknown` | 403 | `{model}` is not a model `{provider}` lists. | Choose one from `harness preflight model`. |
| `broker.model_not_approved` | 403 | `{model_provider}` is not approved for this harness, provider or team. | An organisation admin sets *approved for* under Model providers. |
| `broker.provider_needs_key` | 403 | `{model_provider}` needs a key: no security group holds a credential for it. | An organisation admin connects one with *Set up* under Model providers. Not raised when the session's runtime signs in to that provider itself (W7-D2, D156): that is native mode, not a missing key. |
| `broker.model_credential_missing` | 403 | Nothing you hold has a credential for `{alias}`, which `{model_provider}` needs. | Ask a team admin to narrow a group with `{alias}` into your team. |
| `broker.no_grant_for_alias` | slot | No group granted to your team has an entry for `{alias}`. | Ask a team admin to narrow one into your team. |
| `broker.ambiguous_alias` | slot | Two grants give `{alias}` different secrets at the same scope. | An admin narrows one of them to a harness, or removes one. |
| `broker.vault_unknown` | slot | `{vault}` is named by a group but is not connected. | An organisation admin connects it under Key vaults. |
| `broker.vault_unavailable` | slot | `{vault}` could not supply `{alias}`, and this group does not allow a local login instead. | Check the vault's row under Key vaults; the session cannot use your own login for this. |
| `broker.session_not_active` | 409 | This session is {status}. | Start a new one with `harness run`. |

## 10. Tests

| Tier | Name | Asserts |
| --- | --- | --- |
| T1 | `covers_matches_ts_fixtures` | every fixture in `engine/compose/fixtures/scope/` gives the same answer from `broker.covers` as the expected JSON |
| T1 | `pick_grant_narrowest_wins` | a team-scoped grant beats an org-wide one; harness-narrowed beats team-wide |
| T1 | `pick_grant_ambiguous_refuses` | two same-specificity grants, different secrets → `broker.ambiguous_alias` |
| T1 | `narrowed_grant_only_kept_aliases` | an alias outside `narrowedFrom.aliases` is not provided |
| T4 | `vault_only_never_falls_through` | `sources: vault`, resolver raises → slot `unsatisfied` with `broker.vault_unavailable`; response contains no credential for it |
| T4 | `vault_or_local_defers_with_via` | resolver raises → slot `deferred`, `via.sources == "vault-or-local"`, no blocker |
| T4 | `beta_credential_only_to_admins` | member → `broker.provider_beta_admins_only`; team admin on the chain → opens |
| T4 | `not_approved_refused_with_reason` | the stored reason is in the blocker message |
| T4 | `model_not_approved_refused` | provider approved, model provider outside every `approvedFor` → refused |
| T4 | `closed_session_never_mints` | `PATCH closed` then any mint path → `broker.session_not_active` |
| T4 | `policy_change_revokes_sessions_on_that_ref` | `policy-changed` with `policy_changed: true` on a chain ref → session `revoked`; `false` → untouched |
| T4 | `rotation_retires_alias_not_session` | rotate the key behind alias `crm` → `retired: ["crm"]`, status still `active` |
| T4 | `slots_never_contain_values` | every `slots` row and every audit payload lacks the minted value string |
| T4 | `open_writes_one_audit_event` | exactly one `session.open`; refusal writes exactly one `session.refuse` and no record |
| T4 | `index_behind_is_409` | client commit newer than indexed → 409, no record |
| T4 | `index_stale_refuses` | any `idx_stale` row for the org → `broker.index_stale`, no record; deleting the row lets the same request open |
| T4 | `audit_insert_survives_month_rollover` | freeze time past a month boundary; `append_event` succeeds |
| T4 | `grace_expires_to_retired` | rotate; advance `grace_until`; job runs; old version `retired` |
| T3 | `bundled_probe_and_resolve` | active version → ready/verified; decrypt round-trips; wrong master key fails closed |
| T3 | `aws_resolve_tags_and_scopes_session` | (recorded fixtures) `AssumeRole` called with the three tags and a single-secret session policy |

## 11. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D60 | `Slot.via` carries the grant, group and `sources` the broker chose, filled or not (`00` §4.6). | putting `sources` on `MintedCredential` and returning a stub credential for deferred slots — worse: a credential with no value |
| D61 | Rotation retires the alias; a policy change revokes the session. | revoking on rotation too — costs a restart on every key rotation for no security gain, since the retired alias is already refused |
| D62 | `provider_version` travels in the create body, because `locate()` runs at Choose (`00` §3 row 4), before Mint (row 5). | a PATCH after probe — leaves a window where the record lacks the version |
| D63 | `session.mint` is folded into `session.open`. | one event per alias |
| D64 | A missing non-model alias is a slot blocker, not a session refusal; preflight decides. | refusing the session — makes an optional tool's missing key block unrelated work |
| D65 | `policy-changed` revokes every active session on a changed policy ref, without re-deriving. | per-session re-derivation |
| D66 | `index_behind` is checked as `idx_refs.commit != commits[ref]` — `api` holds no ancestry, so "older" is undecidable and a client whose fetch predates an indexed push is also refused, fail-closed with a retry remedy. Sending the previous commit in `/internal/index` would let it be one-way; Later. | also refusing older client commits — would refuse every session opened during a push |
| D152 | **A model provider with no key held is refused at step 5, not at step 6** (W6-D6). `broker.needs_key(groups, provider)` — no `credential.alias`, or an alias no entry in a connected vault holds — is one function, read by the broker, by `console.speaks_routed` (and so by `canRun`, `runners_for` and the harness cards), and by `PUT /v1/routing`, so a provider the console keeps out of routing is exactly the session the broker refuses, with the same code and the same remedy. It retires 00 §4.3's keyless gateway row: a `ModelProvider` without a credential is now *needs a key*, because every wire format the proxy speaks attaches one and a row nobody can authenticate to was a row that failed at the first request instead of at the screen. | a `needs_key` check in the console only, which is a guess about the server; or keeping the keyless gateway and letting the proxy fail at request time |
| D156 | **A model provider no key reaches is the person's *sign-in* where the runtime has one, and `needs-key` where it does not** (W7-D2; amends D152, which refused every keyless provider). `needs_key` was one rule read in four places and it is still that rule — what changed is that it is now read beside a second, `broker.signs_in(runtime, model_provider)`, and the refusal is `needs_key ∧ ¬signs_in`. The pair is read in the same four places (step 5, `console._status`, `console.speaks_routed` → `canRun`/`runners_for`/the cards, `PUT /v1/routing`) plus the viewer's `setup.model`, so *your sign-in* on a screen is exactly a session the broker opens. `signs_in` is the runtime's `modelNative` list — the provider ids its adapter ships an OAuth flow for, 07 §6 — which lives in `engine/compose/presets/harness-providers.json` and is **stripped when the seed writes**, like `attach`: it is a fact about the runtime we ship, so an admin editing a branch can neither grant a sign-in the adapter lacks nor take one away. Absent is `False`, which is why every organisation that supplies keys and every runtime we ship no list for keeps D152 unchanged. Step 6 then does not ask for the model alias in a native session: no group holds it, so requiring it would refuse at step 6 the session step 5 allowed. | one `needs_key` with the native case bolted on as an exception inside it, which hides that two different facts are being read; or carrying `native` in the session-open body, which is a claim by the client about policy (B3) |
| D67 | The bundled vault's `verified` means "exists and decrypts", stated on the vault row. | calling it `declared` — understates what we did check |
| D68 | AWS: temporary keys used server-side to fetch the value, not handed out. | handing the temporary keys to the supervisor and having the proxy SigV4-sign — a large surface for one provider; revisit if a customer needs AWS-API reach rather than a secret value |

## 12. Out of scope

Brokered OAuth (`prd-v2` §22 Later); OpenBao as the bundled vault (same
interface, Later); `HARNESS_MASTER_KEY` rotation (Later — documented as
envelope re-encryption of `api_key_versions`); per-key grace duration UI;
SigV4-signing proxies; budgets and rate limits beyond `broker.rate_limited`.

## 13. Definition of done

- `POST /v1/sessions` implements §5.3 end to end against the bundled
  resolver; `POST /v1/api-keys/deliver` and its tests are gone.
- Every test in §10 exists by name and passes; `covers_matches_ts_fixtures`
  runs the same fixture directory the CLI runs.
- `harness_sessions` carries §6's columns; no value string is findable in
  `harness_sessions` or `audit_log` after a full T4 run.
- `broker.py` + `sessions.py` + `resolvers/{__init__,bundled,aws}.py` +
  route files ≤ 700 source lines.
- Every message in §9 appears verbatim in code and nowhere else.
