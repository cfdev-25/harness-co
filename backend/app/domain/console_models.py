"""The console's response models — one per 00 §4 type, named for it.

They live here rather than in `routes_console.py` for two reasons. The routes
are meant to be thin (03 §4), and twenty-seven models were most of that file;
and these shapes are the contract the browser is generated from (00 D3), so
they are worth reading on their own.

Two rules decide how narrow each field is:

* **Engine types are imported by name, never redeclared** (00 §4 preamble).
  `HarnessDef`, `Boundary`, `Slot`, `PreflightReport`, `EndpointTally`,
  `Chain`, `Routing` and `Icon` come from `@harness/compose/contracts` in the
  browser, so the field carries them as an open object and the client casts.
* **Everything the console itself defines is a model.** `header.preflight`,
  `lastEditor`, `person`, `Related.items` and the rest are declared here, so
  `web/lib/api.generated.ts` carries `header.preflight.value` and not
  `Record<string, unknown>` (`generated_types_are_narrow`).

`extra="allow"` stays on every model: a list response carries `stale` and
`hidden` beside its items (03 §4), and a detail route adds its `edges` or its
honesty line to the row type it extends.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Json = dict[str, Any]
Provenance = Literal["declared", "observed", "derived"]


class Meta(BaseModel):
    """03 §4: staleness is a flag on every index-backed response; `hidden` is
    P10's note, carried in place of the list it replaces."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    stale: Json | None = None
    hidden: dict[str, str] | None = None


class Page[T](Meta):
    items: list[T]
    next: str | None = None


# --- the small shapes every row is built from (00 §4.2, §4.7) ---------------


class Fact(Meta):
    """`Fact<T>` with the value left open: the observed facts carry booleans
    and, where nothing was checked, nothing (03 §4.6's *your machine*)."""

    value: Any = None
    provenance: Provenance
    at: str | None = None
    by: str | None = None


class PreflightFact(Fact):
    value: Literal["passing", "failing"]


class TextFact(Fact):
    value: str | None = None


class TextsFact(Fact):
    value: list[str] = []


class EffectiveReach(BaseModel):
    """D131's composed reach. Declared here rather than beside `ReachView`
    because `HarnessView` carries one too: what a session of this harness may
    reach is the same three fields, so there is one shape and not two."""

    mode: str
    hosts: list[str] = []
    # The node that took the last narrowing step, or a `harness:<id>`.
    setBy: str


class RelatedItem(Meta):
    id: str
    label: str
    href: str


class Related(Meta):
    unit: str
    items: list[RelatedItem] = []
    all: bool | None = None


class ScaleTag(Meta):
    scale: str
    value: str


class TeamRef(Meta):
    path: str
    name: str


class PersonRef(Meta):
    id: str
    name: str | None = None


class HarnessRef(Meta):
    id: str
    name: str


class RefPointer(Meta):
    """A git ref and the commit a row was written at."""

    ref: str
    commit: str = ""


# --- shell (00 §4.1) --------------------------------------------------------


class UserRef(Meta):
    id: str
    email: str
    name: str


class ViewerRole(Meta):
    level: Literal["member", "team-admin", "org-admin"]
    at: str | None = None


class ViewerTeam(Meta):
    """`id` is the `org_units` row: the index is keyed by path, the write
    routes of 00 §4.11 by id, and a sidebar entry needs both."""

    id: str | None = None
    path: str
    name: str
    admin: bool = False


class Visibility(Meta):
    boundaries: bool = True
    logs: bool = True
    # W5-D15: the Assets screen's *Browse* tab. Off hides the tab and the
    # route answers `hidden` in place of the list (P10); what the person
    # already holds is not touched. A personal account has it on.
    store: bool = True


class Setup(Meta):
    """W7-D5: the Account screen's *Getting started* list, derived per read
    (`console.setup_facts`). `model` is W7-D2's: a key held for the routed
    model provider, or the runtime's own sign-in, or neither."""

    installed: bool = False
    loggedIn: bool = False
    model: Literal["key", "sign-in"] | None = None
    harness: bool = False


