# Console Plan — 08 · Platform panel (reserved)

An internal staff surface over every organization (`prd-v2.md` §12.2).
**Nothing here is built now.** This document exists so that the scope, the
role, the routes and the one write it needs are reserved in the types and
the authorisation model today, and so that building it later is screens on
an existing surface rather than a retrofit through every check.

## 1. What is reserved now, and where

| Reservation | Where | Built at |
| --- | --- | --- |
| `Scope.kind: "platform"` | 00 §4.1 | K-M0 (the type; the route 404s) |
| `Viewer.staff: boolean` — never an org role | 00 §4.1; `api` `identity.py` | K-M0 (always `false` until a staff table exists) |
| `/console/platform/…` route group, staff-only, otherwise not-found | 02 §1 | K-M0 (empty) |
| `/v1/platform/*` namespace in `api` | engine 00 §4.10 | reserved; no handlers |
| `platform.git` in `definitions`: assets and no policy | engine 02 | created at engine M2, empty |
| request subject `publish` | engine 00 §4.10 | type only |
| audit actions `platform.read`, `platform.publish`, written to **both** chains | 03 §6 | when the first handler lands |

## 2. What it will show

Every screen is the org console's screen at the `platform` scope, over the
index across organizations — the same components, the same columns, one
more column: *Organization*.

| Screen | Shows | Reads |
| --- | --- | --- |
| Organizations | every org: name, edition, people, teams, harnesses, sessions in the last 30 days, providers in use, vaults connected, created | `idx_*` counts per org + records |
| Organization | the org console's Harnesses, Providers, Key vaults, Sessions and Logs screens at that org's scope, read-only, with the staff banner *You are reading Acme as platform staff; this is recorded in Acme's log* | the org's own `/v1/console/*` reads with `?org=` and a staff token; every call audited in both chains |
| Providers across orgs | which harness providers and versions are in use where; which model providers | `idx_edges` provider rels grouped by org |
| Tools across orgs | assets by id in use where — *push this tool out* opens the publish flow | `idx_assets` grouped |
| Publish | choose assets from `platform.git`, choose organizations, write the reasoning → one `publish` request per organization; their admins accept or decline; the panel shows each request's state | `POST /v1/requests { subject: publish }` per org |
| Accounts | people across orgs: email, org, role, last active, deactivated; no content | records |
| Platform log | every staff read and publish, by whom, of which org | the platform chain |

## 3. What it will never do

- Write to a customer's branch. Publishing is a request the organization's
  admin decides; declined is a state, not a retry.
- Read a session's slots' `resolvedFrom` or any credential metadata beyond
  counts, or any file content, without an explicit support grant the org
  admin made — cross-company administration is `prd-v2.md` §24.3, still
  open, and this panel does not pre-empt it.
- Act as an org admin. `staff` is not a level in `role`; a staff member who
  is also a customer's admin has two hats and the console shows which one
  they are wearing.

## 4. Endpoints (reserved shapes)

```
GET  /v1/platform/orgs                          → OrgRow[]
GET  /v1/platform/orgs/{org}/…                  → the org's console reads, staff-audited
GET  /v1/platform/providers · /tools · /people  → grouped rows
POST /v1/requests { subject: { kind: "publish", from: { repo: "platform", ref, paths }, to: { org, ref } } }
GET  /v1/platform/log                            → LogRow[]
```

`OrgRow` and the grouped rows are defined when this is built; they are
`Related`-bearing rows like every other (00 §4.7).

## 5. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D80 | Reserve the scope, role, namespace, repo and request subject now; build no screen | building nothing now and retrofitting — touches every authorisation check |
| D81 | Publishing is a request into the organization, never a write | direct commit — breaks "the platform never writes to a customer's branch" |
| D82 | Staff reads are audited in both chains, always, including in development | audit only in production — loses the habit |

## 6. Definition of done (of the reservation)

`Scope` and `Viewer` carry the fields; `/console/platform` returns
not-found for non-staff and an empty shell for staff; `/v1/platform/*`
returns `404 platform.not_built` with the remedy naming this document;
`platform.git` exists and is empty; a T4 test proves a `publish` request
cannot be created by a non-staff principal.
