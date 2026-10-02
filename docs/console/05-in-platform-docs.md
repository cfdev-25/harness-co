# Console Plan — 05 · In-platform docs

How the console explains itself, from one content source. There is no help
centre, no tour, no chatbot. The explanation is the vocabulary, said once
next to the word; the scale behind every tag; the remedy on every refusal;
and the command under every button. This document holds the rules, the
module shapes, and the content itself.

## 1. Purpose

A member should never have to leave the screen to understand it, and never
have to read the screen to understand the product. The first is the job of
hovers, tags and empty states; the second is the job of *How this works*,
which is one page a person reads once. Everything here descends from three
PRD rules — explain the vocabulary not the screen (§14 principle 8), every
tag links to its scale (§14 principle 3), plain words with git on demand
(§14 principle 9) — and from the engine's rule that a refusal names what to
do (`engine/00` §4.7 `Blocker`).

Invariants upheld: K3, K4, K8; constraints P8, P9, P10, P13, P14.

Contracts used: `ScaleId`, `ScaleTag`, `ScaleRegistry`, `Tone` (console 00
§4.6), `Hidden` (00 §4.2), `Related["unit"]`; `Blocker` (engine 00 §4.7);
`Viewer.role` (console 00 §4.1).

## 2. Rules

| # | Rule | Consequence |
| --- | --- | --- |
| R1 | **A word is explained once, on hover, next to itself.** | One `Word` component (§10). A definition never appears in body prose. |
| R2 | **A screen never narrates itself.** | No paragraph beginning *This page shows…*. Purpose is the title and the lede, one sentence each, from the screen's content module. |
| R3 | **Every tag links to *How this works* at its scale's anchor.** | `ScaleTag` renders an `<a href={registry[scale].href}>`. A tag whose value is not in the registry does not compile. |
| R4 | **A button's explanation is its tooltip.** | `Button` takes `explain`; the label is a verb, the tooltip is the consequence. |
| R5 | **A refusal names who decides and where the ask goes.** | `PermissionNotCleared` renders a sentence from `refusals.ts`; there are no disabled buttons. |
| R6 | **A blocker's `message` and `remedy` are the engine's, verbatim.** | The console adds only the `link` as a button. It never rewrites, softens or summarises an engine sentence. |
| R7 | **First-run guidance is the empty state's one sentence with a verb.** | No tour, no checklist, no modal. The admin's setup order emerges from which screens are empty (§12). |
| R8 | **Every UI string lives in `web/content/`.** | A string literal rendered to a person from anywhere else fails lint (`02` carries the rule as `content/no-inline-copy`; this document owns the rule's meaning). |
| R9 | **British spelling; complete sentences; one idea per sentence.** | Headings and table cells may be fragments. Nothing else may. |
| R10 | **Examples use the fixture organisation.** | Acme · Marketing · Marketing interns · Jo Adeyemi (member) · Rae Lindqvist (Marketing admin) · Dana Okafor (org admin). Never a real customer, never a placeholder like *Foo*. |

## 3. The content source

```
web/content/
  scales.ts          the ScaleRegistry — §4
  words.ts           the vocabulary — §5
  commands.generated.ts   the command sheet, generated — §6
  shell.ts                navigation labels, shortcuts, Skip to content, account menu, search
  ui.ts                   the library's own words: All teams · Checked just now · Derived · Not yet explained · Try again · Close
  refusals.ts        PermissionNotCleared sentences — §7
  empty.ts           empty states and hidden-view notes — §8
  screens/
    harnesses.ts     title, lede, column help, button explanations for one screen
    harness.ts
    file.ts
    requests.ts
    groups.ts
    boundaries.ts
    providers.ts
    vaults.ts
    assets.ts
    sessions.ts
    logs.ts
    people.ts
    account.ts
    how.ts
```

One module per screen in console 00 §5; a screen imports its own module and
the shared five and nothing else.

**Where the ledes went** (01 §7.5, 01 D99). No screen prints its lede: it is
the first paragraph of the readme behind the `(?)` on the screen's bar, with
the modal's heading (*About {name}*) and the bar's *Search* and *Close
search* in `shell.ts`. The page's own name is not content at all any more —
it is the sidebar row's label, shown in the top bar by `shell/section.tsx`,
so no screen passes a title. Nothing was deleted — `ScreenContent.lede`
is the same string, read in a new place, and a per-scope lede is still built
by the page (`assetsLede`, Boundaries' and Security groups' `ledeFor`,
Logs' `ledeFor`) and passed as the body's first paragraph.

`ScreenContent` gains `about?: readonly string[]`, the paragraphs after the
lede, added only where a screen already had explanatory prose with nowhere
left to sit: Logs' three tab sentences (`changesLede`, the Sessions lede and
`endpointsLede`), Providers' two (`harnessLede`, `modelLede`) and
Boundaries' three (`tabLede`). Those keys are gone from their
`*_TEXT` objects, as are the five `searchLabel`s the in-page filter boxes
used — the bar's search is labelled once, in `shell.ts`. The page's readme
is assembled by `lib/views/header.ts` `readmeOf`, never by a component.

Shapes:

```ts
// scales.ts
export const SCALES: ScaleRegistry;                       // console 00 §4.6

// words.ts
export interface WordEntry {
  short: string;          // one sentence a marketing manager understands
  more: string;           // one sentence more, for the technical reader
  prd: `§${string}`;      // the PRD section that decides it
}
export const WORDS: Record<WordId, WordEntry>;            // WordId is the union of keys in §5

// screens/<screen>.ts
export interface ScreenContent<Column extends string, Verb extends string> {
  title: string;
  lede: string;                                           // one sentence; may be "" for the harness repository view
  columns: Record<Column, { heading: string; unit?: Related["unit"]; scale?: ScaleId; help: string }>;
  verbs: Record<Verb, { label: string; explain: string }>;
  empty: keyof typeof EMPTY;                              // which empty-state sentence
}

// refusals.ts
export type RefusalId = keyof typeof REFUSALS;
export const REFUSALS: Record<string, { sentence: string; ask?: { label: string; where: string } }>;

// empty.ts
export const EMPTY: Record<string, { sentence: string; verb?: { label: string; href?: string; command?: string } }>;
export const HIDDEN: Record<keyof Viewer["visibility"], string>;   // the notes `HiddenView` renders (01 §7); the server's `Hidden` map carries the same sentences
```

`Column` and `Verb` are string-literal unions declared per screen, so a
component that asks for `columns.reach` on a screen with no reach column is
a type error, not a blank heading. **Review:** a content change is a PR like
any other; the reviewer reads every changed sentence aloud (§13).

## 4. `scales.ts` — the registry

Tones: `ok` is the state the product prefers, `hold` is true but provisional
or weaker, `warn` needs a person, `accent` marks a stronger or wider claim,
`neutral` is plain. Anchors are `/console/how#<scale>`.

| Scale | Label | Value | Tone | Meaning |
| --- | --- | --- | --- | --- |
| `approval` | Approval | approved | ok | Anyone this runtime is scoped to may run it and be handed credentials with it. |
| | | beta | hold | Anyone scoped to it may run it, but only an admin is handed credentials with it — the state for trying a build before committing to it. |
| | | not-approved | warn | Nobody may run it. A deliberate no, recorded with its reason so the next person sees it was decided. |
| `source` | Comes from | vault-supplied | accent | We resolve it from a key vault when the session starts, can confirm it beforehand, and can stop supplying it. |
| | | locally-owned | neutral | A sign-in or machine login the person made. We never hold it, cannot hand it to a harness, and only learn of it once the session is up. |
| `evidence` | Evidence | verified | ok | The platform confirmed it itself, just now. |
| | | harness-reported | hold | The runtime says so; we did not check it ourselves. |
| | | declared | neutral | Expected and unobserved. Nothing here rounds up. |
| `slot` | Slot | satisfied | ok | This need was met before the session started. |
| | | unsatisfied | warn | This need was not met and the session will not start until it is. The row says what to do. |
| | | deferred | hold | It cannot be checked before launch — a sign-in the runtime holds, or a local login the group permits — so it is checked once the session is up and never counted as satisfied. |
| `reach` | Outside endpoints | prohibited | ok | The harness reaches only what it was granted: its credentialed endpoints and its model provider. The strong claim. |
| | | allowed | hold | The harness may reach anything not on a boundary. The agent still cannot cross a boundary; the claim is weaker and the tag says so. |
| `holds` | Holds | enforced | ok | There is no route, no permission, or the binary is not there. It holds whatever the agent tries. |
| | | intercepted | hold | Every invocation is checked before it runs. It holds against the thing attempted directly, not the same thing written another way. |
| `loads` | How it loads | always | accent | Into every harness, and no filter can leave it out. Where a compliance rule belongs. |
| | | when-chosen | neutral | Published and available; whoever builds the harness includes it. |
| `role` | Role | member | neutral | Uses what they are given, offers changes, creates their own harnesses, reads every log about themselves. |
| | | team-admin | accent | Everything a member may, and may narrow what the team holds: sub-teams, narrower grants, boundaries for the team and below, accepting requests. Widens nothing. |
| | | org-admin | accent | Everything. Approves runtimes, connects vaults, creates groups, appoints admins, sets what a person may see. |
| `request` | Request | open | hold | Waiting on a team admin. |
| | | closed | neutral | Decided — accepted, declined or withdrawn — with the reason kept. |
| `session` | Session | active | ok | Running now, on the credentials it was minted. |
| | | revoked | warn | Ended by the platform: a policy that covered it changed, or an admin revoked it. The reason is on the session. |
| | | closed | neutral | Ended by the person. |
| `preflight` | Preflight | passing | ok | Every check that runs before a session passed the last time it ran, or would pass now. |
| | | failing | warn | Something stops it starting. The harness's own page names the cause and links to the thing to change. |
| `providerStatus` | Status | set-up | ok | A security group holds a key for it and its endpoint answered just now. Sessions can be routed here. |
| | | needs-key | warn | No security group holds a key for it, so nothing is routed to it, no runtime can run on it and a session aimed at it is refused. *Set up* connects one. |
| | | sign-in | accent | Pi signs in to this provider itself (`/login`); add a key to route it through the harness. |
| | | unreachable | hold | A key is held, but the endpoint did not answer within three seconds. Routing stands; a session will fail until it answers. |
| `provenance` | Provenance | declared | neutral | An admin typed it. Set by a person, in a commit with an author. |
| | | observed | ok | Checked as this screen drew, and stored nowhere. |
| | | derived | accent | Computed from what is granted, denied and included. Nobody wrote it. |

Thirteen scales, thirty-five values. The thirteenth is `providerStatus`
(W6-D6, 04 D96): the Model providers table's *Reachable* yes/no became three
states, because *needs a key* and *did not answer* send a person to two
different places and one boolean said neither. W7-D2 (04 D103) added its
fourth value, `sign-in`, for the same reason one more time — a keyless
provider the organisation's own runtime logs itself in to sends a person
nowhere, because it already works — and it is `accent`, not `warn`, because
nothing is wrong with it. The registry is the whole list; a fourteenth
*scale* is a PRD change first — 04 D41 and D89 have each refused one.

**The honesty line that goes with it** (W7-D2). On a *sign-in* session the
request goes straight to the provider over TLS. Nothing of ours is in the
middle of it, so W5-D3's model shaping cannot apply: provider-side browsing
cannot be stripped from a request that never reaches the proxy. Reach on the
machine is untouched — the tunnel is still the only way out of the jail, and
the harness's own network rules hold exactly as they do for a keyed session.
It is said on the Providers screen whenever a row reads *sign-in*, in these
words, because *not metered* must never be read as *free of the controls*.

## 5. `words.ts` — the vocabulary

Each entry: the word · one sentence for anyone · one sentence more · PRD.

| Word | Short | More | PRD |
| --- | --- | --- | --- |
| harness | The set of things an AI assistant is given for a job: instructions, skills, tools, and the rules around them. | A named list of asset ids on a branch, with a description and a drawing; it filters what a session loads and never adds a permission. | §17 |
| harness provider | The program the assistant runs in — Pi, Claude Code. | The runtime the engine launches inside a sandbox; approved, beta or not approved per organisation. | §9.1 |
| model provider | Where the model itself comes from — Anthropic, a gateway your company runs. | An endpoint per wire format, a list of models, and the credential alias it is reached with. | §9.2 |
| skill | A packaged way of doing one kind of task that the assistant can pick up when it fits. | A directory the runtime discovers; loaded when the harness includes it. | §17.1 |
| memory | Something the assistant should always keep in mind. | Standing context appended to the instructions file on every turn. | §17.1 |
| prompt | A saved instruction you can start with, chosen by name. | A slash command; nothing reaches the model until someone picks it. | §17.1 |
| system prompt | The opening brief the assistant works under. | The preamble of the instructions file, broadest scope first. | §17.1 |
| tool | Something the assistant can run — a script your team wrote. | A directory with an executable `run`, vendored dependencies, and a sidecar id; runs inside the sandbox at the agent's privilege. | §17.1 |
| connection | A named way to reach an outside service. | An alias in a security group entry, bound to an upstream and a secret. | §6.3 |
| security group | A named bundle of credentials that a team is given. | Entries of alias → secret, a sources rule, and mint parameters; granted to teams and optionally narrowed to harnesses. | §6.3 |
| grant | A security group handed to a team, or reach handed to a team. | A scoped instance of a group or of outside endpoints; a differently scoped grant is a different grant. | §6.4, §8 |
| boundary | Something the assistant may never do, however it is running. | A deny — endpoint, command, filesystem or capability — that compounds by union down the tree and only tightens. | §7 |
| outside endpoints | Whether the assistant may reach anything beyond what it was given. | A grant whose payload is reach; derived on the harness, never stored; boundaries still apply. | §8 |
| chain | The line from your organisation, through your teams, to you. | The ordered refs composed by precedence to produce your effective harness. | §2 |
| your version | Your copy of a file, which is what runs for you. | The work tree, backed by your own branch. | §17.2 |
| team version | The copy everyone on the team receives. | The team branch, moved only by promote. | §17.2 |
| differences | Where your copy and the team's disagree. | A comparison of the two; the only view in which a conflict exists. | §17.2 |
| offer | Ask a team admin to publish your change to the whole team. | `push` to your branch plus a request over the paths. | §17.4 |
| keep as mine | Save your change to your own copy; nobody reviews it. | A commit on your branch; it follows you between machines and shadows the team's copy for you alone. | §17.4 |
| take the team's | Replace your copy of a file with the team's. | `reset`: checks out the delivered version over yours; confirms first. | §17.4 |
| request | A change offered to the team, waiting on an admin. | A pull request over a set of paths with one decision and its reason. | §17.3 |
| promote | Publish a change to the team so everyone receives it. | A commit onto the team branch; the same verb whether from a request or from reading a member's branch. | §17.3, §18 |
| sub-team | A team inside a team, used to keep something from part of it. | A branch under the parent; it starts empty and inherits, so withholding is placing a thing on a sibling. | §5.3 |
| key vault | Where secrets are kept — yours, or the one we host. | A resolver behind one interface: `probe` and `resolve`. | §6.1 |
| alias | The name a tool uses for a credential, so the same tool works at two teams with different vaults. | An entry key in a security group, resolved per team. | §6.3 |
| resolved from | Which source actually supplied a credential for this session. | Recorded per slot at preflight and kept with the session; the field that makes a fallback chain reviewable. | §6.5 |
| evidence | How we know something is true. | Verified, harness-reported or declared; never rounded up. | §6.6 |
| preflight | The checks that run before a session starts. | Compose, choose, mint, plan, probe, report — a detector, not a fence; the broker and the proxy enforce. | §10.2 |
| session | One run of an assistant under a harness. | A record of the commits it ran on, its slots, its preflight report and the endpoints it reached. | engine 04 |
| endpoint reached | A host the assistant actually contacted. | A row in the authoritative log the proxy writes; the source of the *Endpoints reached* screen. | §19 |
| attested | Reported from inside the assistant's sandbox; best effort. | Telemetry the runtime's hooks wrote; labelled so, never mixed with authoritative. | §19 |
| authoritative | Recorded by something outside the sandbox that saw it happen. | The proxy, the broker or the definitions service; hash-chained. | §19 |

## 6. `commands.generated.ts` — the command sheet

**Source of truth:** `engine/cli/src/commands/sheet.ts` (engine 08 §11.17).
The web build must not import the CLI package (Node-only code in a browser
bundle), and `@harness/contracts` is types-only by decision (console 00 D3),
so the sheet crosses as **data**: the CLI build emits `dist/sheet.json`; the
web build copies it to `web/content/commands.generated.ts`; a CI check reads
both and fails on any difference (`sheet_matches_cli`, V1). One truth, no
runtime dependency.

Rows, grouped as the sheet is; `run` uses the fixture harness
`campaign-drafts`:

| Group | What | Run | Note |
| --- | --- | --- | --- |
| Pick something up | Work on your version of a harness | `harness switch campaign-drafts` | |
| | Run the session on the team's version | `harness switch campaign-drafts --team` | anything you change still lands on your version |
| | Start a session | `harness run pi` | the provider is the word; the harness is what you switched to |
| | Make a new harness | `harness new "Weekly newsletter"` | starts empty; hands you `harness switch` |
| | Make one from a copy | `harness new "Weekly newsletter" --from campaign-drafts` | |
| See what is going on | What you have changed, and what is in conflict | `harness status` | no network |
| | The difference on one file | `harness diff skill/campaign-brief` | `--team` compares to the team's copy; `--git` prints the hunk |
| | History of your version | `harness log` | `--team` for the team's |
| | What will and will not resolve before you start | `harness preflight` | `--<harness>` overrides the selection |
| | Bring the work tree up to date | `harness pull` | never overwrites a change of yours |
| | Who you are and what you have | `harness whoami` | |
| Change something | Keep your version — nobody reviews it | `harness push tool/crm-sync --message "Retry flaky list calls"` | lands in the harness you switched to; --harness names another |
| | Offer it to the team | `harness offer tool/crm-sync --message "Retry flaky list calls"` | opens a request an admin sees |
| | Withdraw an offer | `harness withdraw <request-id>` | |
| | Take the team's version of one file | `harness reset tool/crm-sync` | asks first unless `--yes` |
| | Take the team's for everything | `harness reset --all` | |
| | Adopt something you made by hand | `harness adopt ./my-tool` | mints its id |
| Set up | See what is left to set up | `harness setup` | each missing step prints the command that closes it |
| | See every runtime and its approval | `harness providers` | |
| | Turn a runtime on | `harness providers approve pi` | org admin; `--teams` narrows who may run it |
| | Turn a runtime off | `harness providers decline claude --reason "…"` | |
| | Connect a model key | `harness keys add openrouter` | prompts for the key; sets it as the organisation's default |
| | Make a harness for a team | `harness new "Weekly newsletter" --team marketing` | `--org` for every team; without a flag it is yours alone |
| Sign in | Sign in to the platform | `harness login` | |
| | Sign in to a runtime with your own account | `harness auth claude` | outside the sandbox; native mode |
| | Print this sheet | `harness commands` | the last row prints the raw `git` invocation |

## 7. `refusals.ts` — Permission not cleared

Each sentence names who decides and where the ask goes. Rendered by
`PermissionNotCleared` where the button would otherwise be (P13).

| Id | Sentence | Ask |
| --- | --- | --- |
| `accept_request.member` | Accepting a request publishes it to everyone on Marketing, so a Marketing admin decides it. | — (the request is already in their queue) |
| `narrow_group.member` | Narrowing a security group hands part of it to a sub-team, so a Marketing admin does it. | *Ask Rae Lindqvist* → opens a message with the group named |
| `add_boundary.member` | A boundary applies to everyone in Marketing and below, so a Marketing admin adds it. | *Ask Rae Lindqvist* |
| `approve_provider.team_admin` | Approving a runtime decides whose program holds credentials for the whole organisation, so an organisation admin decides it. | *Ask Dana Okafor* → the request appears in the org's People screen |
| `appoint_admin.team_admin` | Team admin is granted from above, so an organisation admin appoints one. Anyone may ask. | *Ask to be an admin* → the request appears in Marketing's People screen marked with the admin it waits on |
| `lift_org_boundary.any` | An organisation boundary only tightens on the way down. Nobody below the organisation can lift it; an organisation admin can remove it there. | *Ask Dana Okafor* |
| `read_member_branch.member` | Another member's versions are theirs. A Marketing admin can read them; you can read yours and the team's. | — |
| `revoke_session.other` | This session is Jo Adeyemi's. Their team's admin, or an organisation admin, can end it. | *Ask Rae Lindqvist* |
| `create_group.team_admin` | A security group names a secret and who may mint it, so an organisation admin creates one. Narrowing what Marketing already holds covers most of what people ask for. | *Ask Dana Okafor* |
| `change_sources.team_admin` | Which sources a group accepts is the rule that stops it resolving from somebody's laptop, so an organisation admin changes it. | *Ask Dana Okafor* |

Names are substituted from the viewer's chain at render (`{teamAdmin}`,
`{orgAdmin}`, `{team}`, `{owner}`); the fixture names above are the
examples the content is authored against (R10).

