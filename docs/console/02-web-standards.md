# Console Plan — 02 · Web standards

How the console's code is written so that a screen is easy to find, easy to
change, tested against the backbone rather than a mock, and small. These are
rules, not preferences; a reviewer cites them by number. The tone and shape
follow [`../engine/10-code-standards.md`](../engine/10-code-standards.md);
this is its web counterpart. Types and endpoints are `00 §4`'s and are never
redeclared here.

The patterns these rules end, by name: two data paths (`lib/api.ts` through
the rewrite *and* `admin.tsx`'s `NEXT_PUBLIC_HARNESS_API_URL`); hash routing
with hand-rolled `pushState`; fixtures interleaved with rendering
(`org-preview/data.ts` imported by the component that draws it); one-file
applications (`admin.tsx`, 1,702 lines; `scope-app.tsx`, 1,893); components
with divergent props for one idea (`Head` in two files, `Card` in two files).

---

## 1. Purpose

A junior engineer opens a screen's directory and finds everything about that
screen and nothing else; opens `ui/` and finds one component per idea; opens
`lib/` and finds one way to talk to `api`. A PR is reviewable against a
numbered list. The console tests the engine, so its tests run against the
real `api` over a fixture index, never a mock of it.

---

## 2. Layout

1. **Directory layout is fixed.** Nothing lives outside it.

   ```
   web/
     app/
       (site)/                 the public site. Out of scope (00 D11). Shares tokens and BrandMark only.
       (auth)/login/           sign-in. Uses the same shell tokens, no console chrome.
       (console)/
         shell/                shell.tsx · shell.css · header.tsx · scope-switcher.tsx · search.tsx · account-menu.tsx · sidebar.tsx · nav.ts · screen.tsx (01 §4.2). Server components except search and the menu.
         ui/                   the component library (01 §7). One exported component per file.
         [scope]/              org · <dotted team path> · me (rule 4)
           layout.tsx          parses [scope] → Scope, fetches Viewer once, renders <ConsoleShell scope viewer>{children}</ConsoleShell>
           harnesses/          one directory per screen row in 00 §5
           harnesses/[id]/
           harnesses/[id]/files/[assetId]/
           harnesses/[id]/requests/[rid]/
           groups/ · groups/[name]/ · boundaries/ · providers/ · providers/model/ · providers/routing/
           vaults/ · vaults/[id]/ · assets/ · assets/[id]/
           logs/[category]/ · logs/sessions/ · logs/sessions/[id]/ · logs/endpoints/ (04 §14's tabs)
           logs/harness/ · sessions/ · sessions/[id]/    redirects onto those, nothing else in them
           people/ · people/[id]/ · teams/ · account/
         how/                  How this works (05). Scope-independent.
     lib/
       api.ts                  request<T>() — the one data path (rule 9)
       api.generated.ts        generated; never edited (rule 13)
       token.server.ts · token.client.ts   where the JWT comes from in each runtime (rule 6)
       scope.ts                parseScope(segments) → Scope; scopeHref(scope, path)
       scales.ts               consumes 05's registry; `tagHref(tag)`
       sentences.ts            LogRow.sentence and other plain-words builders (V1 tested)
       views/                  pure view-model helpers, one file per 00 §4 view type
     content/                  every explanatory string (05 §3). One file per screen + scales.ts + commands.ts
     test/
       fixtures/               → symlink to ../../engine/compose/fixtures (never copied)
       sessions/               derived session fixtures, generated in CI (00 §10)
       e2e/                    Playwright screen specs, one file per screen directory
       components/             Playwright component specs for ui/
       server/                 the scratch api harness (rule 30)
     openapi.json              committed snapshot of api's document (rule 13)
   ```

2. **What each directory may contain, one rule each.** `shell/`: layout only, no data fetching beyond `/v1/console/me`. `ui/`: no fetching, no routing, no `content/` imports except through props — a component is given its strings. `[scope]/<screen>/`: `page.tsx` (server), `loading.tsx`, `error.tsx`, `not-found.tsx` where the route can 404, and private parts prefixed `_` (`_compare-control.tsx`). `lib/`: no JSX. `content/`: no code beyond typed objects. `test/`: nothing imported by the app.

3. **Files are kebab-case; components are PascalCase; one exported component per file** — except a screen's `_private.tsx` parts, which may export several because they are that screen's and nobody else's. A `ui/` file that exports two components is two files. Hooks are `use-*.ts` and live beside their only consumer, or in `lib/` if they have two.

4. **Scope is the first segment** (00 D2). `parseScope(params)` — called by `[scope]/layout.tsx` and by every `page.tsx` that needs it — maps `org` → `{ kind: "org" }`; `team/<dotted-path>` → `{ kind: "team", path }`; `me` → `{ kind: "me" }`; anything else → `notFound()`. **No React context carries `Scope`**: screens are server components (rule 6) and context does not cross into them; scope and `?as` travel as props and params (01 §4.2). Every internal link is built with `scopeHref(scope, "/harnesses/…", { as })` — a hand-written `/console/` string in a component is a lint failure (rule 28).

5. **A screen is a directory that renders one 00 §5 row.** Its `page.tsx` does exactly three things: read `Scope` and search params, call one or more `00 §4.10` endpoints, and render components with the results. Logic belongs in `lib/views/` (tested at V1) or on the server (03). A `page.tsx` over 120 lines has logic in it.

## 3. Rendering

6. **Screens are server components; interaction is client.** `page.tsx`, `layout.tsx`, `shell/*` and every read-only table are server components. Anything with `useState`, an event handler, a form, a modal, the compare control, the narrowing form, or a `Disclosure` is a client component in its own file with `"use client"` on line 1. A server component never imports a client component's *state*; it passes props.

7. **The JWT reaches both runtimes from one cookie** (D20). The browser uses `@supabase/ssr`'s `createBrowserClient`; `middleware.ts` refreshes the session cookie on every console request; server components read it with `createServerClient(cookies())`. `lib/token.server.ts` and `lib/token.client.ts` each export `getToken(): Promise<string | null>` and nothing else; `lib/api.ts` imports neither — it receives the token (rule 9). `lib/supabase.ts` as it stands (a bare `createClient`) is deleted.

8. **Boundaries are per route segment, and the shell paints first.** Every screen directory has `loading.tsx` (skeleton rows in the content region only — the chrome is already there) and `error.tsx` (renders `ApiError` per rule 11; never a stack). A `<Suspense>` sits at the seam between a sub-sidebar and its content (a file list beside a file; a request list beside a request) so the list paints while the document loads. There is no top-level spinner; the shell is static.

## 4. Data

9. **One data path.** `lib/api.ts` exports exactly:

   ```ts
   export class ApiError extends Error { code: string; status: number; detail?: unknown; remedy?: string }
   export async function request<T>(path: `/v1/${string}`, token: string | null, init?: RequestInit): Promise<T>;
   export function list<T>(value: unknown): T[];
   ```

   In the browser `path` is fetched as-is through the `/v1` rewrite; on the server it is prefixed with `HARNESS_API_ORIGIN` (server-only; there is no `NEXT_PUBLIC_` origin). `request` is the only place `fetch` is called in `web/` outside `test/` (rule 20 enforces it). Two thin wrappers exist for convenience and nothing more: `serverRequest<T>(path)` = `request(path, await getToken())` from `token.server.ts`; `useRequest` does not exist — client components call `request(path, await getToken(), …)` inside an event handler, never on render.

10. **Every screen calls `00 §4.10` endpoints and nothing else.** A screen that needs data no endpoint provides adds the endpoint to 03 first. A screen never composes, never walks a chain, never derives a status the server did not (K2, P5).

11. **Errors map once, in `request`.** The envelope `{ code, message, detail, remedy? }` (`remedy` added by 03 D30) becomes `ApiError`. Then, at the boundary: `401` → `redirect("/login?next=<url>")`; `403` → the screen renders `<PermissionNotCleared decider={…} />` with the server's sentence (01 §7.12) in place of the decision, never a disabled button (P13); `404` → `notFound()`; `409` → the form shows `message` and `remedy` inline; anything else → `error.tsx` with `message` and `remedy`. No `catch` swallows an `ApiError`; no component invents a message the server did not send.

12. **Observed facts are fetched when the screen draws and stored nowhere** (K3, P2). A `Fact` with `provenance: "observed"` is never cached in `localStorage`, never memoised across navigations, and its cell shows `at`. Server components fetching observed data set `cache: "no-store"`.

## 5. Types

13. **Response types are generated, never written** (00 D3). CI starts `api`, fetches `/openapi.json`, writes `web/openapi.json`, runs `openapi-typescript` (a dev dependency) to `lib/api.generated.ts`, and fails if either file differs from what is committed — drift is a build failure, not a runtime surprise. Screens import response types as `paths["/v1/console/harnesses/{id}"]["get"]["responses"]["200"]["content"]["application/json"]`, aliased once per screen in `lib/views/<screen>.ts`. `lib/types.ts` is deleted at K-M2 with the last `admin.tsx` panel that reads it (00 §7); the pipeline lands at K-M0.

14. **Engine contract types come from `@harness/compose/contracts`** (the types-only subpath; there is no separate package) — a types-only build of `engine/compose` published in the workspace. `Chain`, `Slot`, `Blocker`, `PreflightReport`, `Boundary`, `HarnessDef`, `EndpointTally`, `Icon` and the rest are imported by name and never redeclared in `web/`. `00 §4` view types live in `lib/views/types.ts` as the one hand-written type file, and it may only *compose* generated and contract types.

15. **`any` and `as` are lint failures** except `as const` and the single `as T` inside `request`.

## 6. URL

16. **The URL is the state** (00 D2). Which scope, which screen, which harness, which version (`?version=mine|team|member:<id>|differences` — the last a client-side view over `mine` and `team`, 03 D32), which panel (`?view=files|history|requests`), which file, which filter (`?state=open`), which log category, which page (`?cursor=`) — all segments or search params. Back and forward work; a URL pasted into another browser shows the same screen to a person with the same rights. There is no hash routing.

17. **`?as=<user-id>` is carried, not stored.** A team admin reading a member's view sees every link on the page built with `?as` preserved (`scopeHref(scope, path, { as })`, `as` read from `searchParams` by the page and passed down); leaving the harness drops it. The shell shows the `?as` banner (04 §18) whenever it is set.

18. **A tag's link is a real URL:** `/console/how#<scale>` (K4). Nothing opens a legend in place.

19. **React state holds only what is not yet true:** an unsent form draft, an open modal, a collapsed section, the checked boxes of a narrowing form before *Create the grant*. `localStorage` holds per-viewer conveniences only — theme, sidebar collapsed — each read and write wrapped in `try/catch` with a default, never anything the server knows.

## 7. Forms and mutations

20. **Mutations are client `request()` calls followed by `router.refresh()`** (D21). No server actions (a second data path with its own error shape); no optimistic updates (the engine is the truth — the screen refetches and shows what is now so). A form component receives the endpoint's request type from `api.generated.ts` and submits exactly that shape.

21. **Every mutation failure renders the server's `message` and `remedy`** beside the control that caused it, in the server's words. A generic *Something went wrong* is a lint-visible string and a review failure.

22. **Destructive verbs confirm with what they take.** *Remove Jo Adeyemi* shows `RemovalPreview` (00 §4.9) before the button is enabled; *Take the team's* names the files it overwrites; *Revoke session* names the person and harness. The confirmation is the preview, not a second dialog saying *Are you sure?*

23. **Verbs the viewer lacks are not rendered disabled; the refusal is rendered** (P13). `RequestView.verbs`, `Viewer.role` and the server's `403` decide; the component never computes permission from role names itself.

## 8. Copy

24. **British spelling in every string the person reads** (organisation, colour, authorise, licence as noun). American in identifiers where the platform does (`color` tokens, `Authorization` header, `authorize` in an SDK call).

25. **Explanations are sentences; controls are verbs; headings are nouns.** *Accept all 3* · *Narrow to a sub-team* · *Take the team's* — the button says what happens. A heading says what the thing is (*Security groups*), never what to do with it. An explanation, when one is needed, is a full sentence with a subject.

26. **No exclamation marks. No invented numbers. No narration of the screen** (P8). Every string that explains a word or a scale lives in `content/` (05) and reaches the component as a prop; an explanatory sentence typed inline in a component is a review failure. Tooltips on buttons come from `content/<screen>.ts` too.

27. **Empty states name the verb that fills them** (*No harnesses yet — New harness*), and a filtered-empty state names the filter (*No open requests*). Never *Nothing to show*.

## 9. Tooling

28. **ESLint flat config, extended.** Today's `eslint-config-next` core-web-vitals and typescript configs stay. Added: the React Compiler rules Next 16 ships (`react-compiler/*` as errors — a component the compiler cannot memoise is rewritten, not exempted); `@typescript-eslint/consistent-type-imports`; `no-restricted-globals` on `fetch` outside `lib/api.ts` and `test/`; `no-restricted-imports` for `**/org-preview/**`, `**/team-preview/**`, `**/user-preview/**`, `../admin`, `@/lib/types`, and `process.env.NEXT_PUBLIC_HARNESS_API_URL`; `no-restricted-syntax` for a string literal matching `^/console/` in JSX (use `scopeHref`) and for `className` attributes over 120 characters (extract a component or a named class in `globals.css` under `@layer components`); a project rule `content/no-inline-copy` that fails on a JSX text node or string prop longer than one word outside `web/content/` (05 R8 owns its meaning); `no-restricted-syntax` on `window.confirm` (01 §7.10).

29. **`tsc --noEmit` and `next lint` run in CI on every PR and fail it.** `next build` runs too, so a server/client boundary mistake is caught before merge. No Prettier configuration beyond the repository's; formatting is not reviewed by people.

## 10. Tests

30. **Four tiers, real backbone** (00 §10; D22). V1: vitest over `lib/` — every `lib/views/*` and `lib/sentences.ts` function has a test file beside it. V2: Playwright component tests over `ui/` — every component's states (01 §9) and, for `ScaleTag`, every registered value renders and links (01 §13). V3: Playwright screen specs against **the real `api` on a scratch Postgres seeded from `test/fixtures` and `test/sessions`** — `test/server/` starts `definitions` + `api` with the engine's conformance fixtures pushed into a fresh org, exactly as engine T4 does; there is no MSW and no mocked `api`, because a console that passes against a mock proves nothing about the backbone it exists to test. V4: the engine's CI runners run one real `harness run pi` and a Playwright spec asserts it appears in `/sessions` with slots, preflight and endpoints within one supervise tick.

31. **Every screen owns V3 tests by name:** one per row it is named in `06`'s observability table, plus `renders_for_every_scope` and `refuses_as_for_member`. A screen PR without its named tests is not reviewable.

32. **Coverage is not a metric.** Named tests are. A test that asserts a component "renders" without asserting a fact from the fixture is deleted.

## 11. Accessibility

33. **Keyboard first.** Every interactive element is reachable in DOM order; tables move row to row with arrow keys and open a row with Enter (01 §7.7 `Table`); modals trap focus and close on Escape; the sidebar drawer below 960px is a `<dialog>`.

34. **Focus is visible** with the `accent` token outline, never removed. Icon-only buttons carry `aria-label` with the verb. A `ScaleTag` carries its scale and value in text — colour is never the only carrier (K4). `prefers-reduced-motion` disables every transition in `globals.css` with one media query.

35. **Landmarks:** the shell renders `<header>`, `<nav aria-label="Console">`, `<main>`; a sub-sidebar is `<aside aria-label>`; a page has exactly one `<h1>`, in its sub-header.

## 12. Review

36. **Budgets (00 §9).** A screen directory over 350 source lines is two screens: split by `?view` into `_files.tsx`, `_history.tsx`, `_requests.tsx` — each under the ceiling, each with its own V3 spec — or the PR says in one sentence why not.

37. **A screen PR deletes what it replaces** (00 §7, D10): the prototype route or panel and the `admin.tsx` panel for the same screen, with their fixtures moved to `test/` if the V3 spec needs them and deleted otherwise. Rule 28's import ban makes a half-deletion a build failure.

38. **The PR checklist**, answered in the description:
   - [ ] Which 00 §5 row is this, and which K/P constraints does it touch?
   - [ ] Which 00 §4 types does it render, and which 03 endpoints does it call — and do both already exist?
   - [ ] Which named V1/V2/V3 tests were added, and which 06 row do they prove?
   - [ ] Which `content/` entries were added, and is any explanatory string inline?
   - [ ] What did it delete (rule 37)?
   - [ ] Is every string British, every button a verb, every tag a registered scale?
   - [ ] Is the directory under its ceiling, or is the sentence there?

---

## 13. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D20 | **`@supabase/ssr` with a cookie session**, refreshed in `middleware.ts`, read by `token.server.ts`/`token.client.ts`; `lib/supabase.ts` deleted. | keeping the browser-only client and making every screen a client component — rejected: the shell would flash and every screen would be a bundle |
| D21 | **Mutations are client `request()` + `router.refresh()`**; no server actions; no optimistic updates. | server actions — a second data path with a second error shape |
| D22 | **V3 runs the real `api` on a scratch Postgres seeded from the engine's fixtures**; no MSW. | a mocked api — tests a mock, not the backbone |
| D23 | **`HARNESS_API_ORIGIN` is server-only**; the browser only ever uses the `/v1` rewrite. `NEXT_PUBLIC_HARNESS_API_URL` deleted. | a public origin — a second path and a CORS surface |
| D24 | **`openapi.json` and `api.generated.ts` are committed and CI-checked**, not generated at build on the developer's machine. | generating at build — a developer's build can pass on a stale api |
| D25 | **`className` over 120 characters is a lint failure** — extract a component or an `@layer components` class. | a formatter that wraps — hides the smell |
| D26 | **Tables are keyboard-navigable row by row** as a component contract, not per screen. | per-screen handlers — divergence |
| D27 | **`error.tsx` renders `message` + `remedy` and nothing else**; stacks go to the console log in development only. | — |

---

## 14. Out of scope

Visual design, tokens, and component props (01). Endpoint shapes and DB
conventions (03). What each screen shows (04). The strings themselves (05).
The public site's stack (00 D11). A design-system package published outside
this repository. Storybook — V2 component specs are the catalogue.

---

## 15. Definition of done

- The directory layout in rule 1 exists with every `[scope]` screen directory
  present (empty screens render `loading.tsx`'s skeleton until they land),
  and rule 28's lint config fails on each banned pattern (a test per rule:
  `lint_fails_on_fetch_outside_api`, `lint_fails_on_prototype_import`,
  `lint_fails_on_hardcoded_console_href`, `lint_fails_on_long_classname`).
- `lib/api.ts` is the only `fetch` in `web/` outside `test/`; `serverRequest`
  works in a server component with the cookie session and `request` works in
  a client handler with the browser session (`jwt_reaches_server_component`,
  `jwt_reaches_client_handler`).
- `web/openapi.json` and `lib/api.generated.ts` are committed; CI fails on
  drift (`generated_types_match_api`); `lib/types.ts`, `lib/supabase.ts` and
  `NEXT_PUBLIC_HARNESS_API_URL` are gone.
- `test/server/` starts `definitions` + `api` on a scratch Postgres seeded
  from the symlinked fixtures and a V3 spec passes against it in CI
  (`fixture_api_serves_console_me`).
- `parseScope` and `scopeHref` have V1 tests for all three scopes and the
  not-found case; `?as` is preserved by `scopeHref` (`as_is_carried`).
- `tsc --noEmit`, `next lint`, `next build`, vitest and Playwright all run in
  CI on every PR and each failure blocks merge.