class Viewer(Meta):
    user: UserRef
    chain: list[Json]                                # engine `Chain`
    role: ViewerRole
    edition: Literal["personal", "enterprise"]
    staff: bool
    teams: list[ViewerTeam]
    visibility: Visibility
    waiting: dict[str, int]
    # Whether the viewer administers the scope this answer was computed for
    # (`?scope=`), which is what the sidebar and the level chip read (01 §4.4,
    # §4.2). It is a fact about the *scope*, not about the person, so the
    # console must ask with the scope it is drawing.
    adminHere: bool = False
    # W7-D5. A fact about the person, not the scope: the same four answers at
    # every level, read only by the Account screen, which is `me`-only.
    setup: Setup = Field(default_factory=Setup)


class SearchHit(Meta):
    kind: str
    id: str
    label: str
    href: str


class SearchHits(Meta):
    items: list[SearchHit]


class HowThisWorks(Meta):
    scales: Json                                     # `ScaleRegistry`, 05 §2
    categories: list[str]


# --- harnesses, files, history (00 §4.3) ------------------------------------


class AlsoAt(Meta):
    """W5-D9: another copy of the same harness id on the viewer's chain. The
    card shows the nearest copy; these are the rest, each a link to the same
    harness read at that level."""

    level: Literal["org", "team", "me"]
    label: str
    href: str


class Runner(Meta):
    """W5-D13: a runtime that can start this harness for this viewer — the
    word on a launch button and the `provider=` of its `harness://` link. The
    id is `HarnessProvider.id`; `name` is the console's word for it, because
    the contract carries no display name (engine 00 §4.4)."""

    id: str
    name: str


class HarnessCard(Meta):
    id: str
    name: str
    description: str
    icon: Json | None = None                         # engine `Icon`
    team: TeamRef
    fileCount: int
    alsoAt: list[AlsoAt] = []
    # W5-D13: approved for this level, scoped to this harness, and speaking a
    # wire format the routed model exposes — the launch buttons, decided here
    # and never in the page.
    runners: list[Runner] = []
    # W5-D14: where the viewer's own last session with this harness ran, and on
    # which machine. The page cannot know which machine the browser is on, so
    # it says both. `null` for anyone but the owner, and under `?as`.
    lastWorkspace: str | None = None
    lastHost: str | None = None


class Editor(Meta):
    name: str
    at: str
    note: str


class HarnessFileRow(Meta):
    assetId: str
    kind: str
    name: str
    path: str
    # C18: an assigned id nothing answers has no owner and carries `note`.
    owner: str | None = None
    lastEditor: Editor | None = None
    tree: str = ""
    differs: Literal["yours-only", "theirs-only", "both", "conflict"] | None = None
    note: str | None = None
    # prd-v2 §5.2, W5-D10: `required` is the organization's say-so, not the
    # harness's; `recommended` is what a new harness starts with; everything
    # else is here because this harness asked for it.
    loads: Literal["required", "recommended", "on-request"] = "on-request"


class HarnessHeader(Meta):
    preflight: PreflightFact
    modelProvider: TextFact
    groups: TextsFact
    fileCount: int


class VersionOption(Meta):
    id: str
    label: str


class GroupRef(Meta):
    name: str
    grant: str


class BoundarySetBy(Meta):
    """00 §4.7's `ChainNode`, plus the name PRD §16 shows and the commit the
    line was written in."""

    kind: str
    path: str
    name: str = ""
    ref: str = ""
    commit: str | None = None


class BoundaryRow(Meta):
    id: str
    kind: str
    value: str
    holds: str
    reason: str = ""
    scope: Json = {}
    setBy: BoundarySetBy
    when: str | None = None


class SuggestedCommand(Meta):
    """W6-D10 — one entry of `presets/command-boundaries.json`, offered under
    *Set here* on Boundaries → Commands as a one-click add. `present` is the
    one thing the file cannot say: whether this level already holds it."""
    value: str
    holds: str = "intercepted"
    reason: str = ""
    present: bool = False


class SuggestedCommands(Meta):
    """`GET /v1/console/boundaries/suggested?scope=`. Its own route and not a
    field on `Page[BoundaryRow]`: `Page[T]` is the one listing shape every
    table reads (00 §4.10), and widening it for one screen would put an unused
    key on twenty others. Reach's starter list rides on `ReachView` because
    `ReachView` is that screen's own view model; the deny list has no such
    object, so this is one."""
    suggested: list[SuggestedCommand] = []
    canEdit: bool = False


