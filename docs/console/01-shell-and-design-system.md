# Console Plan — 01 · Shell and design system

The shell every console screen renders inside, the tokens every component
draws with, the component library every screen is built from, and the rules
that keep all three small. Written so that a junior engineer can build the
shell and the library without a design review: measurements, props, states
and tests are all here. The visual idiom is the one already in
`web/app/globals.css` and `web/app/ui.tsx`; this document does not restyle
it, it finishes it.

## 1. Purpose

Three things are true after this document is built:

1. **One shell.** Header, sidebar and content column exist once, in
   `app/(console)/shell/`, and the content column is the only element on the
   page that scrolls (K5). The three copies of the chrome in `admin.tsx`,
   `preview.tsx` and `scope-app.tsx` are gone.
2. **One library.** Every visual idea has one component in
   `app/(console)/ui/`, one file, one named `Props` interface. The three diff
   renderers, three inline segmented controls, five inline nav items and two
   `Head`/`Card`/`Detail` pairs (00 §7) collapse into one each (K6).
3. **One vocabulary of size.** Type, spacing, radius and shadow are tokens;
   the sixteen arbitrary font sizes and five bespoke shadows become seven and
   three. Changing the console's body size is one line.

## 2. Invariants

| From 00 | Here |
| --- | --- |
| K1 three surfaces, one application | the shell takes `Scope`; screens take `Scope`; nothing else varies |
| K4 every tag is a value on a named scale and links to its scale | `ScaleTag` is the only badge, and it is a link (§8) |
| K5 chrome never scrolls | §4.1 grid; test `shell_only_content_scrolls` |
| K6 one component per idea | the inventory in §7 is exhaustive; a PR adding a look-alike fails review (§12) |
| P3 a scale is a column; one word one meaning | `Table` renders scale columns with `ScaleTag`; the word comes from the registry |
| P4 relationships are columns with a named unit | `Related` (§7.3) |
| P8 explain the vocabulary, not the screen | `Word`, `HelpMark`, `Button.explain`; no component takes prose |
| P13 refusing plainly beats a disabled button | `PermissionNotCleared`; `Button` has no `disabled` for permission — only for in-flight |
| D4 two themes | §10 |
| D5 fixed grid, one scroll container | §4 |
| D12 sans in the console | §6 |
| D13 tokens are the source of truth | §5 |

## 3. Contracts used

From 00 §4 by name: `Scope`, `Viewer` (with `waiting`), `NavKey`, `Fact`,
`Provenance`, `ScaleTag`, `ScaleId`, `ScaleRegistry`, `Tone`, `Related`,
`Column<Row>`, `DiffHunk`, `Hidden`. From `engine/00 §4`: `Blocker`, `Icon`.

`Column<Row>` (00 §4.2) is the table contract: `kind` decides the renderer
(`text` · `number` · `time` · `scale` → `ScaleTag` · `related` → `Related` ·
`fact` → `FactCell`), `unit`/`scale` are required by kind, `help` is the
`(?)` text, `sort` and `width` are the only layout hints. `Table` (§7.7)
consumes it and nothing else; a screen may select columns from an object's
spec (03 §10) and never redefine one.

## 4. The shell

### 4.1 The grid

```css
/* app/(console)/shell/shell.css — the only place these numbers exist */
.shell {
  display: grid;
  grid-template-rows: 56px 1fr;
  grid-template-columns: 144px minmax(0, 1fr);  /* the rail, §4.4 */
  height: 100dvh;
  overflow: hidden;                        /* the page never scrolls */
  background: var(--color-canvas);
  color: var(--color-fg);
}
.shell > header  { grid-column: 1 / -1; }  /* never scrolls */
.shell > nav     { overflow-y: auto; overscroll-behavior: contain; }   /* D60: internal only */
.shell > main    { overflow: auto; overscroll-behavior: contain; min-width: 0; }  /* THE scroll container */

/* inside main: what a screen may add */
.screen           { display: grid; grid-template-rows: auto 1fr; min-height: 100%; }
.screen > .sub    { position: sticky; top: 0; z-index: 2; background: var(--color-canvas); }   /* sub-header */
.screen > .body   { display: grid; grid-template-columns: minmax(0, 1fr); }
.screen > .body.with-aside { grid-template-columns: 280px minmax(0, 1fr); }          /* aside at the start: a file list */
.screen > .body.with-aside-end { grid-template-columns: minmax(0, 1fr) 320px; }      /* aside at the end: reference lists, a discussion */
.screen > .body > aside {                 /* sub-sidebar: sticks under the sub-header, never scrolls the page */
  position: sticky; top: var(--sub-h, 0px);
  max-height: calc(100dvh - 56px - var(--sub-h, 0px));
  overflow-y: auto; overscroll-behavior: contain;
}

@media (max-width: 959px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .shell > nav { display: none; }         /* becomes the drawer <dialog> */
  .screen > .body.with-aside, .screen > .body.with-aside-end { grid-template-columns: minmax(0, 1fr); }
  .screen > .body > aside { position: static; max-height: none; }   /* stacks above (start) or below (end) the content */
}
```

Rules the sketch encodes:

- **Exactly one page-level scroll container: `main`.** `header` never
  scrolls. `nav` (the sidebar) may scroll *internally* — it is chrome with
  bounded content (≤ 20 items) and on a 600px-tall window the alternative is
  hidden navigation; this is the one exception and it is `overflow-y` on the
  nav element itself, never the page (D60).
- A screen's **sub-header** is `position: sticky; top: 0` *inside* `main`'s
  scroll. It sets `--sub-h` to its own height (a `ResizeObserver` in
  `Screen`, 6 lines) so the sub-sidebar can stick below it.
- A screen's **sub-sidebar** is a second grid column inside the body,
  sticky under the sub-header, `max-height`-bound and internally scrollable.
  It is never a second page-level scroll container; the test asserts that
  `document.scrollingElement.scrollHeight === clientHeight` on every screen.
- **Breakpoints:** ≥ 1280 full; 960–1279 sidebar 220px; < 960 the sidebar is
  a `<dialog>` drawer opened from a header button and the sub-sidebar stacks
  above the content. Nothing else changes per breakpoint — no hidden
  columns; a table scrolls horizontally inside its own wrapper (§7.7).