## 8. `empty.ts` — empty states and hidden views

| Screen | Sentence | Verb |
| --- | --- | --- |
| harnesses (me) | You have no harnesses yet. One starts empty and inherits everything you already hold. | *New harness* |
| harnesses (team) | Marketing has no harnesses yet. | *New harness* |
| harness · files | Nothing is in this harness yet. Add something you already have, or start a session and adopt what you make. | `harness adopt ./my-tool` |
| harness · requests | No requests. Offering a change from your version opens one here. | `harness offer <path> --message "…"` |
| harness · history | No versions yet. The first `harness push` starts the history. | |
| requests (closed) | Nothing has been decided yet. | |
| sessions | No sessions yet. `harness run` starts one, and it appears here within a few seconds. | `harness run pi` |
| session · endpoints | This session has not reached anything yet. | |
| groups (org) | No security groups yet. A group is a named set of credentials a team can be given. | *Create a group* |
| groups (team) | Marketing holds no security groups yet. An organisation admin grants one. | — |
| grants | Nothing is granted to this team yet. | *Grant a group* |
| boundaries (org) | No boundaries yet. Nothing is restricted beyond the organisation's runtime approvals. | *Add a boundary* |
| boundaries (team) | Marketing adds no boundaries of its own. The organisation's apply. | *Add a boundary* |
| providers | No runtime is approved yet, so nobody can start a session. | *Approve a runtime* |
| providers · model | No model provider yet, so a session has nowhere to send a request. | *Add a model provider* |
| vaults | No key vault is connected. The one we host is ready to use. | *Connect a vault* |
| vault · secrets | We cannot list what is inside this vault; it shows what an admin declared. | — |
| assets (org) | No organisation assets yet. Anything here reaches every team. | *Add an asset* |
| assets (team) | Nothing on this team's branch yet. What the organisation holds still reaches you. | — |
| assets (me) | Nothing on your own branch yet. What your team and your organisation hold still reaches you. | — |
| logs | Nothing recorded yet in this category. | |
| endpoints | No harness has reached an endpoint yet. | |
| people | Just you. Adding someone to a team is the grant. | *Invite* |
| teams | No teams yet. A team is a branch everything on it inherits. | *New team* |
| account · logins | No runtime is signed in on this machine. | `harness auth claude` |