class HarnessView(Meta):
    def_: Json = {}                                  # engine `HarnessDef`
    team: TeamRef
    header: HarnessHeader
    versions: list[VersionOption]
    files: list[HarnessFileRow]
    groups: list[GroupRef]
    boundaries: list[BoundaryRow]
    # D131, W5-D7: how far a session of *this* harness may reach — the chain's
    # reach narrowed by the harness's own step. It replaces the header's
    # outside-endpoints cell, which read a retired grant (W5-D1b) and was
    # therefore always `prohibited`. `setBy` is a node path or `harness:<id>`; the level's
    # own word is the console's to say (01 §4.4).
    reach: EffectiveReach

    model_config = ConfigDict(extra="allow", populate_by_name=True,
                              alias_generator=lambda name: "def" if name == "def_" else name)


class DiffLine(Meta):
    kind: Literal["ctx", "add", "del"]
    text: str


class DiffHunk(Meta):
    header: str
    lines: list[DiffLine]


class HistoryRow(Meta):
    """One commit behind a file or a harness. `branch` is the owner word for a
    harness's history and `mine`/`team` for a file's (04 §5, §6)."""

    commit: str
    branch: str
    who: str
    at: str
    message: str
    paths: list[str] = []


class FileContent(Meta):
    mine: str | None = None
    team: str | None = None


class RequestRef(Meta):
    id: str
    state: Literal["open", "closed"]


class FileView(Meta):
    row: HarnessFileRow
    content: FileContent
    diff: list[DiffHunk] | None = None
    history: list[HistoryRow]
    request: RequestRef | None = None


# --- requests (00 §4.4) -----------------------------------------------------


class Outcome(Meta):
    decision: Literal["accepted", "declined", "withdrawn"] | None = None
    by: str | None = None
    at: str = ""
    reason: str = ""


class RequestFile(Meta):
    assetId: str
    path: str
    added: int = 0
    removed: int = 0
    stale: bool = False
    diff: list[DiffHunk] = []


class Comment(Meta):
    id: str
    who: str
    at: str
    text: str


class RequestView(Meta):
    id: str
    harness: HarnessRef | None = None
    team: TeamRef
    subject: Json                                    # promotion | role (00 §4.4)
    title: str
    reasoning: str
    author: PersonRef
    at: str
    state: Literal["open", "closed"]
    outcome: Outcome | None = None
    files: list[RequestFile]
    discussion: list[Comment]
    verbs: list[Literal["accept", "decline", "withdraw", "comment"]]


# --- sessions (00 §4.5) -----------------------------------------------------


class ProviderRef(Meta):
    id: str
    version: str | None = None


class ModelRef(Meta):
    provider: str
    model: str


class EndpointCounts(Meta):
    reached: int = 0
    refused: int = 0


class SessionRow(Meta):
    id: str
    person: PersonRef
    harness: HarnessRef | None = None
    provider: ProviderRef
    model: ModelRef
    status: Literal["active", "revoked", "closed"]
    startedAt: str
    lastActiveAt: str
    closedAt: str | None = None
    endpoints: EndpointCounts


class Refusal(Meta):
    """W6-D9 — one tool call a boundary refused during a session. `boundary`
    is the composed id, `<node path>/<id>`, so the row names what did it."""
    tool: str
    said: str = ""
    boundary: str
    at: str | None = None


class SessionView(SessionRow):
    commits: dict[str, str]
    slots: list[Json]                                # engine `Slot`
    preflight: Json | None = None                    # engine `PreflightReport`
    endpointsTally: list[Json]                       # engine `EndpointTally`
    revokedReason: str | None = None
    # The plan the session ran under (00 §4.5 `SpawnPlan`), posted with the
    # report: what the fence allowed and what it denied whatever else it allowed.
    hosts: list[str] | Literal["any"] | None = None
    deny: list[str] = []
    # W5-D14: the folder the session ran in and the machine it ran on, to the
    # owner alone (`null` for an admin reading it, and under `?as`).
    workspace: str | None = None
    host: str | None = None
    # W6-D9: the tool calls a boundary refused. Only the refusals — a session
    # makes hundreds of calls and none of the rest is a record of anything.
    refusals: list[Refusal] = []


# --- the edge walk (00 §4.7) ------------------------------------------------


class EdgeNode(Meta):
    kind: str
    id: str
    label: str


class EdgeLink(EdgeNode):
    via: str


