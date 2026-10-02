# Engine Plan — 11 · Vault integrations

How `api` reaches each key manager a security group may name, what it asks
the customer to create, what it can confirm before a session starts, and what
it hands the proxy. One `Resolver` interface (`00 §4.9`), one registry
(`04 §7`), one provider per section. Every mechanism claim below is tied to a
provider document in §16, read on 25 September 2026; where a document did not
settle a point the text says **unverified** rather than asserting.

Read `00 §1`, `§4.3`, `§4.6`, `§4.9`, `§7`; `04` in full; `prd-v2.md`
§6.1–§6.7; console `04 §11` (the Key vaults screen this document feeds).

## 1. Purpose

`04` builds the broker against the bundled resolver and sketches AWS. This
document is the researched plan for the resolvers that follow: the federation
path by which `api` authenticates to a customer's vault **without holding a
long-lived secret**, the least-privilege grant the customer creates, whether
listing names is separable from reading values (prd-v2 §6.2 relies on it),
whether anything session-scoped can be minted, how the person and session
appear in the customer's own audit log, how the broker learns a value changed,
and what the console's *Connect a vault* checklist renders.

Vaults are not graded (prd-v2 §25). What matters to a customer is that the
key exists and is secured; what matters to the engine is two facts per slot,
stated and never rounded up: the evidence level (`00 §4.6`) and whether the
value handed to the proxy is `minted` — created for this session and expiring
with it — or `stored` — a long-lived value handed out under a lease.

## 2. Invariants

| # | Invariant | Source |
| --- | --- | --- |
| V1 | `api` holds no long-lived credential for a customer vault. It authenticates by presenting a short-lived token it signs itself (§4) or, for AWS, by assuming a role. The one exception is 1Password (§9), and the console row says so. | I3, prd-v2 §6.2 |
| V2 | We never write to a customer's vault: no create, update, rotate, delete, tag or policy call in any resolver, and the customer's grant should not permit one. | prd-v2 §6.2; 04 §7 |
| V3 | `probe()` never returns a value and never calls an operation that would. | prd-v2 §6.1 |
| V4 | `kind` follows `00 §4.6` literally: a static secret value is `stored` however it was fetched; `minted` only when the vault created the credential for this session. | 00 §4.6 |
| V5 | Attribution: every call that reads a value carries the session and, where the provider allows, the person, in a form the customer's own log records. | prd-v2 §6.5 |
| V6 | Failure is a `Blocker`; there is no partial or degraded read. A vault that cannot be reached leaves a `vault` group `unsatisfied` and a `vault-or-local` group `deferred` (04 §5.3 step 7). | I5 |
| V7 | We record what a provider reports and never grade it: no rotation age, no hygiene, no recommendation. | prd-v2 §6.5 |
| V8 | List permission is asked for and what it buys is said; without it the console shows what an admin declared and says it can show no more. | prd-v2 §6.2 |

## 3. Contracts used

From `00 §4`: `SecretRef`, `SecurityGroup.mint`, `Evidence`, `Slot`,
`MintedCredential`, `Resolver`, `Probe`, `Minted`. From `04 §3`:
`SessionContext`. Nothing is added to `00 §4`.

**`kind` and `expires_at`, decided once (D120, D121).** For a `stored` value
from a customer vault, `expires_at` is the earlier of the customer-side
credential's own expiry (the AWS role session, the Entra or Google access
token, the Vault token) and `group.mint.lease_seconds` (default 3600). The
proxy already treats a past `expiresAt` as retired (05 §7.1), so this lease
is the one mechanism in v1 that bounds how long a value rotated away in the
customer's vault keeps being injected (§3 of each provider, and D123). The
bundled vault's `expires_at` stays `null` (04 §7.1): its rotation is a push
(04 §5.6), so no lease is needed. For a `minted` value `expires_at` is the
lease the vault reported.

**`group.mint` keys read by this document**, opaque to the CLI (`00 §4.3`):

| Key | Providers | Meaning |
| --- | --- | --- |
| `lease_seconds` | all customer vaults | D121 lease; capped by the provider's own maximum |
| `role_arn`, `duration_seconds` | AWS | the role to assume and the STS session length |
| `ttl` | HashiCorp dynamic engines | requested lease on `creds/` reads |

**Failure codes (D124).** The `vault.<provider>.*` codes in each §8 are
`Probe.detail` values and `POST /v1/vaults` connect-time refusals. At mint the
slot blocker is always `broker.vault_unavailable` (04 §9), with the
`vault.*` code carried in its message so an admin can find the row. `00 §4.7`
is not widened.

## 4. `api` as an OpenID issuer — the shared prerequisite

Every no-stored-secret path except direct AWS role assumption works the same
way: the customer's identity system trusts tokens from an issuer URL, fetches
that issuer's signing keys by OpenID discovery, checks `iss`, `sub` and
`aud`, and exchanges the token for its own short-lived credential. Entra
"uses this issuer URL to fetch the keys that are necessary to validate the
token" [AZ2]; Vault's JWT method takes an `oidc_discovery_url` "without any
.well-known component" or a `jwks_url` [HV1]; Google's provider takes
`--issuer-uri` and `--allowed-audiences` [GC3]; Conjur takes `jwks-uri`
[CJ1]. So `api` must publish `/.well-known/openid-configuration` and a JWKS,
hold a signing key, and mint a JWT per `resolve()`/`probe()` call.

Shape (D122):

| Claim | Value | Why |
| --- | --- | --- |
| `iss` | `https://<api-host>` | the discovery document lives under it |
| `sub` | `harness:org:<org_id>:vault:<vault_id>` | one stable subject per connected vault. Entra's federated credential matches `subject` exactly and allows at most 20 per app [AZ2]; Google's `google.subject` is capped at 127 characters [GC1]; per-person subjects do not scale and AWS advises against PII in `sub` because it lands in CloudTrail [AW9] |
| `aud` | provider-specific (§5–§10) | each trust names one audience |
| `exp` | `iat + 300` | the token is used once, immediately |
| `harness_person`, `harness_session`, `harness_group` | from `SessionContext` | ignored by Entra and Google; copied into Vault token metadata by `claim_mappings` [HV1]; matched by Conjur host annotations [CJ1] |

The key is rotated by publishing the next key in the JWKS before signing with
it; Entra "stores only the first 100 signing keys" [AZ1], so the JWKS never
carries more than two. This issuer gates M6 (§13) and is not in `09` today.