### 4.2 Component tree

```
<ConsoleShell scope viewer>                       app/(console)/shell/shell.tsx   (server component)
  <Header scope viewer>                            header.tsx
    <BrandMark />                                  ui/brand-mark.tsx (server-safe, §7.14)
    <ScopeSwitcher scope viewer />                 scope-switcher.tsx  — the level tree (§4.3)
    <SearchButton />                               search.tsx          — opens <Palette> (client)
    <AccountMenu viewer />                         account-menu.tsx    — click toggle, role="menu"
  <Sidebar scope viewer>                           sidebar.tsx         — groups from navFor(scope, viewer)
  <main id="content">{children}</main>
<Screen bar={<SubHeader …/>} aside={…} asideSide="start"|"end">     screen.tsx — used by every screen inside main; a file list sits at the start, reference lists and a request's discussion at the end (04)
```

Props are exactly `scope: Scope` and `viewer: Viewer`; the shell fetches
`Viewer` once in the `(console)/[scope]/layout.tsx` server component and
passes it down. No context provider: two props, three consumers.

`Viewer` carries **`adminHere: boolean`** — whether the viewer administers
*the scope this answer was computed for*. It is `ctx.admin_here` on
`/v1/console/me`, so the endpoint is called **with the scope**
(`loadViewer(scope)` in `lib/views/viewer.ts`, `?scope=` on the wire); a
viewer fetched with no scope is computed for *me*, where it is always true,
and the sidebar would show every screen to everyone (D83). `loadViewer` is
`cache()`d on the scope's query spelling, not on the `Scope` object, because
`cache()` compares arguments by identity and each `parseScope` returns a
fresh one. A scope the viewer may not open answers `403` at the layout, which
renders the shell at *me* with the server's sentence in place of the screen
(02 rule 11).

### 4.3 Header, in order

One line, `flex-nowrap`, in two groups: **where you are** on the left and
**what you can do** on the right.