Hidden views (P10 — the list is replaced by the note, never shortened):

| View | Note |
| --- | --- |
| boundaries | Your organisation has chosen not to show boundaries to members. A refusal you meet will still say which boundary it was. |
| logs | Your organisation has chosen not to show members their own logs. |

## 9. *How this works*

Route `/console/how` — outside `[scope]` (console 00 §5, 04 §16). Structure:

1. *Set up* (04 §16.1, D105), above everything: the three commands a person
   pastes to install the CLI and sign it in, with a **Generate a token**
   button that writes a token into the second one. The one part of this page
   that is per viewer and dynamic; everything below it is the reference.
2. A search box filtering by word, with nothing between it and *Set up*.
3. One section per scale in registry order, `id` = the `ScaleId` so
   `ScaleRegistry.href` anchors resolve. Each section: the scale's label as
   the heading; each value rendered as its `ScaleTag` followed by its
   meaning; no introduction.
4. Then *Words*, alphabetical, each entry: the word, `short`, `more` set
   smaller, the PRD reference as a `Mono` link to the section.
5. Then *Commands*: the sheet (§6), same component as the modal.

No prose between the reference sections (2–5). The page is the reference the
hovers point at; it explains nothing twice. *Set up* is the exception D54
allows and names: instructions **above** the reference, not prose inside it,
and the only place the console prints the lines that install the CLI.