## 5. AWS Secrets Manager (+ STS)

**5.1 Authenticating without a stored secret.** The customer creates an IAM
role whose trust policy names our principal and requires an `ExternalId` we
generate per customer — "one external ID per AWS account … a random string
generated by the third party" [AW2]; "AWS does not treat the external ID as a
secret" [AW2]. Two hops are possible: if `api` runs in our own AWS account its
task role calls `AssumeRole` directly; if it runs elsewhere it first calls
`AssumeRoleWithWebIdentity` — which "does not require the use of AWS security
credentials" [AW9] — into a role in our account using the §4 token, then
`AssumeRole` cross-account. The second is role chaining, which "limits your …
role session to a maximum of one hour" [AW1]; a `duration_seconds` above 3600
is refused at connect time in that topology.

The trust policy needs **both** statements or tagged assumption fails: "the
role trust policies … must have the `sts:TagSession` permission" [AW3].

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "HarnessAssume", "Effect": "Allow", "Action": "sts:AssumeRole",
    "Principal": { "AWS": "arn:aws:iam::<our-account-id>:role/harness-broker" },
    "Condition": { "StringEquals": { "sts:ExternalId": "<external-id-we-generated>" } } },
  { "Sid": "HarnessTag", "Effect": "Allow", "Action": "sts:TagSession",
    "Principal": { "AWS": "arn:aws:iam::<our-account-id>:role/harness-broker" },
    "Condition": { "ForAllValues:StringEquals": { "aws:TagKeys": ["harness:person", "harness:session", "harness:group"] } } } ] }
```

The permissions policy names exactly three actions [AW4]; `ListSecrets` is
the one that buys the inventory (V8) and may be omitted:

```json
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
    "Resource": "arn:aws:secretsmanager:<region>:<account>:secret:<prefix>/*" },
  { "Effect": "Allow", "Action": "secretsmanager:ListSecrets", "Resource": "*" } ] }
```

Never `PutSecretValue`, `UpdateSecret`, `RotateSecret`, `CreateSecret`,
`DeleteSecret` (V2). At `resolve` the broker passes a session policy allowing
`GetSecretValue` on the one ARN; "the resulting session's permissions are the
intersection of the role's identity-based policy and the session policies"
[AW1]; plaintext ≤ 2,048 characters [AW1].

**5.2 List vs read.** Separated. `ListSecrets` returns names, ARNs, tags and
dates and says "to retrieve the values … call `BatchGetSecretValue` or
`GetSecretValue`" [AW5]; `DescribeSecret` "does not include the encrypted
secret value" [AW6]. Each is its own IAM action [AW4].

**5.3 What is session-scoped.** The temporary keys are: `DurationSeconds` is
900–43,200 s within the role's maximum, default 3,600 [AW1], and they carry
up to 50 session tags of ≤128/≤256 characters [AW1]. The secret value is
not. Under V4 the proxy receives `kind: "stored"`, `expires_at` = the STS
`Expiration` or the D121 lease, whichever is earlier. This is 04 D68 stated
honestly: the temporary keys are used server-side and discarded; what
travels is a stored value. (04 §7.2's heading says exactly this; its `resolve`
bullet still says `kind: "minted"` and is amended by D120.)

**5.4 Probe.** `DescribeSecret(SecretId=ref)` under the assumed role: no value
[AW6], quota 40,000 requests per second per region [AW7], CloudTrail-logged
[AW6]. Success → `ready: true`, `evidence: "verified"`, detail carrying
`LastChangedDate` and `RotationEnabled` as reported (V7). It proves the secret
exists and we may read its metadata; it does not prove `GetSecretValue` would
succeed, and the detail says so. `ResourceNotFoundException` → not ready,
*secret not found*; `AccessDeniedException` → *describe permission not
granted*; a `DeletedDate` present → *scheduled for deletion* [AW6]. Failure of
`AssumeRole` itself is a vault-level fact on the Key vaults row.

**5.5 Attribution in CloudTrail.** "The role session name is visible to, and
can be logged by the account that owns the role … subsequent cross-account
API requests … will expose the role session name … in their AWS CloudTrail
logs" [AW1]; we set `RoleSessionName=harness-<session_id>` (≤ 64 characters,
`[\w+=,.@-]*` [AW1]). The `AssumeRole` event's `requestParameters` carries
`principalTags` [AW3], so `harness:person=<email>` is in the customer's trail
next to the session. `SourceIdentity` (≤ 64 characters, persists across
chaining [AW1]) could carry the person on every entry — **unverified**, §15
Q2. Whether `GetSecretValue` is a management or data event is not stated on
the pages read [AW8] — **unverified**.

**5.6 How the broker learns a value changed.** "A secret always has a version
labeled `AWSCURRENT`, and Secrets Manager returns that version by default"
[AW10]; `DescribeSecret.VersionIdsToStages` names the version holding it
[AW6]. At mint the broker records that version id in `slots[alias].version`
(provenance, not a value — a one-field addition to 04 §6) and on the next
`open_session` for the same `ref` compares; a difference marks earlier
sessions' alias `retired` (04 D61). In v1 nothing reaches a running session
sooner than the D121 lease. Later: the native `Secret Label Updated` event,
"enabled by default for all secrets and routed to the default EventBridge
event bus" [AW11] — in the customer's account, so delivery to us needs a rule
they create.

**5.7 What we never do.** Write, rotate, tag, or change policy (V2). The
console links out: the documented entry point is
`https://console.aws.amazon.com/secretsmanager/` [AW12]; a per-secret deep
link pattern is **unverified**, so the row shows the ARN.

**5.8 Failure modes.**

| Code | Message | Remedy |
| --- | --- | --- |
| `vault.aws.assume_denied` | We could not assume `{role_arn}`. | Check the trust policy names our role and the external id shown on this page. |
| `vault.aws.external_id_not_required` | `{role_arn}` can be assumed without the external id, so we have not saved it. | Add the `sts:ExternalId` condition to the trust policy, then connect again. |
| `vault.aws.tag_session_denied` | The role does not allow `sts:TagSession`. | Add the second statement from the checklist; without it sessions cannot be attributed to a person. |
| `vault.aws.duration_exceeds_max` | `{seconds}` s is longer than this role allows (chained sessions are capped at one hour). | Lower `duration_seconds` in the group, or raise the role's maximum session duration. |
| `vault.aws.describe_denied` | `{ref}` is named by a group but the role may not describe it. | Add `secretsmanager:DescribeSecret` for that ARN. |
| `vault.aws.secret_not_found` | `{ref}` does not exist in `{region}`. | Fix the reference in the group, or the region on this vault. |
| `vault.aws.scheduled_deletion` | `{ref}` is scheduled for deletion. | Restore it in AWS, or point the group elsewhere. |
| `vault.aws.throttled` | AWS is rate-limiting requests from our account. | Run again in a moment. |

