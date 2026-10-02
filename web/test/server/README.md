# `test/server/` — the scratch `api` harness

V3 runs against the real backbone: `definitions` + `api` over a scratch
Postgres seeded from the engine's fixtures, never a mock (02 rule 30, D22).
Two stack scripts live here, one per group of screens, so two people (or two
agents) can drive the console at once without sharing a port, a database or a
definitions repository.

| Stack | Screens | api | definitions | web | database |
| --- | --- | --- | --- | --- | --- |
| `stack-a.sh` | harnesses · harness · file · requests · sessions | 8411 | 8412 | 3011 | `harness_stack_a` |
| `stack-b.sh` | groups · boundaries · providers · vaults · assets · logs · people · teams · how · account | 8421 | 8422 | 3021 | `harness_cutover_dryrun` |

Neither collides with `npm run dev` (8400 · 8402 · 3000).

## Running one

```sh
bash web/test/server/stack-a.sh start     # definitions, api, next dev
bash web/test/server/stack-a.sh seed      # index + session/request records
bash web/test/server/stack-a.sh cookie    # prints the storage-state path
bash web/test/server/stack-a.sh sync      # re-copy app/ lib/ content/ after an edit
bash web/test/server/stack-a.sh stop
```

`start` copies `web/app`, `web/lib` and `web/content` into a second project
directory (Next 16 refuses a second `next dev` in one project), so **after
changing any of those, run `sync` (or `restart`) before you test or take a
screenshot** — otherwise the stack is still serving the previous tree.

`stack-b.sh` uses `up` · `down` · `sync` · `env`, and `env` prints its URL and
cookie for `eval`.

## Pointing Playwright at one

`playwright.config.ts`'s `screen` project reads two environment variables and
starts no web server when they are set, because the stack already owns one:

| Variable | Meaning | Default |
| --- | --- | --- |
| `STACK_URL` | the console's origin | `http://localhost:3000`, and `next dev` is booted |
| `STACK_STATE` | a Playwright storage-state file with the session cookie | none (unauthenticated) |

```sh
export STACK_URL=http://127.0.0.1:3011
export STACK_STATE="$(bash web/test/server/stack-a.sh cookie)"
npx playwright test --project=screen
```

Individual specs may still name their own stack — group A's read
`STACK_A_URL`/`STACK_A_STATE` and group B's `STACK_B_URL`/`STACK_B_COOKIE`
(`test/screen/stack-b.ts`) — which is how one `playwright test` run can be
pointed at one group's stack while the other group's spec files are filtered
out. Run **one group per stack**: the two seed different organizations, so
group B's specs against stack A's data fail on rows that are not there.

The authentication in both is a personal access token carried in the Supabase
session cookie: `api` accepts an `hpat_` bearer (`app/identity.py`) and
`lib/token.server.ts` hands `lib/api.ts` whatever the session holds, so the
credential is server-checked and nothing about it is trusted by the browser.