## 10. Mechanics

**One bubble (01 §7.11, §11, D94).** `Word`, `HelpMark` and `Button explain`
are the same hook, `ui/use-tip`. It opens on hover *and* on focus, is a
`role="tooltip"` tied to its trigger by `aria-describedby`, and Escape
dismisses it; `title=` is never the only help. The bubble is **rendered
through a portal at `document.body`** (or at the `<dialog>` the trigger is
in) and placed from the trigger's bounding rect — below and left-aligned,
flipped above when there is no room below, right-aligned when it would cross
the right edge, 8px from any edge, up to 20rem wide and wrapping, placed
again on scroll and resize. So a `(?)` in a table's last column shows its
whole sentence: nothing it sits inside can clip it, because it does not sit
inside anything.

**`Word`** — `<Word id="alias">alias</Word>`: renders its children with a
dotted underline; on hover or focus shows `WORDS[id].short` in the bubble.
Never nested; never inside a link (the link wins). Used the first time a
word appears on a screen and not again on that screen.

**`Button explain`** — `<Button explain="Publishes to everyone on Marketing">`
renders the string as the bubble, on hover and on focus alike. Every button
with a consequence has one; navigation buttons do not.

**Column help** — `Table` takes `columns` from the screen's content module;
a heading with `help` renders the `(?)` affordance after the heading text,
opening the help on hover or focus. `(?)` appears on every column with a
`scale` or a `unit` and on any other column whose `help` is set. It never
appears in prose, on a title, or on a button. The last column's `(?)` is the
case D94 was written for, and a component test holds it.