**5.9 Customer checklist** (console renders; snippets copyable).

1. Create an IAM role with the trust policy above (we show our account id and
   the external id we generated).
2. Attach the permissions policy above with your secret prefix; tick *allow
   listing* to keep the `ListSecrets` statement — it lets the console show
   your secrets by name and nothing else.
3. If you want sessions longer than one hour and we assume the role in one
   hop, raise the role's maximum session duration (1–12 h) [AW13].
4. Paste the role ARN and region here. We test assumption with and without
   the external id and refuse to save the role if the second succeeds [AW2].

We need: role ARN, region, the external id (ours), optional secret prefix.

**5.10 Tests.** T4 `aws_probe_describe_only` (LocalStack Community; Secrets
Manager implements 22 of 23 operations and STS `AssumeRole` [LS1][LS2]);
T4 `aws_list_denied_degrades_honestly`; T3 `aws_resolve_tags_and_scopes_session`
(recorded fixtures, 04 §10); T4 `aws_external_id_required_or_refused` — trust
policy enforcement needs `ENFORCE_IAM=1`, Base/Ultimate plans only [LS3], so
it runs on recorded fixtures in CI and live where the licence exists; whether
LocalStack honours session tags is **unverified**.

## 6. Azure Key Vault

**6.1 Authenticating without a stored secret.** Workload identity federation:
the customer registers an application (or a user-assigned managed identity)
and adds a *federated identity credential* naming our `issuer`, our `subject`
and the audience `api://AzureADTokenExchange`; "the *issuer* and *subject*
values of the federated identity credential are checked against the `issuer`
and `subject` claims provided in the external token" [AZ2]. `api` then posts
the §4 token as `client_assertion` with
`client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
`grant_type=client_credentials`, `scope=https://vault.azure.net/.default`
[AZ3] and receives an access token whose "default lifetime is assigned a
random value ranging between 60-90 minutes" [AZ4].

```json
{ "name": "harness-<org>", "issuer": "https://<api-host>",
  "subject": "harness:org:<org_id>:vault:<vault_id>",
  "audiences": ["api://AzureADTokenExchange"] }
```

`az ad app federated-credential create --id <app-object-id> --parameters credential.json` [AZ2].