| Side | Slot | Contents | Behaviour |
| --- | --- | --- | --- |
| left | Drawer | hamburger, `< 960` only | opens the sidebar as a `<dialog>` (§4.1) |
| left | Breadcrumb | `BrandMark` (small) + *Harness*, a muted `›`, then the screen's name — *Harness › Assets* | *Harness* links to `/console/me/harnesses`. The screen's name is its nav label (`navKeyOf(pathname)` into `NAV_LABELS`, *How this works* for `/console/how`, `shell/section.tsx`) and is the document's one `<h1>` (02 rule 35, D99): the page's name belongs to the chrome, because it is the sidebar row you pressed. A detail screen shows its **section** — *Harnesses*, not the harness — and names the thing it is showing in its own content (`EntityHeader`, §7.5). A route under no nav key renders neither the chevron nor the name. The name truncates; nothing wraps |
| right | Level switcher | the current level as a button: *You* · *Marketing* · *Organisation* | a menu that is a **tree** (D84): *You*, then each of `viewer.teams` with its sub-teams indented under it (a team path is dotted, so depth is the path's depth below the shallowest team on the chain), then *Organisation* last; the current row is marked with §4.4's selected idiom and `aria-current`. Choosing navigates to the same screen at the new level where it exists, else that level's `/harnesses`. It is the console's **only** level control — no screen carries one. It sits on the right with the other controls, because changing level is something you *do*, not somewhere you *are* |
| right | Search | icon button, `/` focuses it | opens the **Palette** (D61): a `<dialog>` with one input; results are objects in the viewer's current scope by name — harnesses, files, groups, boundaries, people, requests — plus the command sheet's rows; Enter opens the first; arrow keys move; results come from one endpoint `/v1/console/search?q=` (00 §4.10 addition, reported) |
| right | Account | avatar/initials button | click toggles a `role="menu"`; items: *Account*, *Theme* (steel/light), *Sign out*; arrow keys and Escape |

### 4.4 Sidebar

**The rail is 144px**, one width at every size above the drawer breakpoint
(§4.1). It was 248, stepping to 220 below 1280; a column of at most eleven
short nouns does not need a third of the screen at 1280, and the width it
gives back is a table column. A row that no longer fits — *Security
groups*, *How this works* — truncates with an ellipsis and carries its own
words as a `title`; it never wraps to two lines, and the group eyebrows
stay. The drawer breakpoint stays at 960: the rail got narrower, so the
width at which the content runs out did not move.

Groups and items come from one function, `navFor(scope, viewer): NavGroup[]`
in `shell/nav.ts`, and nothing else decides what is in the sidebar:

**The sidebar shows what you manage** (D83). Everyone on a level sees what
that level holds for them; the screens that hand out other people's
permissions belong to whoever administers it, and a row that can only refuse
is worse than no row (P13):

| Scope | Everyone on it | Only if `adminHere` |
| --- | --- | --- |
| me | Harnesses, Assets, Logs, Account | — |
| team | Harnesses, Assets, Logs, People | Security groups, Boundaries, Providers, Teams |
| org | Harnesses, Assets, Logs, People | Security groups, Boundaries, Providers, Key vaults, Teams |
| personal, at any level | Harnesses, Assets, Boundaries, Logs, Account | — |

A personal account is one person who is their own organisation (07 §2):
there are no teams and no permissions to hand out, but reach is theirs to
set, so Boundaries stays. As groups:

| Group | Items (`NavKey`) | Who |
| --- | --- | --- |
| Assets | `harnesses` · `assets` | everyone on the level |
| Permissions | `groups` · `boundaries` · `providers` · `vaults` | `adminHere`; `vaults` at the organisation only; personal: `boundaries` alone |
| Logs | `logs` | everyone on the level |
| People | `people` · `teams` · `account` | `people` at a team or the organisation, `teams` with `adminHere`, `account` at *me* |
| — | `how` | all, pinned at the bottom |

`sessions` and `endpoints` are no longer rows: they are tabs of Logs
(04 §14), and `navKeyOf` reads every route under `/logs` — and the old
`/sessions` — as the one Logs row. A group heading that would only repeat
its single row's word is not drawn.

Each item renders `label`, an optional count from `viewer.waiting[key]`
(work waiting: open requests on *harnesses*, role requests on *people*,
unresolved conflicts on *harnesses* for `me`), and `aria-current="page"`
when the route's first segment after `[scope]` matches. **One selected
idiom:** `bg-accent-soft text-accent-text` on the item, nothing else
(`accent-text` is the D69 alias — `accent` in steel, `accent-deep` in light);
the switcher's current row uses the same pair. The
sidebar is a `<nav aria-label="Console">` of `<a>` elements — not tabs, not
buttons. No *Prototype* footnote, no brand in the sidebar (the header has
it).

### 4.5 Keyboard

Native tab order is the primary path: header left→right, sidebar top→bottom,
then the content column. Three shortcuts and no more (D61): `/` focuses
search from anywhere but an input, `Escape` closes the topmost dialog or
palette, `?` opens a small dialog listing these three. No `g`-chords: they
add a mode and save nothing a palette does not.

## 5. Tokens

`globals.css` keeps every colour token exactly as it is (they are correct and
already used everywhere), plus one alias for accent-as-text (D69). This
document **adds** the non-colour scales it lacks, in the same `@theme`
block, and deletes the two themes D4 retires.

```css
@theme {
  /* type — seven sizes, each with its line height; the console's body is `base` */
  --text-2xs: 10px; --text-2xs--line-height: 14px;  /* eyebrow, table heading */
  --text-xs:  11px; --text-xs--line-height:  16px;  /* labels, mono values, hints */
  --text-sm:  12px; --text-sm--line-height:  18px;  /* dense secondary */
  --text-base: 13px; --text-base--line-height: 20px;/* body, table cells, buttons */
  --text-md:  14px; --text-md--line-height:  22px;  /* leads, dialog copy */
  --text-lg:  17px; --text-lg--line-height:  24px;  /* section titles */
  --text-xl:  22px; --text-xl--line-height:  28px;  /* page titles */
  --text-2xl: 26px; --text-2xl--line-height: 32px;  /* the one hero size: sign-in */

  --tracking-label:   0.09em;   /* field labels */
  --tracking-eyebrow: 0.11em;   /* section labels, table headings */

  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px; --radius-full: 9999px;

  /* the one colour addition: accent as *text*. steel: the accent; light: accent-deep (D69, §10). */
  --color-accent-text: var(--color-accent);

  --shadow-card:    0 1px 0 0 var(--color-hairline);                       /* a card is an edge, not a lift */
  --shadow-overlay: 0 8px 24px -8px rgb(0 0 0 / 0.45);                      /* menus, palette */
  --shadow-modal:   0 16px 64px rgb(0 0 0 / 0.55);                          /* dialogs */
}
```

**Spacing** is Tailwind v4's default 4px scale (`--spacing: 0.25rem`); no
redefinition. The rule is a *restriction*: the console uses steps
`1 2 3 4 5 6 8 10 12 16` only (4px to 64px). `p-7`, `gap-9`, `mt-14` do not
appear in `app/(console)/`.

**Migration rule** (enforced by 02's lint): inside `app/(console)/` no
arbitrary value for size, radius, shadow or spacing — `text-[13px]`,
`shadow-[…]`, `rounded-[…]`, `p-[…]`, `gap-[…]`, `w-[9rem]` all fail. The
survey's histogram maps as: `[13px]`→`text-base`, `[11px]`→`text-xs`,
`[10px]`→`text-2xs`, `[12px]`→`text-sm`, `[14px]`→`text-md`, `[17px]`→
`text-lg`, `[22px]`/`[26px]`/`[27px]`→`text-xl`/`text-2xl`; `[9px]`,
`[11.5px]`, `[15px]`, `[16px]`, `[19px]` have no home and round to the
nearest. Column widths use `Column.width` (§7.7), not a class.

## 6. Typography

- **Sans (`--font-sans`, Manrope) everywhere in the console** (D12): titles,
  body, buttons, table cells. The serif is the marketing site's and does not
  appear under `app/(console)/`.
- **Mono (`--font-mono`, DM Mono)** for exactly: ids, refs and commits,
  commands, paths, aliases, env-var names, timestamps in `Mono`, and tag text
  inside `ScaleTag`/`Chip`. Never for prose.
- **The eyebrow style** — `text-2xs font-bold uppercase tracking-eyebrow
  text-muted` — is reserved for `SectionLabel` and table headings. Field
  labels use `text-xs font-bold uppercase tracking-label text-muted`. Nothing
  else is uppercase.
- Weights: 400 body, 500 emphasis in running text, 600 buttons and row
  names, 700 labels and titles. No 800.
- Titles: page `text-xl font-bold tracking-[-0.02em]` — the one tracking
  literal permitted, defined once in `EntityHeader`; section `text-lg
  font-semibold`.

## 7. The component library — `app/(console)/ui/`

One file per component, one named export, props as `interface XProps`.
Ceiling 1,400 source lines (00 §9); the inventory below sums to ≈ 1,290 with
the per-component sizes given, which is the budget and the check.

| Component | Props (abridged) | Contract | ≈ LOC | Seed |
| --- | --- | --- | --- | --- |
| `Button` | `variant: primary\|default\|ghost\|danger` · `size: md\|sm\|icon` · `explain?` · `busy?` · `href?` | the verb; `explain` renders as a tooltip; `busy` disables with a spinner-free label change; `href` renders an `<a>` styled identically | 50 | `ui.tsx` |
| `Field` · `Select` · `Checkbox` · `Textarea` | `label` · `hint?` · `error?` · control attrs | one `CONTROL` class; error text tied by `aria-describedby` | 90 | `ui.tsx` |
| `ScaleTag` | `scale: ScaleId` · `value: string` | **the only badge**; tone, meaning and href from the registry (§8) | 40 | `Badge` |
| `Chip` | `children` · `title?` | bordered mono value | 12 | `ui.tsx` |
| `Mono` | `children` · `title?` | unbordered mono value | 8 | `ui.tsx` |
| `Dot` | `tone` · `glow?` | an 8px status point; never alone — beside a word | 20 | `ui.tsx` |
| `Related` | `Related` | linked values with unit; `all` → *All teams* | 30 | `preview.tsx` `RelLinks` |
| `FactCell` | `fact: Fact<ReactNode>` | value + a provenance mark (`declared` none · `observed` a dot with `at` on hover · `derived` a dotted underline) | 30 | new |
| `Table` | `columns: Column<Row>[]` · `rows` · `rowHref` · `sort?` · `empty` | §7.7 | 140 | `ui.tsx` |
| `EntityHeader` | `name` · `trail?` · `mark?` · `facts?` | a detail screen's first block of **content**: the object, its trail and its two-by-three grid (PRD §17.1) | 65 | `scope-app` `Head` |
| `SubHeader` | `tabs?` · `count?` · `readme?` · `level?` · `search?` · `actions?` · `tabsLabel?` | a screen's one header, one line: tabs, count, readme mark, level chip, search, verbs — and the only sticky element a screen adds | 180 | the four `_tabs.tsx` + `Toolbar` |
| `Readme` | `title` · `body` | the bar's `(?)` and the *About …* `Modal` behind it (§7.5) | 50 | the old `lede` |
| `SectionLabel` | `children` | the eyebrow | 6 | `Eyebrow` |
| `Card` | `title?` · `actions?` · `children` | a surface with an edge (`shadow-card`); no title bar when `title` is absent | 25 | both prototypes' `Card` |
| `Line` | `name` · `note?` · `tags?: ScaleTag[]` · `aside?` · `href?` | the list row: name, one-line note, tags, an aside; a link when `href` | 40 | `scope-app` `Line` |
| `KeyValue` | `items: Array<{k, v}>` | `<dl>` of dt/dd pairs, two columns ≥ 960 | 25 | `scope-app` `Detail` |
| `Tally` | `added` · `removed` | `+n −m` in ok/warn | 12 | `scope-app` |
| `Diff` | `hunks: DiffHunk[]` | **the one diff renderer**; added lines `bg-ok-soft text-ok`, removed `bg-warn-soft text-warn`, colour on the whole line (PRD §17.3); gutters mono | 60 | three renderers → one |
| `Compare` | `left: {label, children}` · `right: {label, children}` · `notice?` | two columns ≥ 960, stacked below; the `notice` slot is where *stale* lives | 35 | `asset-conflict` `ReadPane` |
| `Segmented` | `options: {id, label}[]` · `value` · `onChange` · `label` | `role="radiogroup"`; the compare control and Files/History/Requests | 40 | inline ×3 |
| `Trail` | `items: {label, href?}[]` | breadcrumb `<nav aria-label="Breadcrumb">` | 20 | `preview.tsx` |
| `Modal` | `title` · `onClose` · `children` · `size?` | native `<dialog>` via `showModal()`; focus trap and restore for free; Escape; backdrop click closes | 60 | `ui.tsx` |
| `Confirm` | `title` · `takes: ReactNode` · `verb` · `onConfirm` | a `Modal` for destructive verbs that lists what the action takes with it (PRD §18); the verb is the primary button | 40 | `window.confirm` ×2 |
| `Notice` | `tone` · `children` | an inline note with a `Dot` | 15 | `ui.tsx` |
| `BlockerCard` | `blocker: Blocker` · `showCode?` | message · remedy · link button (05 §11 owns the words) | 30 | new |
| `PermissionNotCleared` | `decider: string` · `ask?: {label, href}` | the sentence naming who decides, and the one verb the viewer has (P13) | 25 | `scope-app` `NotCleared` |
| `HiddenView` | `view: keyof Hidden` · `note: string` | replaces a whole block with the hiding note from `content/empty.ts` `HIDDEN` (P10); never a shorter list | 12 | `scope-app` `Visibility` |
| `CommandSheet` | `open` · `onClose` · `highlight?: string` | a `Modal` rendering the shared sheet (05 §6): one `CommandBlock` per row, grouped as the sheet is (P14) | 30 | `scope-app` `CommandSheet` |
| `EmptyState` | `sentence` · `verb?: {label, onClick\|href}` | one sentence, optional adding verb (P7) | 15 | `ui.tsx` |
| `Skeleton` | `rows` · `columns` | grey bars matching a table's shape; never text | 20 | new |
| `ErrorBoundary` | `children` | per route segment (`error.tsx`): server `message` + `remedy` + *Try again* | 35 | new |
| `Word` | `term: keyof Words` · `children?` | 05's hover term: dotted underline, `aria-describedby`, keyboard-openable | 40 | new |
| `HelpMark` | `text` | the `(?)` on a column heading: a `Word` without a term | 15 | `preview.tsx` `Head` |
| `CommandBlock` | `label` · `command` · `hint?` | copy button; the copied state lasts 1.6 s | 35 | `ui.tsx` |
| `Disclosure` | `summary` · `children` | `<details>` with the rotating caret | 15 | `ui.tsx` |
| `PixelArt` | `icon` · `size` | SVG rect per pixel | 35 | kept |
| `PixelEditor` | `value` · `onChange` | pointer events + keyboard paint (§11) | 110 | kept, upgraded |
| `Icon` | `name: IconName` · `size?` | ≤ 12 inline SVGs (D63) | 60 | new |
| `BrandMark` | `small?` | server-safe: no hooks, no `"use client"` | 10 | moved |

Removed, deliberately: `Alert` (→ `Notice tone="warn"`), `KindTag` (kind
is a `Chip` of the kind word — a kind is not a scale), `TagGrid` (an
inventory is a `Table`), `Json` (a `Disclosure` around a `<pre>` where the
console shows raw JSON to admins), `Eyebrow` (→ `SectionLabel`),
`HeaderSearch` (→ the Palette), `Tr`/`Td` (private to `Table`), and — since
D99 — `Toolbar` (→ `SubHeader`'s `count` and `actions`).

### 7.1 `Button`

Four variants, no more: `primary` (the one accent fill, one per screen
region), `default`, `ghost` (border only), `danger` (warn border; used only
inside `Confirm` and for *Revoke*/*Remove*). Sizes `md` (32px tall), `sm`
(26px), `icon` (28px square, `aria-label` required). `explain` renders a
tooltip on hover and focus; it is the *only* way a button explains itself
(P8). There is no `disabled` for lack of permission — the button is absent
and `PermissionNotCleared` says why; `busy` is the only disabled state and
it swaps the label (*Accepting…*), never a spinner.

### 7.2 `ScaleTag`

```ts
interface ScaleTagProps { scale: ScaleId; value: string; size?: "md" | "sm" }
```

Renders `<a href={registry[scale].href}>` containing the value in mono
uppercase, toned from the registry entry (`accent` tone paints text with
`accent-text`, D69). It is the only component that
draws a coloured pill. See §8 for the lookup and the unregistered rule.

### 7.3 `Related`

`unit` becomes the heading (the column's), never repeated in the cell. Items
render as comma-separated links, truncated to four with *+n more* opening a
popover listing all; `all: true` renders *All teams* (or the unit's plural)
as plain text.

### 7.4 `FactCell`

Wraps any rendered value. `declared` adds nothing; `observed` adds a small
`Dot tone="accent"` after the value with `title="Checked just now · <at>"`
and, on hover/focus, the same text in a tooltip; `derived` renders the value
with a dotted underline and `title="Derived"`. This is how P2 stays visible
without a legend.

### 7.5 `SubHeader`, `Readme` and `EntityHeader`

**A screen has one header, and it is a bar** (D99). There is no page-title
row: the page's name is the section in the top bar (§4.3), so what sits
above a screen's table is `SubHeader` and nothing else — one line, at every
width.

Left to right: the screen's `tabs` — links, the current one underlined in
the accent and carrying `aria-current="page"`, `{ id, label, href, current,
group?, count? }` rows the screen builds; two sets parted by a rule where a
screen has two, which is the harness page's versions and its views — then
flexible space, then, on the right and in this order, the `count`
(*3 harnesses*) in muted mono, the `readme` mark, the `level` chip, the
`search`, and the screen's `actions`. Below the bar the screen is
immediately its table or its grid.

**The underline is on the word, not on the link.** The link carries no
horizontal padding and the rule is a `border-b-2` on the label's own span,
so it is exactly as wide as the label and centred under it; a tab's count
sits outside that span and never drags the rule to the right. The strip's
content box is the bar's `px-6`, which is every screen block's gutter, so
the first tab's word begins where the table below it begins.

`flex-nowrap`: nothing wraps and nothing stacks. When the tabs do not fit,
the tab strip scrolls horizontally (`overflow-x-auto`, `no-scrollbar`) and
the right-hand group stays where it is — a header that grows a second row
pushes the first row of the table under it, which is the thing the person
came for.

`level` is the chip (`LevelChip`, `ui/level-chip.tsx`): `{Level} · you can
edit here` when `Viewer.adminHere` and always at *me*, otherwise
`{Level} · read and use`, where the level's word is the team's name or
*You* / *Organisation* and never a dotted path. Every screen inside
`[scope]` passes one (`levelOf(scope, viewer)` in `lib/views/level.ts`,
which builds the sentence from `content/shell.ts` so the component is given
its strings); the scope-independent *How this works* does not (D84).

`search` is an icon button that expands into the field on click, stays open
while it has a value, and collapses on Escape when it is empty; it writes
one search param onto the screen's own URL and keeps every other one (02
rule 16). Its own words — *Search*, *Close search* — are the shell's
(`content/shell.ts`); the placeholder is the screen's. `lib/views/header.ts`
builds the `readme` and `search` props (`readmeOf`, `searchIn`) so no `ui/`
component imports `content/` (02 rule 2).

**`Readme` is the `(?)` and the modal behind it.** `HelpMark`'s idiom — the
console's one mark for *there is an explanation here* — on the bar rather
than on a column heading, opening a `Modal` titled *About {name}* whose body
is the screen's lede and whatever further paragraphs its content module
carries (`ScreenContent.about`, 05). No screen prints a lede. A screen with
nothing to say passes no `readme` and the bar has no mark.

**`EntityHeader` is content, not a header.** A detail screen's first block:
`trail`, `mark` (the harness's drawing), `name` as an `h2`, and `facts` —
the two-by-three grid beside it (PRD §17.1), dropping under the name below
960. It scrolls with the page, because a harness's six facts are read once.
The harness page composes it in `harnesses/[id]/_header.tsx`.

`shell/screen.tsx` takes the bar as `bar` and has no `header` slot;
`.screen > .sub` in `shell.css` is the bar's row and the only one that
sticks.

### 7.6 `Line`

The list row for everything that is not a table: a person, a team, a
boundary, a request in a list. `name` (600 weight), `note` (muted, one
line), `tags` (each a `ScaleTag`), `aside` (a button or a `Mono`), and
`href` making the whole row an `<a>`. Rows separate with `hairline`.

### 7.7 `Table`

```ts
interface TableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string;      // P1: a row is a link; when absent rows are inert
  sort?: { key: string; dir: "asc" | "desc" };  // controlled by the screen via the URL (02 §6); `key` is `Column.key`
  onSort?: (key: string) => void;
  empty: string;                       // the sentence from content/empty.ts
  dense?: boolean;
}
```

Semantics: a real `<table>`; `<th scope="col">` with the heading and, when
`help` is set, a `HelpMark`; sortable headings are buttons with
`aria-sort`. **Keyboard:** the table body is a roving-tabindex grid — arrow
up/down moves the focused row, Enter or Space activates `rowHref`, Home/End
jump. **Row as link:** the first cell holds the `<a>` and the row's click
target is expanded with a pseudo-element, so the row is one link, not a
`div` with `onClick`. Empty cells render `—`. Numbers align end. A table
wider than its column scrolls horizontally inside its own wrapper — the
page never does. Loading is a `Skeleton` with the same `columns.length`.
No column widths in classes: `Column.width`. Renderers are chosen by `Column.kind`, never passed in.

### 7.8 `Diff` and `Compare`

`Diff` takes `DiffHunk[]` only. Two screens that have two texts and no
hunks use `Compare` side by side; the console never diffs on the client
(`lib/diff.ts` is deleted — D66). `Compare` renders two labelled columns
and a `notice` slot between the label row and the columns; *stale* and
*conflict* are `Notice`s in that slot, never a badge on the file.

### 7.9 `Segmented`

`role="radiogroup"`, each option `role="radio"` with `aria-checked`; arrow
keys move, Space selects. It is the in-page choice that is not an address —
the Providers tab's *By provider · By team* read switch, and the forms'
either/or. The harness page's compare control (*Your version · Team version ·
Jo Adeyemi's · Differences*) and its panel switch (*Files · History ·
Requests*) were `Segmented` until D99; both wrote the URL and nothing else,
so both are now `SubHeader` tabs and both are links.

### 7.10 `Modal` and `Confirm`

`Modal` is a native `<dialog>` opened with `showModal()`: the browser traps
focus, restores it on close, and handles Escape; `aria-labelledby` points at
the title. `size` is `md` (540px) or `lg` (760px, the request detail on
small screens). `Confirm` composes it: title, `takes` (a list of what the
action takes with it, e.g. the removal preview), a `danger` verb button and
*Cancel*. `window.confirm` is banned by 02's lint.

### 7.11 `Word` and `HelpMark`

`Word` wraps a term with a dotted underline; hover or focus shows the short
sentence from `content/words.ts` in a tooltip (`role="tooltip"`,
`aria-describedby`), Escape dismisses, and it is never nested inside another
`Word`. `HelpMark` is the same mechanism with the text passed directly, used
only on column headings and `KeyValue` keys.

Both, and `Button.explain`, are one hook — `ui/use-tip` — so the three cannot
drift. It returns `tip.anchor`, spread onto the trigger (including the `ref`
it measures from), and `tip.element`, **the bubble already rendered**: a
portal, not props to spread (D94). The bubble is therefore never a child of
the trigger's cell, and no `overflow` ancestor can clip it.

### 7.12 `BlockerCard` and `PermissionNotCleared`

`BlockerCard` renders `blocker.message` as the sentence, `blocker.remedy`
as the action line, and `blocker.link` as a `default` button; `code` appears
in a `Mono` only when `showCode` (admins). `PermissionNotCleared` renders
one sentence — *Accepting a request publishes it to everyone on Marketing,
so a team admin decides it.* — and, when the viewer has one, the single verb
they do have (*Withdraw*, or *Ask to be a Marketing admin*).

### 7.13 `PixelArt` and `PixelEditor`

Kept as the cleanest unit in the tree. The editor moves from mouse events to
**pointer events** (`onPointerDown` + `setPointerCapture`, `onPointerMove`),
so touch and pen paint; and gains **keyboard painting**: the grid is a
roving-tabindex of cells, arrows move, Space paints with the selected
swatch, `1`–`9`/`0` pick swatches. `aria-label` per cell is *row r, column
c, colour*.

### 7.14 `Icon` and `BrandMark`

`Icon` is one file of inline SVG paths, at most twelve names (D63): `search`,
`menu`, `close`, `chevron`, `check`, `copy`, `external`, `plus`, `minus`,
`git`, `warning`, `info`. No icon library. `BrandMark` moves to
`ui/brand-mark.tsx` with no hooks and no `"use client"`, so the public
site's server components stop pulling a client boundary for a masked PNG.

## 8. Scale rendering

`ScaleTag` looks up `registry[scale]` (the `ScaleRegistry` from
`content/scales.ts`, 05 §4) and finds the entry for `value`: its `tone`
paints the pill, its `meaning` is the tooltip, and `registry[scale].href`
is the link — every tag on the console is a link to *How this works* at its
scale's anchor (K4). Tone is never a prop.

**Unregistered values** (D64): in development `ScaleTag` throws
(`Unregistered value "x" for scale "approval"`), so a new server value is
caught on the first render; in production it renders the raw value in
`neutral` tone with `title="Not yet explained"` and logs once. Justification:
a thrown error in production would blank a screen over a label, and a
`warn`-toned pill would lie about severity; neutral-with-a-title is honest
and visible.

## 9. States

| State | Rendering | Never |
| --- | --- | --- |
| Loading | `Skeleton` with the table's `columns.length` (or three bars for a card); the shell paints first via a `Suspense` boundary at the `Screen` body | a spinner; the text *Loading…* |
| Empty | `EmptyState` with the sentence from `content/empty.ts` and the adding verb when the viewer has it (P7) | an empty table with headings |
| Error | route-segment `ErrorBoundary`: the server's `message` and `remedy`, a *Try again* button | a stack trace; a toast |
| Forbidden | `PermissionNotCleared` in place of the verb or the panel (P13) | a disabled button; a hidden panel |
| Hidden view | `HiddenView` with the note from `content/empty.ts` `HIDDEN` (05 §8) in place of the whole block (P10) | a shorter list; silence |
| Index behind | a `Notice tone="hold"` under the header — *The index is behind the repository since {since}; nothing to do* — whenever a response carries `stale` (03 §4) | refusing the read; hiding the banner |
| Stale | a `Notice tone="hold"` in `Compare`'s notice slot | a badge on the row |
| Busy | `Button busy` with the label swapped | optimistic UI of any kind |

## 10. Themes

Two (D4): `steel` (default, dark) and `light`. `jade` and `leather` are
removed from `globals.css` and `lib/theme.ts`; `THEME_IDS` becomes
`["steel", "light"]`; `THEME_BOOT` simplifies to: public path → `light`,
else the stored theme or `steel`. **One definition of a public path**,
exported from `lib/theme.ts` and used by both the boot script and
`<PublicTheme>` — `/`, `/login`, `/request`, `/privacy`, `/terms` — which
closes the flash on the three legal/request pages. The console's theme is
per viewer in `localStorage` (try/catch), switched from the account menu.
Every token in §5 and in `globals.css` has a value under both themes; the
V2 test `every_token_defined_in_both_themes` diffs the two custom-property
sets.

**Contrast, text on `surface`** (approximate ratios; the V2 test
`contrast_meets_aa` computes them exactly from the CSS):

| Pair | steel | light | Rule |
| --- | --- | --- | --- |
| `fg` / `surface` | ≈ 13 : 1 | ≈ 15 : 1 | body |
| `muted` / `surface` | ≈ 5.6 : 1 | ≈ 5.1 : 1 | secondary text, AA |
| `faint` / `surface` | ≈ 3.5 : 1 | ≈ 3.0 : 1 | **below AA for text** — `faint` never carries information a reader needs; it is for hints that repeat what is already visible (a count beside a heading, a hash beside a message) |
| `accent` / `surface` | ≈ 5.6 : 1 | ≈ 2.9 : 1 | **light theme: accent as *text* fails** — link, nav and tag text use the alias `--color-accent-text`, which is `accent` under `steel` and `accent-deep` (≈ 4.9 : 1) under `light` (§5, D69); `accent` remains the fill colour with `ink` text |
| `ok` / `ok-soft` · `hold` / `hold-soft` · `warn` / `warn-soft` | ≈ 6.5 · 7 · 5.9 | ≈ 5+ each | tag text on tag fill, AA |

Colour is never the only carrier of meaning: a `ScaleTag` always shows its
word, a `Dot` always sits beside one, and `Diff` marks lines with `+`/`−`
as well as fill.

## 11. Accessibility

The baseline 02 enforces, made concrete per component:

| Component | Requirement |
| --- | --- |
| Shell | `header`, `nav aria-label="Console"`, `main id="content"`; a skip link *Skip to content* as the first focusable; landmarks unique |
| Sidebar | `<a aria-current="page">`; not `role="tab"` (there is no tabpanel); the drawer is a `<dialog>` with focus trapped |
| `Table` | `<table>`, `<th scope="col">`, `aria-sort`; roving tabindex on rows; Enter/Space activates; the row link has a visible focus ring |
| `Segmented` | `role="radiogroup"` + `aria-label`; arrows move, Space selects |
| `Modal`/`Confirm` | native `<dialog>`: trap, restore, Escape; `aria-labelledby`; the first field focused on open |
| `Word`/`HelpMark`/`Button.explain` | `aria-describedby` to a `role="tooltip"`; opens on focus as well as hover; Escape closes; never `title=` alone; **and the bubble is always wholly on screen** — see below |
| `AccountMenu` | button `aria-haspopup="menu"` `aria-expanded`; `role="menu"` with `role="menuitem"`; arrows, Home/End, Escape; click to open (never hover-only) |
| `Field` et al. | `<label>` wrapping; `error` tied by `aria-describedby` and `aria-invalid` |
| `PixelEditor` | keyboard paint (§7.13); per-cell `aria-label`; a text alternative for the drawing (`icon.alt` from the harness description) |
| `Diff` | each line's `+`/`−` is real text (visually mono in the gutter), not a pseudo-element |
| Motion | transitions ≤ 150 ms opacity only; `prefers-reduced-motion` removes them |
| Focus | `outline: 2px solid var(--color-accent); outline-offset: 2px` on every focusable; never `outline: none` without a replacement |
| Targets | ≥ 32px on every interactive element (`icon` buttons are 28px visual inside a 32px hit area) |

**Where the tooltip goes (D94).** Help a reader cannot read is not help, so
the one bubble has one placement rule, in `ui/use-tip`:

- It is a **portal**, appended to `document.body` — or to the `<dialog>` the
  trigger is inside, because a modal is in the top layer and a bubble at the
  body would sit behind its backdrop. Nothing it is nested in can clip it,
  which is what `Table`'s `overflow-x-auto` wrapper did to every `(?)`.
- It is `position: fixed`, placed from the trigger's bounding rect: **below
  and left-aligned** by default; **flipped above** when there is no room
  below and there is room above; **right-aligned** when left-aligning would
  cross the viewport's right edge; and clamped so it is never closer than
  **8px** to any edge. 8px is also the gap between bubble and trigger.
- Up to **20rem** wide (`max-w-xs`) and wrapping, so a long sentence is a
  paragraph and not a line off the screen.
- It is placed again while open on **scroll** (listened for in the capture
  phase, so a scroll inside an `overflow` ancestor counts) and on **resize**.
  The two offsets are written onto the node, not held in state, so a scroll
  does not re-render the screen behind it.
- There is **no bubble on the server and none on the first client render**:
  the hook returns `null` until the trigger's node exists. `createPortal`
  needs a document, and markup the server did not emit would break
  hydration.

## 12. Review checklist — a component PR

- [ ] Is there already a component for this idea in §7? Then this is a change to it, not a new file.
- [ ] One file, one named export, one `interface XProps`; no default export.
- [ ] Every size, radius, shadow and space is a token; no arbitrary values (02's lint passes).
- [ ] Any colour is a token, and it means what the token means (`warn` is a warning, not "orange").
- [ ] Does it take prose as a prop? Then it explains the screen, not the vocabulary — remove it (P8).
- [ ] Does it render a tag? Then it is `ScaleTag` or it is wrong.
- [ ] Does it disable for permission? Then it is wrong (P13).
- [ ] Keyboard: reachable, operable, visible focus, Escape where it opens something.
- [ ] Both themes rendered in the component test.
- [ ] The library is still under 1,400 lines, or the PR says why.

## 13. Tests (V2, Playwright component mode)

| Test | Asserts |
| --- | --- |
| `shell_only_content_scrolls` | at 1440, 1024 and 800 widths, with a 4,000px-tall screen body: `document.scrollingElement.scrollHeight === clientHeight`; `main.scrollHeight > main.clientHeight`; header `getBoundingClientRect().top === 0` after scrolling `main` |
| `shell_sub_header_sticks_under_header` | after scrolling `main`, the sub-header's top equals `main`'s top |
| `shell_drawer_traps_focus` | below 960, opening the drawer traps Tab inside it and Escape restores focus to the button |
| `scale_tag_renders_every_registered_value` | for every `ScaleId` and value in the registry, a tag renders with that word and the entry's tone |
| `scale_tag_links_to_how` | every rendered tag's `href` is `/console/how#<scale>` |
| `scale_tag_unregistered_throws_in_dev` | `NODE_ENV=development` render throws; production renders neutral with the title |
| `table_keyboard_row_navigation` | ArrowDown moves focus row by row; Enter navigates to `rowHref`; Home/End jump |
| `table_empty_cells_render_dash` | a `null` cell renders `—` |
| `modal_traps_and_restores_focus` | Tab cycles inside; Escape closes and focus returns to the opener |
| `confirm_lists_what_it_takes` | `takes` items are in the dialog before the verb is enabled |
| `segmented_is_a_radiogroup` | roles and arrow-key behaviour |
| `word_opens_on_focus` | Tab to a `Word` shows the tooltip; Escape hides it |
| `account_menu_is_a_menu` | roles, arrow keys, click toggle, Escape |
| `pixel_editor_paints_by_keyboard` | Space on a focused cell sets its palette index |
| `button_explain_is_a_tooltip` | hover and focus both show `explain` |
| `no_arbitrary_font_sizes_in_console` | grep of `app/(console)/` for `text-\[`, `shadow-\[`, `rounded-\[`, `(p\|m\|gap\|w\|h)-\[` returns nothing |
| `every_token_defined_in_both_themes` | the set of `--color-*`, `--text-*`, `--radius-*`, `--shadow-*` names is identical under `steel` and `light` |
| `contrast_meets_aa` | computed ratios for the pairs in §10 meet the stated thresholds in both themes |
| `only_ui_imports_in_screens` | no file under `app/(console)/[scope]/` imports from `app/ui.tsx`, `app/org-preview/`, or another screen's directory |

## 14. Decisions

| # | Decision | Why | Reverse by |
| --- | --- | --- | --- |
| D60 | The sidebar may scroll internally; the header never; `main` is the page's one scroll container | chrome with bounded content on a short window must not hide navigation; one exception, stated | making the sidebar `overflow: hidden` and truncating |
| D61 | Three shortcuts (`/`, `Escape`, `?`); the Palette searches objects by name in the current scope plus the command sheet, from one endpoint | a palette makes `g`-chords redundant; fewer modes | adding chords |
| D62 | Playwright component mode replaces Storybook | one test runner, one fixture source, no second dev server | adding Storybook |
| D63 | Icons are ≤ 12 inline SVG components; no icon dependency | zero runtime deps in the console; the set is small | an icon library |
| D64 | Unregistered scale values throw in development, render neutral-with-title in production | a label must never blank a screen; a wrong tone lies | throwing in production |
| D65 | `Column<Row>` is the table contract and 03's per-screen column specs are written against it | two screens cannot render one object two ways | per-screen `head` arrays |
| D66 | One `Diff` from `DiffHunk[]`; no client-side diffing; `lib/diff.ts` deleted | the server owns what changed; three renderers become one | keeping a client diff for the conflict view |
| D67 | `Modal` is a native `<dialog>` | trap, restore and Escape come from the platform; 40 lines less | a div overlay with a hand-rolled trap |
| D68 | `Alert`, `KindTag`, `TagGrid`, `Json`, `Eyebrow`, `HeaderSearch` are removed, not ported | each is another component's job (§7 list) | — |
| D83 | **The sidebar shows what you manage.** `navFor(scope, viewer)` reads `Viewer.adminHere` — a fact about the scope, fetched with it — and lists the permission screens only for an admin of that level; Sessions and Endpoints leave for the Logs tabs | a row a viewer may open only to be refused is worse than no row (P13); `/v1/console/me` had to learn `?scope=` either way | listing every screen and refusing on arrival |
| D84 | **One level control, and every header says where you are.** The switcher is a tree (*You* · teams with sub-teams indented · *Organisation*, current marked) every screen's one bar carries a level chip (D99 moved it off the page title and onto `SubHeader`); no screen has a level toggle of its own | a flat menu hid the team tree, and a person could not tell from a screen whether they could change what was on it | a per-screen scope control |
| D94 | **The tooltip is a portal, and it stays on screen.** `useTip` returns a rendered `tip.element` — a `position: fixed` bubble at `document.body` (or at the trigger's `<dialog>`) placed from the trigger's rect: below and left-aligned, flipped above or right-aligned when the viewport says so, 8px gutter, 20rem and wrapping, placed again on scroll and resize — instead of `node` props the caller spreads into a `<span>` beside the trigger (W6-D7, §11) | the bubble lived inside the cell that triggered it, so `Table`'s `overflow-x-auto` clipped it and the last column's `(?)` ran off the right edge; a position rule only works where nothing can clip it, and a portal is an element, not a bag of attributes | returning `node` props again and accepting the clipping, or adding a positioning dependency |
| D99 | **A screen has one header, it is a bar, and it is one line.** The page's *name* leaves the screen altogether and becomes the section in the top bar (§4.3, `shell/section.tsx`, the document's one `h1`); `SubHeader` is everything else — tabs on the left, then the count, the readme `(?)`, the level chip, the search and the verbs, `flex-nowrap`, the tab strip scrolling when it must — and it is the only sticky element a screen adds. A screen's explanation is behind the `(?)` (`Readme`, *About {name}*), never printed. `PageHeader` is gone: a detail screen's object is `EntityHeader`, its **first block of content**. `Toolbar` and the four per-screen `_tabs.tsx` files are deleted with it | every screen had grown its own chrome: a title row that repeated the sidebar row just pressed, a lede under it that pushed the first row of the table below the fold, four tab components with three ideas of what *selected* looks like, a search box in five tables, and two header rows on the harness page. Read once, a sentence is furniture; a name you have just clicked is not news | giving a screen back a title row, or letting the bar wrap |
| D69 | `faint` never carries required information; accent-as-text is the alias `accent-text` (`accent` in steel, `accent-deep` in light) so no component picks per theme | contrast table §10 | retinting the tokens |

## 15. Out of scope

The marketing site's idioms — serif display type, pill CTAs, `brand-wash`,
`backdrop-blur`, the scroll-story machinery — stay under `app/(site)/` and
import nothing from `ui/` except `BrandMark`. Storybook (D62). Icons beyond
the twelve. A dark/light *system* preference (the viewer picks; default is
`steel`). Charts (none are planned; if one appears it follows the `dataviz`
guidance and the tokens here). Localisation.

## 16. Definition of done

- `app/(console)/shell/` exists with the tree in §4.2; `shell.css` is the
  only file with the grid's numbers; `shell_only_content_scrolls` passes at
  three widths.
- `app/(console)/ui/` contains exactly the inventory in §7, ≤ 1,400 lines;
  `app/ui.tsx` is deleted, and so are the prototypes' `Head`, `Card`,
  `Line`, `Detail`, `Diff`, `Tally`, `Trail`, the inline segmented controls
  and nav items — `only_ui_imports_in_screens` passes.
- `globals.css` carries §5's tokens; `jade` and `leather` are gone; the
  public-path definition exists once; `every_token_defined_in_both_themes`
  and `contrast_meets_aa` pass.
- Every test in §13 exists by name and passes in CI in both themes.
- `Column<Row>`, `NavKey` and `Viewer.waiting` are in 00 §4 (they are); `Table` consumes `Column.kind`.