**`ScaleTag`** — renders the value in its tone and links to
`SCALES[scale].href`; the tooltip is the value's `meaning`. The only way to
render a tag.

## 11. Blockers

`Blocker { code, message, remedy, link }` (engine 00 §4.7) renders through
one `BlockerCard`: `message` as the sentence, `remedy` as the action line,
`link` as a button labelled from the remedy's verb. A list of blockers is
rendered in the engine's order. Members never see `code`; admins see it as a
`Mono` in the card's corner, because they are the ones who will search for
it. The console never rewrites an engine sentence (R6); if one reads badly,
the fix is in the engine's failure-mode table.

Where blockers appear: the session page (from `PreflightReport`), the
harness header's *failing* tag popover, and the *Preflight* section of a
harness.

## 12. Admin first run

There is no wizard. An organisation admin who signs in for the first time
sees the shell with every screen empty, and each empty state's verb is the
next step. Read in the sidebar's order the sequence is:

1. *Key vaults* — *No key vault is connected. The one we host is ready to use.* → **Connect a vault**
2. *Security groups* — *No security groups yet…* → **Create a group**
3. *Security groups · grants* — *Nothing is granted to this team yet.* → **Grant a group**
4. *Providers* — every known runtime is already a row, none approved (engine D30h); the first-run notice reads *No runtime is approved yet, so nobody can start a session. Turn one on below.* → the approval switch in the row
5. *Providers · model* — the presets are already rows, none with a key; *No key is connected yet…* → **Set up** on one row (paste the key, pick a model); the grant to all teams and the organisation-wide default are part of that one write