Authorisation is Azure RBAC on the vault's data plane. *Key Vault Secrets
User* has the two data actions `Microsoft.KeyVault/vaults/secrets/getSecret/action`
("Gets the value of a secret") and `…/secrets/readMetadata/action` ("List or
view the properties of a secret, but not its value") [AZ5]; *Key Vault
Reader* has `readMetadata` only [AZ5]. Both "only work for key vaults that
use the 'Azure role-based access control' permission model" [AZ6].

```
az role assignment create --role "Key Vault Secrets User" --assignee <app-client-id> \
  --scope /subscriptions/<sub>/resourcegroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault>
```

Assignment at the vault scope includes listing; assignment on individual
secrets is possible but discouraged by Microsoft [AZ6], and then listing the
vault needs *Key Vault Reader* at vault scope.

**6.2 List vs read.** Separated at the action level [AZ5]. `GET
{vault}/secrets` returns "only the base secret identifier and its
attributes" and needs `secrets/list` [AZ7]; `GET {vault}/secrets/{name}/versions`
returns identifiers and attributes, "no values are returned for the secrets",
and also needs `secrets/list` [AZ8]; `GET {vault}/secrets/{name}` returns the
value and needs `secrets/get` [AZ9].

**6.3 What is session-scoped.** The access token. Key Vault has no leases;
a secret has attributes `exp` and `nbf` but they are metadata on a static
value [AZ9]. `kind: "stored"`, `expires_at` = the token's expiry or the D121
lease. 04 §7.3's "`minted` only when the secret is a managed-identity token"
does not survive V4 and is amended by D120.

**6.4 Probe.** `GET {vault}/secrets/{ref}/versions?maxresults=1` — no value,
`secrets/list` [AZ8] → `ready` iff a version exists with
`attributes.enabled: true`, `evidence: "verified"`. Cost: it counts against
"all other transactions", 4,000 per 10 seconds per vault [AZ10], a budget
shared with the customer's own applications — the console probes a vault
page's secrets on demand, never the whole vault on the list view (D128).
`403` → *no role assignment*; `404` → *not found*; `429` → *throttled*; a
token exchange failure is vault-level. Note Microsoft's warning that a wrong
`subject` "is created successfully without error. The error does not become
apparent until the token exchange fails" [AZ2] — the connect flow performs
one exchange before saving.

**6.5 Attribution.** Diagnostic logs record, per request, `operationName`
(`SecretGet`, `SecretList`, `SecretListVersions`), `callerIpAddress` and
`identity` — "the identity from the token … usually a 'user', a 'service
principal'" — with `appid` and object id claims [AZ11]. The person and
session do not appear: Entra does not carry our extra claims through the
exchange, and per-person federation is capped at 20 credentials per app
[AZ2]. The customer's log shows our application; our `session.open` record
(04 §8) is the join to the person. Stated on the row.

**6.6 How the broker learns a value changed.** Every set creates a new
32-character version and "omitting the version" returns the latest [AZ12].
At mint the broker records the version segment of the returned `id`; poll on
the next mint as in §5.6. Later: Event Grid
`Microsoft.KeyVault.SecretNewVersionCreated` with `ObjectName` and `Version`
[AZ13], which needs a subscription the customer creates on their vault.

**6.7 What we never do.** `SecretSet`, `SecretUpdate`, `SecretDelete`, role
changes (V2). Link out: a portal deep-link pattern is **unverified**; the row
shows the documented object identifier
`https://<vault-name>.vault.azure.net/secrets/<name>` [AZ12].

**6.8 Failure modes.**

| Code | Message | Remedy |
| --- | --- | --- |
| `vault.azure.exchange_rejected` | Entra refused our token for `{client_id}`. | Check the federated credential's issuer and subject match this page exactly; Entra reports no error until exchange. |
| `vault.azure.access_policy_model` | `{vault}` uses legacy access policies, which our role assignment cannot cover. | Switch the vault to Azure RBAC, or add an access policy with `get` and `list` on secrets. |
| `vault.azure.forbidden` | `{client_id}` has no role on `{vault}`. | Assign *Key Vault Secrets User* at the vault scope. |
| `vault.azure.secret_not_found` | `{ref}` is not in `{vault}`. | Fix the reference in the group. |
| `vault.azure.secret_disabled` | The current version of `{ref}` is disabled. | Enable it in Azure, or point the group at another secret. |
| `vault.azure.throttled` | `{vault}` is rate-limiting; requests share the vault's 4,000-per-10-second budget. | Run again in a moment. |

**6.9 Customer checklist.**

1. Register an application (or create a user-assigned managed identity) in
   your tenant; note its client id and object id.
2. Add the federated credential above (`az ad app federated-credential create`).
3. Confirm the vault's permission model is Azure RBAC.
4. Assign *Key Vault Secrets User* at the vault scope (this includes listing).
   To limit us to named secrets, assign it per secret and add *Key Vault
   Reader* at the vault scope so the console can list names.
5. Paste tenant id, client id and the vault URI here; we perform one token
   exchange and one list before saving.

We need: tenant id, client id, vault URI (`https://<name>.vault.azure.net`).

**6.10 Tests.** There is no first-party emulator: Azurite "supports only the
Blob, Queue, and Table storage services" [AZ14]. T4 `azure_probe_lists_versions_only`
and `azure_forbidden_is_a_blocker` run against Lowkey Vault, a third-party
test double served at `https://localhost:8443` [LK1]; the federation
exchange is a recorded fixture, `azure_exchange_uses_client_assertion`.

## 7. HashiCorp Vault

**7.1 Authenticating without a stored secret.** The JWT auth method, not
AppRole (whose `secret_id` is a stored long-lived secret; D125 amends 04
§7.3). The customer enables it, points it at our issuer, and creates a role:

```
vault auth enable jwt
vault write auth/jwt/config oidc_discovery_url="https://<api-host>" bound_issuer="https://<api-host>"
vault policy write harness-read - <<'HCL'
path "secret/data/<prefix>/*"     { capabilities = ["read"] }
path "secret/metadata/<prefix>/*" { capabilities = ["read", "list"] }
# dynamic engines only:
path "database/creds/<role>"      { capabilities = ["read"] }
path "sys/leases/revoke"          { capabilities = ["update"] }
HCL
vault write auth/jwt/role/harness role_type="jwt" \
  bound_audiences="vault.<customer-id>.harness" bound_subject="harness:org:<org_id>:vault:<vault_id>" \
  user_claim="sub" claim_mappings="harness_person=person,harness_session=session,harness_group=group" \
  token_policies="harness-read" token_ttl="5m" token_max_ttl="10m" token_num_uses=4
```

Parameters as documented: `bound_audiences` "must match at least one
associated JWT claim"; `user_claim` "will be used as the name for the Identity
entity alias"; `claim_mappings` "a map of claims (keys) to be copied to
specified metadata fields"; `token_num_uses` "the maximum number of times a
generated token may be used" [HV1]. Login is `POST /auth/jwt/login` with
`role` and `jwt` [HV1]. Policies are deny by default; `list` "allows listing
values at the given path" and "the keys returned by a `list` operation are
*not* filtered by policies" [HV3] — so a list grant on `secret/metadata/<prefix>`
shows every name under the prefix, and the checklist says so. Whether
`update` on `sys/leases/revoke` alone suffices is **unverified** (§15 Q3).

**7.2 List vs read.** Separated by capability and by path: KV v2 reads go to
`secret/data/<path>` and listing to `secret/metadata/<path>` [HV4].

**7.3 What is session-scoped.** Two honest answers in one provider. KV v2 is
static — "the Key Value backend … does not issue leases although it will
sometimes return a lease duration" [HV5] — so a KV read is `kind: "stored"`,
`expires_at` = the D121 lease. Dynamic engines are genuinely session-scoped:
the database engine issues credentials on `database/creds/<role>` with a
lease from `default_ttl`/`max_ttl`, and "when leases expire, Vault
automatically revokes them, invalidating the secret" [HV5][HV7]. That read
is `kind: "minted"`, `expires_at` = `lease_duration`, and `revoke()` is
`PUT /sys/leases/revoke {lease_id}` [HV6]. Response wrapping
(`X-Vault-Wrap-TTL`, single-use token, `sys/wrapping/unwrap` [HV8]) protects
a value crossing an intermediary; `api` is the only consumer and reads
directly, so it is not used (D126) — 04 §7.3 amended.

**7.4 Probe.** Vault row: `GET /sys/health`, which returns 200 when
"initialized, unsealed, and active", 429 standby, 473 performance standby,
501 not initialised, 503 sealed [HV9]; 200/429/473 are *reachable*. Per
secret: `GET secret/metadata/<path>`, which returns `current_version` and
per-version `created_time`, `deletion_time`, `destroyed` and no value [HV4];
for a dynamic role, `LIST database/roles` (the permission this needs is
**unverified**; the checklist omits it until confirmed). Evidence
`verified`. `403` → *policy does not cover the path*; `404` → *not found*;
a `destroyed` current version → *destroyed*.

**7.5 Attribution.** "With a small set of exceptions, Vault audit devices
record all API requests and responses in detail", hashing sensitive strings
with HMAC-SHA256, and "if … Vault cannot log information to at least one of
the enabled devices, Vault refuses to service the corresponding API request"
[HV10]. Each entry's `auth` block carries `display_name`, `entity_id`,
`metadata`, `policies`, `token_type`; the `request` block carries
`operation`, `path`, `remote_address`, `client_id` [HV11]. Because
`claim_mappings` copies our `harness_person`/`harness_session` claims into
token metadata [HV1], the customer's audit log names the person and session
on every read — the strongest attribution of any provider here.

**7.6 How the broker learns a value changed.** KV v2 `current_version` is
recorded at mint and compared at the next mint (§5.6). Dynamic credentials
do not rotate; they expire. Later: consuming the customer's audit device
stream; whether an OSS event-notification path covers KV writes is
**unverified**.

**7.7 What we never do.** No `create`, `update`, `patch`, `delete` on any
secret path, no policy or auth writes (V2). Link out: a UI URL pattern is
**unverified**; the row shows mount and path.

**7.8 Failure modes.**

| Code | Message | Remedy |
| --- | --- | --- |
| `vault.hashicorp.sealed` | `{address}` is sealed or not initialised. | Unseal it; nothing can be read until then. |
| `vault.hashicorp.login_rejected` | Vault refused our token for role `{role}`. | Check `bound_audiences`, `bound_subject` and the issuer against this page. |
| `vault.hashicorp.permission_denied` | Policy `{policy}` does not cover `{path}`. | Add `read` on the data path (and `list` on metadata to allow the console to list). |
| `vault.hashicorp.not_found` | Nothing is at `{path}`. | Fix the path in the group; KV v2 paths are written without `data/`. |
| `vault.hashicorp.version_destroyed` | The current version of `{path}` is destroyed. | Write a new version in Vault, or point the group elsewhere. |
| `vault.hashicorp.lease_revoke_failed` | The lease for `{alias}` could not be revoked at close; it will expire on its own at `{expires_at}`. | Nothing to do unless it recurs; then check the policy allows `sys/leases/revoke`. |

**7.9 Customer checklist.**

1. `vault auth enable jwt` and configure it with our issuer (snippet above).
2. Write the `harness-read` policy for your prefix. `list` on `metadata/`
   lets the console show names under that prefix — all of them, not only
   the ones the policy can read.
3. Create the `harness` role with the audience and subject shown here.
4. For dynamic secrets, add the `creds/` path and `sys/leases/revoke`.
5. Paste the address, namespace (Enterprise), auth mount, role name and KV
   mount here; we log in once and list once before saving.

We need: address, namespace if any, auth mount path, role name, KV mount and
prefix, the audience string (ours).

**7.10 Tests.** A real dev server — `vault server -dev` is in-memory,
unsealed, on `127.0.0.1:8200`, with KV v2 at `secret/` [HV12] — per 10 rule
17. T4 `hashicorp_jwt_login_with_our_issuer` (the test serves a JWKS);
`hashicorp_kv_read_is_stored_with_lease`; `hashicorp_list_shows_unfiltered_names`;
`hashicorp_dynamic_creds_are_minted_and_revoked` (database engine against
the T4 scratch Postgres); `hashicorp_sealed_is_a_blocker`. The same suite
runs against an OpenBao dev server (§11).

## 8. Google Secret Manager

**8.1 Authenticating without a stored secret.** Workload identity federation:
"you can provide on-premises or multicloud workloads with access to Google
Cloud resources by using federated identities instead of a service account
key" [GC1]. The customer creates a pool and an OIDC provider, then grants a
role directly to the federated principal (no service account impersonation):

```
gcloud iam workload-identity-pools create harness --location=global
gcloud iam workload-identity-pools providers create-oidc harness-api --location=global \
  --workload-identity-pool=harness --issuer-uri="https://<api-host>" \
  --allowed-audiences="//iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/harness/providers/harness-api" \
  --attribute-mapping="google.subject=assertion.sub" \
  --attribute-condition="assertion.sub=='harness:org:<org_id>:vault:<vault_id>'"
gcloud secrets add-iam-policy-binding <secret> --project=<project> \
  --role=roles/secretmanager.secretAccessor \
  --member="principal://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/harness/subject/harness:org:<org_id>:vault:<vault_id>"
```

[GC3][GC1] (the pool and provider commands are quoted; the `add-iam-policy-binding`
form is composed from [GC2] and **unverified** as written). `api` exchanges the §4 token at `https://sts.googleapis.com/v1/token`
with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` [GC3]; the
federated token "defaults to one hour" [GC4].

**8.2 List vs read.** Separated. `roles/secretmanager.viewer` holds
`secretmanager.secrets.get`, `secrets.list`, `versions.get`, `versions.list`
and not `versions.access`; `roles/secretmanager.secretAccessor` "allows
accessing the payload of secrets" [GC2]. Listing is bought by *viewer* on
the project or a prefix-conditioned binding.

**8.3 What is session-scoped.** The token. Values are static versions:
`kind: "stored"`, `expires_at` = token expiry or the D121 lease.

**8.4 Probe.** `GetSecretVersion` on `versions/latest` — metadata with
`state` (`ENABLED`, `DISABLED`, `DESTROYED`) and no payload [GC5], under
*viewer*. Evidence `verified`. Quota: "Read request: 600 per minute per
project" against "Access request: 90,000 per minute per project" [GC6] — the
read quota is the customer's, shared with their own applications, so D128's
on-demand probing applies. `PERMISSION_DENIED` → *no viewer role*;
`NOT_FOUND` → *not found*; `state != ENABLED` → *disabled or destroyed*.

**8.5 Attribution.** `AccessSecretVersion` requires `DATA_READ` and generates
Data Access audit logs, which the customer must enable [GC7]; the caller
appears as `authenticationInfo.principalSubject`, "populated for both first
and third party identities", in the `principal://…/subject/<sub>` form
[GC8]. The person does not appear; the row says so.

**8.6 How the broker learns a value changed.** New versions get the next
number and `latest` moves [GC5]; the broker records the version name at mint
and compares at the next mint. Later: Pub/Sub topics, "up to 10" per secret,
publishing `SECRET_VERSION_ADD` and the rest; "Get, List, and Access calls
don't result in message publications" [GC9]. Topics are configured *on the
secret* by the customer — a write to their configuration we never make.

**8.7 What we never do.** `AddSecretVersion`, `Update`, `Disable`, `Destroy`
(V2). Link out: the documented console entry is
`https://console.cloud.google.com/security/secret-manager` [GC5]; a per-secret
pattern is **unverified**, so the row shows `projects/<p>/secrets/<name>`.

**8.8 Failure modes.**

| Code | Message | Remedy |
| --- | --- | --- |
| `vault.gcp.exchange_rejected` | Google refused our token for pool `{pool}`. | Check the provider's issuer, audience and attribute condition against this page. |
| `vault.gcp.permission_denied` | The federated principal has no `secretAccessor` on `{ref}`. | Add the binding from the checklist on the secret or project. |
| `vault.gcp.list_denied` | We may read the secrets named by groups but not list the project. | Grant `roles/secretmanager.viewer` to allow the console to show names. |
| `vault.gcp.not_found` | `{ref}` is not in project `{project}`. | Fix the reference in the group. |
| `vault.gcp.version_not_enabled` | The latest version of `{ref}` is `{state}`. | Enable it or add a version in Google Cloud. |
| `vault.gcp.quota` | Project `{project}` is out of Secret Manager read quota. | Run again in a minute; the 600-per-minute read quota is shared with your own applications. |

**8.9 Customer checklist.**

1. Create the pool and provider (snippet above) with the issuer, audience
   and subject shown here.
2. Bind `roles/secretmanager.secretAccessor` on each secret (or the project
   with a name condition) to the federated principal.
3. Optionally bind `roles/secretmanager.viewer` at the project so the
   console can list names — metadata only.
4. Enable Data Access logs for Secret Manager if you want reads in your
   audit log; they are off by default [GC7].
5. Paste the project number and secret prefix here; we exchange once and
   read one version's metadata before saving.

We need: project number, pool and provider ids, secret prefix.

**8.10 Tests.** No first-party emulator exists; two third-party emulators do
[GE1]. T4 `gcp_probe_reads_metadata_only` and `gcp_disabled_version_is_a_blocker`
run on recorded fixtures in CI; `gcp_exchange_uses_token_exchange_grant`
likewise.

## 9. 1Password (Service Accounts / Connect)

**9.1 Authentication — a stored secret, said plainly.** A service account
"isn't associated with an individual" and is used through
`OP_SERVICE_ACCOUNT_TOKEN` [OP1][OP2]; the token is created with an optional
`--expires-in <duration>` and "only shows … once" [OP2]. It is a bearer
token `api` must keep, encrypted under `HARNESS_MASTER_KEY` like a bundled
value. This is the one resolver that breaks V1, and the Key vaults row
states it (D127). Connect is the same shape self-hosted: a server plus
bearer access tokens, `Authorization: Bearer <access_token>` [OP3].
Permissions are per vault: `read_items`, `write_items`, `share_items` [OP2];
we ask for `read_items` only.

**9.2 List vs read.** At the API, yes: `GET /v1/vaults/{vault}/items`
"returns an array of Item objects that don't include sections and fields",
and the single-item `GET` returns the fields [OP3]. At the permission level
both are `read_items`; a list-only grant is **unverified** (none was found).

**9.3 What is session-scoped.** Nothing. `kind: "stored"`, `expires_at` = the
D121 lease.

**9.4 Probe.** List the vault's items filtered by title — no fields [OP3].
Cost: one read against hourly limits per token (Business 10,000 reads,
Teams/Families 1,000) and daily limits per account (Business 50,000, Teams
5,000, Families 1,000) [OP4] — D128 applies with force here. Evidence
`verified`. `401` → *token invalid or expired*; empty list → *item not found*.

**9.5 Attribution.** The Events API reports item usage — "when an item is
viewed, copied, or edited" [OP5]; whether it names the service account
that read the item is **unverified**. Business plan only [OP5]. The person
never appears.

**9.6 How the broker learns a value changed.** Poll on mint, comparing the
item's update timestamp from the list call; the exact field is
**unverified**.

**9.7 What we never do.** No item writes; `write_items` is never requested
(V2). Link out: no documented URL pattern — **unverified**; the row shows
vault and item title.

**9.8 Failure modes.**

| Code | Message | Remedy |
| --- | --- | --- |
| `vault.onepassword.token_invalid` | 1Password rejected the service account token. | Rotate the token in 1Password and paste the new one here. |
| `vault.onepassword.token_expired` | The service account token expired on `{date}`. | Create or rotate the token; you chose its expiry when you created it. |
| `vault.onepassword.vault_not_granted` | The service account cannot read vault `{vault}`. | Grant it *read items* on that vault. |
| `vault.onepassword.item_not_found` | No item titled `{ref}` in `{vault}`. | Fix the reference in the group. |
| `vault.onepassword.rate_limited` | The service account is out of reads for this hour or day. | Wait; limits depend on your plan [OP4]. |

**9.9 Customer checklist.**

1. Create a service account with *read items* on one vault and an expiry
   (`op service-account create harness --expires-in 720h …` [OP2]; the vault-permission flag syntax is **unverified**).
2. Paste the token here. We store it encrypted; this is the one vault type
   where we hold a long-lived credential, and the row will say so.
3. Name the vault and the item titles the groups will reference.

We need: the token, vault name, item titles and field labels.

**9.10 Tests.** No emulator; recorded fixtures: `onepassword_list_has_no_fields`,
`onepassword_token_is_stored_and_row_says_so`, `onepassword_rate_limit_is_a_blocker`.

## 10. CyberArk Conjur (brief)

CyberArk's documentation pages returned `404` to our fetcher on the day of
reading; what follows rests on the authenticator's design document in the
Conjur repository [CJ1] and on search summaries of the official pages [CJ2],
and is **unverified** until read directly.

- **Auth.** The JWT authenticator: a policy under `conjur/authn-jwt/<service-id>`
  declaring a `!webservice` and variables such as `provider-uri`/`jwks-uri`
  and `token-app-property`; a host is identified by a token claim and matched
  by annotations of the form `authn-jwt/<service-id>/<claim>: <value>`
  ("the annotation name should be found in the token claims 1st level only")
  [CJ1]. Login is `POST /authn-jwt/<service-id>/<account>/authenticate` and
  returns a short-lived Conjur access token [CJ1]. Our `harness_group` claim
  can therefore be an annotation the customer matches.
- **List vs read.** Separated: on a variable, `read` permits metadata and
  `execute` permits fetching the value — "just like read and execute bits on
  a filesystem" [CJ2].
- **Session-scoped.** The access token; values are static → `kind: "stored"`.
- **Probe.** Read the variable's metadata under `read` without `execute`.
- **Never.** No `update` privilege requested.
- **Codes.** `vault.conjur.authn_rejected`, `vault.conjur.not_permitted`,
  `vault.conjur.variable_not_found`.
- **Tests.** Conjur OSS runs as a container; T4 suite named
  `conjur_jwt_authn_and_execute` when the provider lands (Later).

## 11. The bundled vault

**11.1 Today.** PyNaCl `SecretBox`: XSalsa20-Poly1305, a 32-byte key
(`HARNESS_MASTER_KEY`) and a 24-byte nonce that "must **NEVER** be reused for
a particular key", generated at random by `encrypt()` when none is given
[PN1]. Ciphertext and nonce sit in `api_key_versions`; `probe` is an
`active` row; `resolve` decrypts → `kind: "stored"`, `expires_at: null`,
`evidence: "verified"` meaning *exists and decrypts* (04 §7.1, D67).
Rotation is a push: `api_keys.rotate` retires the alias in running sessions
(04 §5.6), the reason this vault alone needs no D121 lease. List and read
are both ours; the console shows every secret by name.

**11.2 Later: OpenBao behind the same interface.** OpenBao is MPL-2.0 [OB1]
and an OpenSSF sandbox project [OB2]; that it is a fork of HashiCorp Vault
is widely stated but was not on the pages read — **unverified**. It ships
the `jwt` auth method with `POST /v1/auth/jwt/login` [OB3], so `api`
authenticates to our own vault exactly as to a customer's (§7) and V1 holds
for the bundled vault too. The §7 test suite runs unchanged against it.

**11.3 Failure modes.**

| Code | Message | Remedy |
| --- | --- | --- |
| `vault.bundled.no_active_version` | `{ref}` has no active version. | Paste a key under Key vaults, or roll back the last rotation within its grace window. |
| `vault.bundled.decrypt_failed` | `{ref}` could not be decrypted with the current master key. | An operator checks `HARNESS_MASTER_KEY`; nothing is handed out until it decrypts. |
| `vault.bundled.grace_only` | Only a rotated-out version of `{ref}` remains. | Paste the new value; the old one can be restored within 24 hours. |

Tests: 04 §10 `bundled_probe_and_resolve`; add `bundled_nonce_never_reused`
(two encrypts of one plaintext differ) and `bundled_openbao_same_suite` later.

## 12. Comparison

| Provider | Auth without a stored secret | List/read separated | Session-scoped mint | Attribution on the customer's side | Rotation signal (v1 · Later) | What we hand the proxy | Can we confirm before launch (probe) | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AWS Secrets Manager | role trust + `ExternalId`; `AssumeRoleWithWebIdentity` when off-AWS | yes (`ListSecrets`/`DescribeSecret` vs `GetSecretValue`) | temporary keys only; value static | `RoleSessionName` on every CloudTrail entry; person tag on the `AssumeRole` event | poll `AWSCURRENT` version · `Secret Label Updated` | `stored`, leased | yes — `DescribeSecret`, verified | M6 |
| Azure Key Vault | workload identity federation → RBAC | yes (`readMetadata` vs `getSecret`) | access token only; value static | application identity only | poll version id · Event Grid `SecretNewVersionCreated` | `stored`, leased | yes — `GET …/versions`, verified | M6 |
| HashiCorp Vault | JWT auth method → policy | yes (`list` on `metadata/` vs `read` on `data/`) | KV v2 no; dynamic engines yes, with lease and revoke | token metadata in the audit device (person and session) | poll `current_version` · audit stream | KV: `stored`, leased · dynamic: `minted` | yes — `sys/health` + `GET metadata`, verified | M6 |
| Google Secret Manager | workload identity federation → IAM | yes (`viewer` vs `secretAccessor`) | access token only; value static | pool principal in Data Access logs (if enabled) | poll version · Pub/Sub on the secret | `stored`, leased | yes — `GetSecretVersion`, verified | Later |
| 1Password | **no** — service account token is stored by `api` | yes at the API; single `read_items` grant | no | service account only; unverified | poll item timestamp (unverified) · Events API | `stored`, leased | yes — item list, verified; costs quota | Later |
| CyberArk Conjur | JWT authenticator (unverified) | yes (`read` vs `execute`) | access token only | host identity | poll · — | `stored`, leased | yes — metadata `read` | Later |
| Bundled | n/a today; JWT to OpenBao Later | ours | no | our audit chain | push (04 §5.6) | `stored`, no lease | yes — active version, verified | M3 |

## 13. Sequencing

Aligned to `09`. **M3** lands the bundled resolver (§11.1) and nothing here
changes it. **M6** lands, in order, AWS (§5), then Azure (§6), then HashiCorp
(§7); each ships alone. Two items this document adds to M6's front:

1. **The OpenID issuer (§4)** gates Azure and HashiCorp, and AWS when `api`
   runs off-AWS. It is one module in `api` (discovery document, JWKS, signing,
   the five claims; ≈80 lines, added to 00 §8) with T4
   `issuer_discovery_and_jwks_round_trip`; it lands before the first federated resolver.
2. **04 amendments**: D120 (§7.2, §7.3), D125/D126 (§7.3), `slots[alias].version` (§6).

GCP, 1Password and Conjur are Later; their sections exist so the console's
*Connect a vault* list can say what each will and will not do before it can
be connected.

## 14. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D120 | `kind` follows 00 §4.6 literally: a static value is `stored` however it was fetched; `minted` only when the vault created the credential for this session. AWS, Azure, GCP, 1Password, Conjur, KV v2 and the bundled vault hand the proxy `stored`; only HashiCorp dynamic engines hand `minted`. Amends 04 §7.2's `resolve` bullet and §7.3's Azure line. | calling a value fetched with temporary keys `minted` — overstates what expires |
| D121 | A `stored` value from a customer vault carries `expires_at` = min(customer-side credential expiry, `group.mint.lease_seconds`, default 3600); the bundled vault's stays `null` because its rotation is a push. | `null` everywhere — then a value rotated away in the customer's vault is injected until the session ends |
| D122 | One OIDC subject per connected vault, `harness:org:<org>:vault:<vault>`; person, session and group travel as extra claims (Vault, Conjur) or session tags (AWS), never in `sub`. | per-person subjects — blocked by Entra's 20-credential cap and AWS's PII guidance |
| D123 | Rotation is learned by poll on mint: the provider's version identifier is recorded in `slots[alias].version` and compared at the next `open_session`; running sessions are bounded by D121. Provider events are Later. | events first — every one of them needs the customer to create a rule, subscription or topic |
| D124 | `vault.<provider>.*` codes live in `Probe.detail` and the connect flow; the mint-time blocker stays `broker.vault_unavailable` with the code in its message. | adding the codes to 00 §4.7 — one blocker per provider per failure, none actionable by the person |
| D125 | HashiCorp authentication is the JWT method against our issuer, not AppRole. | AppRole — its `secret_id` is a stored long-lived secret, contradicting V1 |
| D126 | No response wrapping: `api` is the sole consumer and reads directly. | wrapping — one more hop protecting a leg that does not exist |
| D127 | 1Password is connectable with its token held encrypted by `api`, and the Key vaults row states that this vault alone requires us to hold a long-lived credential. | refusing 1Password until it federates — loses the provider for no gain in honesty |
| D128 | Per-secret probes run on demand for the page in view, never for a whole vault on the list view; the vault row's *Connected* is one vault-level call. Provider read quotas (Azure 4,000/10 s per vault, GCP 600/min per project, 1Password per-hour and per-day) are the customer's and shared with their applications. | probing everything at every draw |
| D129 | At connect, AWS assumption is attempted without the external id; success refuses the save (`vault.aws.external_id_not_required`), as AWS's own guidance instructs. | trusting the pasted ARN |

## 15. Open questions

1. **Where does `api` run?** One hop (in our AWS account: up to 12 h
   sessions) or two (off-AWS via `AssumeRoleWithWebIdentity`: one hour cap).
   The checklist's step 3 depends on it.
2. **`SourceIdentity` for AWS.** It would put the person in every CloudTrail
   entry, not only the `AssumeRole` event; the trust-policy action it needs
   was not on the pages read.
3. **HashiCorp `sys/leases/revoke` capability.** Confirm `update` suffices
   for a lease the same token created; otherwise `revoke()` is best-effort
   only and the lease expires on its own.
4. **HashiCorp dynamic-role probe.** Which read on `database/roles/<role>`
   the policy must allow, and whether it is acceptable to the customer.
5. **1Password change detection field** and whether the Events API names the
   service account.
6. **Conjur** in full: the official pages were unreadable to our fetcher.
7. **`GetSecretValue` event class** in CloudTrail (management or data) —
   affects what the customer must enable to see reads.
8. **Console deep links** (AWS, Azure, Vault, GCP): none documented; rows show the provider's canonical identifier.

## 16. Sources

All read 25 September 2026.

| Tag | Document |
| --- | --- |
| AW1 | https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html |
| AW2 | https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html |
| AW3 | https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html |
| AW4 | https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_iam-permissions.html |
| AW5 | https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_ListSecrets.html |
| AW6 | https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DescribeSecret.html |
| AW7 | https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_limits.html |
| AW8 | https://docs.aws.amazon.com/secretsmanager/latest/userguide/cloudtrail_log_entries.html |
| AW9 | https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html |
| AW10 | https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html |
| AW11 | https://docs.aws.amazon.com/secretsmanager/latest/userguide/secret-event-notifications.html · https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring-eventbridge.html |
| AW12 | https://docs.aws.amazon.com/secretsmanager/latest/userguide/asm_access.html (search summary) |
| AW13 | https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_view-role-max-session.html · https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_revoke-sessions.html |
| AZ1 | https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation |
| AZ2 | https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust |
| AZ3 | https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow |
| AZ4 | https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes |
| AZ5 | https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/security |
| AZ6 | https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide |
| AZ7 | https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secrets/get-secrets |
| AZ8 | https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secret-versions/get-secret-versions |
| AZ9 | https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secret/get-secret |
| AZ10 | https://learn.microsoft.com/en-us/azure/key-vault/general/service-limits |
| AZ11 | https://learn.microsoft.com/en-us/azure/key-vault/general/logging |
| AZ12 | https://learn.microsoft.com/en-us/azure/key-vault/general/about-keys-secrets-certificates |
| AZ13 | https://learn.microsoft.com/en-us/azure/event-grid/event-schema-key-vault · https://learn.microsoft.com/en-us/azure/key-vault/general/event-grid-overview |
| AZ14 | https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite |
| LK1 | https://github.com/nagyesta/lowkey-vault (search summary) |
| HV1 | https://developer.hashicorp.com/vault/api-docs/auth/jwt · https://developer.hashicorp.com/vault/docs/auth/jwt |
| HV3 | https://developer.hashicorp.com/vault/docs/concepts/policies |
| HV4 | https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2 · https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2 |
| HV5 | https://developer.hashicorp.com/vault/docs/concepts/lease |
| HV6 | https://developer.hashicorp.com/vault/api-docs/system/leases |
| HV7 | https://developer.hashicorp.com/vault/docs/secrets/databases |
| HV8 | https://developer.hashicorp.com/vault/docs/concepts/response-wrapping |
| HV9 | https://developer.hashicorp.com/vault/api-docs/system/health |
| HV10 | https://developer.hashicorp.com/vault/docs/audit |
| HV11 | https://developer.hashicorp.com/vault/docs/audit/schema · https://developer.hashicorp.com/vault/docs/concepts/identity |
| HV12 | https://developer.hashicorp.com/vault/docs/concepts/dev-server |
| GC1 | https://docs.cloud.google.com/iam/docs/workload-identity-federation |
| GC2 | https://docs.cloud.google.com/secret-manager/docs/access-control |
| GC3 | https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers |
| GC4 | https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds |
| GC5 | https://docs.cloud.google.com/secret-manager/docs/managing-secret-versions |
| GC6 | https://docs.cloud.google.com/secret-manager/quotas |
| GC7 | https://docs.cloud.google.com/secret-manager/docs/audit-logging |
| GC8 | https://docs.cloud.google.com/logging/docs/reference/audit/auditlog/rest/Shared.Types/AuditLog |
| GC9 | https://docs.cloud.google.com/secret-manager/docs/event-notifications |
| GE1 | https://github.com/blackwell-systems/gcp-secret-manager-emulator · https://github.com/charlesgreen/gsm (search summary) |
| OP1 | https://www.1password.dev/service-accounts/ |
| OP2 | https://www.1password.dev/service-accounts/get-started · https://www.1password.dev/service-accounts/manage-service-accounts/ |
| OP3 | https://www.1password.dev/connect/api-reference · https://www.1password.dev/connect/ |
| OP4 | https://www.1password.dev/service-accounts/rate-limits/ |
| OP5 | https://www.1password.dev/events-api/ |
| CJ1 | https://github.com/cyberark/conjur/blob/master/design/authenticators/authn_jwt/authn_jwt_solution_design.md |
| CJ2 | https://docs.cyberark.com/conjur-open-source/latest/en/content/operations/services/cjr-authn-jwt.htm · https://docs.cyberark.com/conjur-open-source/latest/en/content/operations/policy/statement-ref-permit.htm (both `404` to our fetcher; search summaries only) |
| PN1 | https://pynacl.readthedocs.io/en/latest/secret/ |
| OB1 | https://github.com/openbao/openbao |
| OB2 | https://openbao.org/docs/ |
| OB3 | https://openbao.org/docs/auth/jwt/ |
| LS1 | https://docs.localstack.cloud/aws/services/secretsmanager/ |
| LS2 | https://docs.localstack.cloud/aws/services/sts/ |
| LS3 | https://docs.localstack.cloud/aws/capabilities/security-testing/iam-policy-enforcement/ |