class EdgeWalk(Meta):
    from_: EdgeNode | None = None
    restsOn: list[EdgeLink]
    restedOnBy: list[EdgeLink]

    model_config = ConfigDict(extra="allow", populate_by_name=True,
                              alias_generator=lambda name: "from" if name == "from_" else name)


# --- groups, grants, providers, vaults, assets (03 §4.5, §4.6) --------------


class SecretRef(Meta):
    vault: str
    ref: str


class Attach(Meta):
    header: str
    prefix: str


class GroupEntry(Meta):
    """`policy/groups.json` verbatim (engine 00 §4.3): a `PATCH` replaces the
    whole list, so *Add an entry* (04 §8) needs the held ones as they are —
    a composite id cannot be edited back into an entry. `secret.ref` is a
    reference, never a value (`no_credential_value_in_any_response`)."""

    alias: str
    secret: SecretRef
    upstream: str | None = None
    attach: Attach | None = None


class GroupRow(Meta):
    name: str
    entries: list[GroupEntry]
    sources: str
    tier: ScaleTag | None = None
    teams: Related
    harnesses: Related
    narrowed: Related
    edges: EdgeWalk | None = None


class GrantRow(Meta):
    id: str
    group: str | None = None
    gives: Literal["entries", "reach"]
    entryCount: int
    sources: str | None = None
    teams: Related
    harnesses: Related
    narrowedFrom: str | None = None
    by: str | None = None
    at: str | None = None


class HarnessProviderRow(Meta):
    id: str
    # W6-D3: the runtime's own word for itself, from the contract. `None` for a
    # row written before `HarnessProvider.name` landed; the id is the fallback.
    name: str | None = None
    approval: str
    speaks: list[str] = []
    pin: Json = {}
    reason: str | None = None
    teams: Related
    canRun: Related


class RoutingDimensions(Meta):
    teams: list[str] = []
    harnesses: list[str] = []
    providers: list[str] = []


class RoutingSubject(Meta):
    """W6-D5: a thing a default or an approval can be set for, with the word a
    person reads for it — never a harness uuid or a bare runtime id."""

    id: str
    label: str


class RoutingSubjects(Meta):
    teams: list[RoutingSubject] = []
    harnesses: list[RoutingSubject] = []
    providers: list[RoutingSubject] = []


class ModelProviderRow(Meta):
    id: str
    endpoints: dict[str, str] = {}
    models: list[str] = []
    credential: str | None = None
    # W6-D6: *Reachable* became *Status* — `set-up` · `needs-key` ·
    # `unreachable`, the `providerStatus` scale. Not a `Fact`: two of the three
    # values are read off the composed policy and only the third is a probe,
    # and one column cannot be half observed and half declared.
    status: str
    groups: Related
    defaultFor: RoutingDimensions
    approvedFor: RoutingDimensions


class RoutingMatrix(Meta):
    defaultFor: Json                                 # engine `Routing`
    approvedFor: Json
    resolved: dict[str, TextFact]
    subjects: RoutingSubjects


class VaultRow(Meta):
    id: str
    handsUs: str
    issues: str
    contents: str
    reachable: Fact
    groups: Related


class SecretRow(Meta):
    ref: str
    group: str
    groups: Related
    ready: Fact
    lastUsed: str | None = None
    uncovered: bool
    dangling: bool


class OrgAssetRow(Meta):
    id: str
    kind: str
    name: str
    tree: str
    sidecar: Json                                    # engine `Sidecar`
    loads: ScaleTag
    # Which node this copy is on, the same word `BrowseRow.level` uses (D104).
    # One value at every scope but *You* on a personal account, where the list
    # is the organization's copies and the person's together and this is what
    # tells a seeded copy from one the person has edited.
    level: Literal["org", "team", "me"]
    harnesses: Related
    teams: Related
    groups: Related
    # W5-D9's *Last change*: the asset directory's own last commit on the node
    # holding this copy, read from the ref (declared, 03 §4). `None` when the
    # branch cannot be read — the cell degrades, the page does not 503.
    at: str | None = None
    edges: EdgeWalk | None = None


class AssetsPage(Page[OrgAssetRow]):
    """W5-D9: the kinds the screen's tabs are, in `policy/kinds.json` order —
    the organization's vocabulary, not the kinds that happen to have a row, so
    a kind with nothing in it is a tab reading zero rather than a tab that
    appears the day someone adds one."""

    kinds: list[str] = []