After step 5 a member can `harness run` — and steps 1–3 are optional for
that: the key's group and grant are made by step 5. This replaces any
onboarding checklist: the checklist is the set of screens that are still
empty or still carry their first-run notice, and it disappears by being
done. `harness setup` (engine 08 §11.22) prints the same five facts from the
same policy, each with the command that closes it.

## 13. Content inventory and authoring

| Screen | Consumes |
| --- | --- |
| shell | `words` (scope switcher terms), `refusals` (`read_member_branch`) |
| harnesses | `screens/harnesses`, `empty` |
| harness | `screens/harness`, `scales` (preflight, reach), `words`, `commands.generated`, `empty` |
| file | `screens/file`, `words` (your version, team version, differences), `empty` |
| requests | `screens/requests`, `scales` (request), `refusals` (`accept_request`), `empty` |
| groups | `screens/groups`, `scales` (source), `refusals` (`narrow_group`, `create_group`, `change_sources`), `empty` |
| boundaries | `screens/boundaries`, `scales` (holds), `refusals` (`add_boundary`, `lift_org_boundary`), `empty` |
| providers | `screens/providers`, `scales` (approval, providerStatus), `refusals` (`approve_provider`), `empty` |
| vaults | `screens/vaults`, `scales` (source, evidence), `empty` |
| assets | `screens/assets`, `scales` (loads), `empty` |
| sessions | `screens/sessions`, `scales` (session, slot, evidence, preflight), `BlockerCard`, `refusals` (`revoke_session`), `empty` |
| logs | `screens/logs`, `scales` (provenance), `empty` |
| people | `screens/people`, `scales` (role), `refusals` (`appoint_admin`), `empty` |
| account | `screens/account`, `words`, `commands.generated`, `empty` |
| how | `scales`, `words`, `commands.generated` |