class BrowseRow(Meta):
    """W5-D15, the store's row: one asset the viewer could put in a harness.

    Not an `OrgAssetRow` cut down — a different question, so a different type.
    An asset row answers *what is on this branch* and carries the branch's
    relationships; a browse row answers *what could I use*, so it carries
    where the copy would come from and whether the person already holds one,
    and nothing else. The copies are the winning copy per id (`idx_effective`),
    which is why there is one row and not one per level.
    """

    id: str
    kind: str
    name: str
    description: str = ""
    # `preset` for a bundled asset the organization does not hold yet; else the
    # level of the node whose copy wins for this viewer.
    level: Literal["org", "team", "me", "preset"]
    # That node's own name, for the levels that have one. Empty at `me` and
    # `preset`, whose words the console writes (02 rule 26).
    from_: str = Field(default="", alias="from")
    # The asset page for the copy, at the level that holds it (00 D2). `None`
    # for a preset, which is on no branch and so has no page.
    href: str | None = None
    # Whether the viewer's **own** branch holds a copy. Everything in the list
    # reaches them; this says what is theirs.
    held: bool = False
    preset: bool = False
    # The environment a tool's sidecar names (engine 01 §5). Ticking the tool
    # ticks this environment too, and the confirmation says so.
    needsEnvironment: str | None = None


# --- logs, endpoints, people, teams (00 §4.8, §4.9) -------------------------


class LogRow(Meta):
    id: str
    at: str
    actor: PersonRef
    team: TeamRef | None = None
    action: str
    sentence: str
    diff: list[DiffHunk] | None = None
    ref: RefPointer | None = None


class AllowAction(BaseModel):
    """W5-D4: what the Endpoints tab's **Allow** may do on this row, and when it
    may not, the one sentence that says who decides instead."""

    can: bool
    # The `?scope=` the write takes — `org` or `team:<path>` — present only
    # when `can` is true.
    scope: str | None = None
    why: str | None = None


class EndpointRow(Meta):
    host: str
    port: int | None = None
    alias: str | None = None
    # W5-D4: one row per (host, outcome, reason). `reached` · `refused` ·
    # `stripped` — the third is a request that went with a provider-side
    # capability taken out of it (D134).
    outcome: str = "reached"
    reason: str | None = None
    # The node whose policy decided it, which is where **Allow** writes.
    setBy: str | None = None
    allow: AllowAction | None = None
    count: int
    refused: int
    firstAt: str
    lastAt: str
    sessions: int
    # PRD §19's join: the sessions behind the count, and the log row that says
    # where they came from.
    sessionIds: list[str] = []
    logId: str | None = None
    harnesses: Related


class ReachStep(BaseModel):
    """One node's own `policy/reach.json`, as the Reach section reads it: the
    walk root first, so *inherited* sits above *yours* (D131)."""

    node: str
    name: str
    mode: str
    hosts: list[str] = []
    when: str | None = None


class ReachView(Meta):
    scope: str
    effective: EffectiveReach
    chain: list[ReachStep] = []
    # W5-D5's starter allow-list, offered as one-click adds under `allow`.
    suggested: list[str] = []
    canEdit: bool = False


class PersonRow(Meta):
    # `id` is the person; an invited row has none yet and names its invite
    # instead, which is what `DELETE /v1/invites/{id}` takes.
    id: str
    invite: str | None = None
    name: str
    email: str
    # `teams` is every team on the chain, for the cell. The two paths below are
    # what a write needs: `team` is the node the membership hangs from (the
    # team, or the org for a personal account), `unit` the person's own node —
    # a removal names the first, a visibility change the second.
    team: str
    unit: str
    teams: Related
    role: ScaleTag
    lastActive: str | None = None
    state: Literal["active", "invited", "deactivated"]


class TeamRow(Meta):
    id: str | None = None
    path: str
    name: str
    parent: str | None = None
    children: Related
    people: int
    groups: Related
    admins: Related


class Lost(Meta):
    group: str
    via: str


class KeyToRotate(Meta):
    ref: str
    group: str


class RemovalPreview(Meta):
    person: PersonRow
    loses: list[Lost]
    sharedKeysToRotate: list[KeyToRotate]