**Authoring rules.** Anyone may open a PR against `content/`; a reviewer
reads every changed sentence aloud before approving — if it cannot be said
to a colleague, it is not done. No marketing voice: no *powerful*, *simple*,
*seamless*. One idea per sentence. The verb is the person's, never the
product's (*Offer it to the team*, not *Harness lets you offer*). Numbers
and names come from the fixture organisation (R10). A sentence that explains
the screen rather than a word is deleted on review (R2).

## 14. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D50 | The command sheet crosses from the CLI to the web as generated data with a CI drift check, not as an import or a contracts export. | exporting it from `@harness/contracts` — costs that package its types-only property |
| D51 | Blocker codes are shown to admins only. | showing them to everyone — noise for members who cannot act on a code |
| D52 | Hidden views replace the list with a note, and the note says a refusal will still name its boundary. | a shorter list — P10 forbids it |
| D53 | The vocabulary is explained the first time a word appears on a screen and not again. | every occurrence — visual noise once a person knows the word |
| D54 | *How this works* has no prose between sections. | introductions — R2 applied to the reference page itself |
| D55 | Refusal sentences substitute the viewer's actual admins by name. | a generic *your admin* — the point of the sentence is knowing whom to ask |

## 15. Out of scope

An external documentation site. Video. Localisation — English only,
British spelling. An in-product chat assistant. Release notes.

## 16. Definition of done

- `content/scales.ts` has an entry for all thirteen `ScaleId`s and
  thirty-seven values; `ScaleTag` refuses an unregistered value at compile
  time (V1 `scale_registry_is_exhaustive`) and throws in development on one
  the server sends (01 D64).
- Every screen in console 00 §5 has its `screens/<screen>.ts` and imports no
  string from anywhere else; `content/no-inline-copy` passes across `web/app`.
- `commands.generated.ts` equals the CLI's `dist/sheet.json` (V1
  `sheet_matches_cli`).
- Every blocker code in the engine's failure-mode tables (engine 03 §7,
  engine 04 §9, engine 05 §10, engine 06 §10, engine 07 §12, engine 08 §13)
  renders through `BlockerCard` in a V2 test that feeds each code's example
  message and remedy.
- V2 `scale_tag_renders_every_registered_value` and `scale_tag_links_to_how`
  (01 §13): each registered value renders in its tone and its link resolves
  to an existing anchor on `/console/how`.
- V2 `refusals_name_the_decider`: every `REFUSALS` entry renders a sentence
  containing a substituted name and, where `ask` is set, a working target.
- `/console/how` renders every scale section in registry order with
  matching `id`s, and the search box filters words (V3).
