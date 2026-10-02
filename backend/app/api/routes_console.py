"""`GET /v1/console/*` — every console read (00 §4.10, 03 §4).

Thin by construction: a route resolves the viewer and the scope once, calls
one function in `domain/console.py`, and returns it. Three rules hold here and
are worth stating because a fourth route will be added by someone else:

* **`GET` only.** A write under `/v1/console/` is a bug (03 §8.8); the writes
  the console uses are the shared resource endpoints of 00 §4.11.
* **One response model per 00 §4 type**, named for it, so the generated
  `lib/api.generated.ts` carries the plan's names (03 §8.10). They live in
  `domain/console_models.py`, which is where to read the contract.
* **One envelope.** Lists are `{ items, next }`; every response may carry
  `stale` (the index is behind — flagged, never refused, 03 D38) and `hidden`
  (an organisation admin has turned this view off, P10).
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import current_principal
from app.db import get_pool
from app.domain import console
from app.domain.console_models import (
    AssetsPage,
    BoundaryRow,
    BrowseRow,
    DiffHunk,
    EdgeWalk,
    EndpointRow,
    FileView,
    GrantRow,
    GroupRow,
    HarnessCard,
    HarnessProviderRow,
    HarnessView,
    HistoryRow,
    HowThisWorks,
    LogRow,
    ModelProviderRow,
    OrgAssetRow,
    Page,
    PersonRow,
    ReachView,
    RemovalPreview,
    RequestView,
    RoutingMatrix,
    SearchHits,
    SecretRow,
    SessionRow,
    SessionView,
    SuggestedCommands,
    TeamRow,
    VaultRow,
    Viewer,
)
from app.domain.sentences import SCALES
from app.identity import Principal

router = APIRouter(prefix="/console", tags=["console"])


# --- the one place a request becomes a viewer ------------------------------


async def viewer_of(
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    scope: Annotated[str | None, Query()] = None,
    as_user: Annotated[UUID | None, Query(alias="as")] = None,
) -> AsyncIterator[console.Ctx]:
    # One connection for the whole request. Every read below is a round trip
    # to the database, and taking a pooled connection per query paid a second
    # one on each release; the reads never write, so one connection is also
    # never a lock held across the request.
    async with get_pool(request).acquire() as connection:
        yield await console.context(connection, principal, scope, as_user, request.url.path)


Ctx = Annotated[console.Ctx, Depends(viewer_of)]
Cursor = Annotated[str | None, Query()]
Limit = Annotated[int, Query(ge=1, le=console.MAX_LIMIT)]


def listing(ctx: console.Ctx, rows: list[dict], cursor: str | None, limit: int,
            key: Any = None, hidden: dict | None = None) -> dict:
    if hidden:
        return {"items": [], "next": None, "stale": ctx.stale, "hidden": hidden}
    built = console.page(rows, limit, cursor, key) if key else console.page(rows, limit, cursor)
    return built | {"stale": ctx.stale}


def _by(field: str) -> Any:
    return lambda row: (str(row.get(field) or ""), str(row.get("id") or row.get(field) or ""))


# --- shell ------------------------------------------------------------------


@router.get("/me", response_model=Viewer)
async def read_viewer(ctx: Ctx) -> dict:
    # `id` is the `org_units` row: the sidebar links by path (00 D2) and the
    # write routes of 00 §4.11 take the id, so the viewer carries both.
    ids = {row["path"]: str(row["id"]) for row in await ctx.pool.fetch(
        "select id, path from org_units where path = any($1::text[])",
        [node["path"] for node in ctx.chain])}
    teams = [{"id": ids.get(node["path"]), "path": node["path"],
              "name": console.node_label(node["path"]),
              "admin": ctx.role["at"] is not None and node["path"].startswith(ctx.role["at"])}
             for node in ctx.chain if node["kind"] == "team"]
    return {
        "user": {"id": str(ctx.viewer), "email": ctx.viewer_email, "name": ctx.viewer_email},
        "chain": ctx.chain, "role": ctx.role, "edition": ctx.edition, "staff": ctx.staff,
        "teams": teams, "visibility": ctx.visibility,
        # 01 §4.4: the sidebar shows what the viewer manages *here*, so this
        # answer is only true of the scope it was asked with. `?scope=` is
        # read by `viewer_of` like every other console read.
        "adminHere": ctx.admin_here,
        # W7-D5: what the person has already done, for the Account screen's
        # *Getting started* list. Four booleans-and-a-word: they name no path
        # and no machine, so they are answered under `?as` like the rest.
        "setup": await console.setup_facts(ctx),
        "waiting": await _waiting(ctx), "stale": ctx.stale,
    }


async def _waiting(ctx: console.Ctx) -> dict[str, int]:
    """03 §4.1: the sidebar's counts, and a key is absent when there is none."""
    if ctx.role["at"] is None:
        return {}
    rows = await ctx.pool.fetch(
        """select r.subject_kind, count(*) n from requests r
             join org_units u on u.id = r.org_unit_id
            where r.state='open' and (u.path = $1 or u.path like $1 || '.%')
            group by 1""", ctx.role["at"])
    counts = {"promotion": "harnesses", "role": "people", "publish": "people"}
    waiting: dict[str, int] = {}
    for row in rows:
        key = counts.get(row["subject_kind"])
        if key:
            waiting[key] = waiting.get(key, 0) + row["n"]
    return waiting


@router.get("/search", response_model=SearchHits)
async def read_search(ctx: Ctx, q: Annotated[str, Query(min_length=1, max_length=120)]) -> dict:
    return {"items": await console.search(ctx, q), "stale": ctx.stale}


@router.get("/how", response_model=HowThisWorks)
async def read_how() -> dict:
    """03 D36: served by `api` so the CLI and the console print one set of
    words (P14). The registry is the whole list (K4)."""
    return {"scales": SCALES, "categories": ["harness", "permission", "provider", "people"]}


# --- harnesses, files, requests --------------------------------------------


@router.get("/harnesses", response_model=Page[HarnessCard])
async def read_harnesses(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.cards(ctx), cursor, limit)


@router.get("/harnesses/{harness_id}", response_model=HarnessView)
async def read_harness(ctx: Ctx, harness_id: UUID,
                       version: Annotated[str, Query()] = "mine") -> dict:
    return await console.harness_view(ctx, harness_id, version) | {"stale": ctx.stale}


@router.get("/harnesses/{harness_id}/files/{asset_id}", response_model=FileView)
async def read_file(ctx: Ctx, harness_id: UUID, asset_id: str,
                    version: Annotated[str, Query()] = "mine") -> dict:
    """`?version` follows the compare control (04 §6): `content.mine` is the
    selected version's copy, `content.team` always the team's."""
    return await console.file_view(ctx, harness_id, asset_id, version) | {"stale": ctx.stale}


@router.get("/harnesses/{harness_id}/history", response_model=Page[HistoryRow])
async def read_harness_history(ctx: Ctx, harness_id: UUID,
                               version: Annotated[str, Query()] = "mine",
                               cursor: Cursor = None, limit: Limit = 50) -> dict:
    """04 §5's History view, which had no source: the commits behind this
    harness on the selected version, from `definitions:/internal/log` through
    `api` (00 D8). Adds one row to 00 §4.10."""
    rows = await console.harness_history(ctx, harness_id, version, limit)
    return listing(ctx, rows, cursor, limit, _by("at"))


@router.get("/harnesses/{harness_id}/requests", response_model=Page[RequestView])
async def read_harness_requests(ctx: Ctx, harness_id: UUID,
                                state: Annotated[Literal["open", "closed"], Query()] = "open",
                                cursor: Cursor = None, limit: Limit = 50) -> dict:
    rows = await console.request_views(ctx, harness_id, state)
    return listing(ctx, rows, cursor, limit, _by("at"))


@router.get("/requests/{request_id}", response_model=RequestView)
async def read_request(ctx: Ctx, request_id: UUID) -> dict:
    rows = await console.request_views(ctx, None, "open", request_id)
    if not rows:
        raise console.fail("request.not_visible")
    return rows[0] | {"stale": ctx.stale}


# --- sessions ---------------------------------------------------------------


@router.get("/sessions", response_model=Page[SessionRow])
async def read_sessions(ctx: Ctx, person: Annotated[UUID | None, Query()] = None,
                        harness: Annotated[UUID | None, Query()] = None,
                        status: Annotated[str | None, Query()] = None,
                        cursor: Cursor = None, limit: Limit = 50) -> dict:
    rows = await console.session_rows(ctx, person, harness, status)
    return listing(ctx, rows, cursor, limit, _by("lastActiveAt"))


@router.get("/sessions/{session_id}", response_model=SessionView)
async def read_session(ctx: Ctx, session_id: UUID) -> dict:
    return await console.session_view(ctx, session_id) | {"stale": ctx.stale}


# --- groups, grants, boundaries ---------------------------------------------


@router.get("/groups", response_model=Page[GroupRow])
async def read_groups(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.group_rows(ctx), cursor, limit, _by("name"))


@router.get("/groups/{name}", response_model=GroupRow)
async def read_group(ctx: Ctx, name: str) -> dict:
    rows = [row for row in await console.group_rows(ctx) if row["name"] == name]
    if not rows:
        raise console.fail("console.not_found", what="security group")
    return rows[0] | {"edges": await console.edge_walk(ctx, "group", name), "stale": ctx.stale}


@router.get("/grants", response_model=Page[GrantRow])
async def read_grants(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.grant_rows(ctx), cursor, limit, _by("id"))


@router.get("/boundaries", response_model=Page[BoundaryRow])
async def read_boundaries(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    hidden = ctx.hidden("boundaries")
    rows = [] if hidden else await console.boundary_rows(ctx)
    return listing(ctx, rows, cursor, limit, _by("value"), hidden)


@router.get("/boundaries/suggested", response_model=SuggestedCommands)
async def read_suggested_commands(ctx: Ctx) -> dict:
    """W6-D10. The starter set of command boundaries, for Boundaries →
    Commands. Its own route rather than a field on `Page[BoundaryRow]`:
    `Page[T]` is the one listing shape every table reads and is not widened
    for one screen. A viewer whose boundary list is hidden (P10) is offered
    nothing, because an add they cannot see the result of is not an offer."""
    if ctx.hidden("boundaries"):
        return {"suggested": [], "canEdit": False} | {"stale": ctx.stale}
    return await console.suggested_commands(ctx) | {"stale": ctx.stale}


# --- providers, routing, vaults, assets -------------------------------------


@router.get("/providers/harness", response_model=Page[HarnessProviderRow])
async def read_harness_providers(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.harness_provider_rows(ctx), cursor, limit, _by("id"))


@router.get("/providers/model", response_model=Page[ModelProviderRow])
async def read_model_providers(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.model_provider_rows(ctx), cursor, limit, _by("id"))


@router.get("/routing", response_model=RoutingMatrix)
async def read_routing(ctx: Ctx) -> dict:
    return await console.routing_matrix(ctx) | {"stale": ctx.stale}


@router.get("/vaults", response_model=Page[VaultRow])
async def read_vaults(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.vault_rows(ctx), cursor, limit, _by("id"))


@router.get("/vaults/{vault_id}/secrets", response_model=Page[SecretRow])
async def read_secrets(ctx: Ctx, vault_id: str, cursor: Cursor = None,
                       limit: Limit = 50) -> dict:
    return listing(ctx, await console.secret_rows(ctx, vault_id), cursor, limit, _by("ref"))


@router.get("/assets", response_model=AssetsPage)
async def read_assets(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    """W5-D9: this level's own copies, with the organisation's kind vocabulary
    beside them — the screen's tabs are the kinds, empty ones included."""
    built = await console.policy(ctx)
    return listing(ctx, await console.asset_rows(ctx), cursor, limit, _by("name")) | {
        "kinds": built["kinds"]}


@router.get("/assets/browse", response_model=Page[BrowseRow])
async def read_browse(ctx: Ctx, cursor: Cursor = None, limit: Limit = 200) -> dict:
    """W5-D15, the store: everything the viewer can use — the winning copy of
    every asset on their chain, and the bundled presets the organisation does
    not hold yet. Declared **before** `/assets/{asset_id}`, which would
    otherwise read `browse` as an id.

    `visibility.store: false` answers `hidden` in place of the list (P10): a
    closed view says so and is never a shorter one.
    """
    hidden = ctx.hidden("store")
    rows = [] if hidden else await console.browse_rows(ctx)
    return listing(ctx, rows, cursor, limit, _by("name"), hidden)


@router.get("/assets/{asset_id}", response_model=OrgAssetRow)
async def read_asset(ctx: Ctx, asset_id: str) -> dict:
    rows = [row for row in await console.asset_rows(ctx) if row["id"] == asset_id]
    if not rows:
        raise console.fail("console.not_found", what="asset")
    return rows[0] | {"edges": await console.edge_walk(ctx, "asset", asset_id),
                      "stale": ctx.stale}


# --- logs, endpoints, the edge walk -----------------------------------------


@router.get("/logs/{category}", response_model=Page[LogRow])
async def read_logs(ctx: Ctx,
                    category: Literal["harness", "permission", "provider", "people"],
                    cursor: Cursor = None, limit: Limit = 50) -> dict:
    hidden = ctx.hidden("logs")
    if hidden:
        return {"items": [], "next": None, "stale": ctx.stale, "hidden": hidden}
    return await console.log_rows(ctx, category, cursor, limit) | {"stale": ctx.stale}


@router.get("/logs/{category}/{log_id}/diff", response_model=list[DiffHunk])
async def read_log_diff(ctx: Ctx, category: str, log_id: int) -> list[dict]:
    return await console.log_diff(ctx, log_id)


@router.get("/endpoints", response_model=Page[EndpointRow])
async def read_endpoints(ctx: Ctx, days: Annotated[int, Query(ge=1, le=365)] = 30,
                         cursor: Cursor = None, limit: Limit = 50) -> dict:
    hidden = ctx.hidden("logs")
    since = datetime.now(UTC) - timedelta(days=days)
    rows = [] if hidden else await console.endpoint_rows(ctx, since)
    return listing(ctx, rows, cursor, limit, _by("lastAt"), hidden)


@router.get("/reach", response_model=ReachView)
async def read_reach(ctx: Ctx) -> dict:
    """D131. The Boundaries screen's Reach section, and what the Endpoints
    tab's **Allow** writes against. Read by anyone on the scope — knowing how
    far your own sessions reach is not an admin's privilege — and `canEdit`
    says whether the four writes of 00 §4.11 will take this viewer."""
    return await console.reach_view(ctx) | {"stale": ctx.stale}


@router.get("/edges", response_model=EdgeWalk)
async def read_edges(ctx: Ctx, kind: Annotated[str, Query()], id: Annotated[str, Query()]) -> dict:
    return await console.edge_walk(ctx, kind, id) | {"stale": ctx.stale}


# --- people and teams -------------------------------------------------------


@router.get("/people", response_model=Page[PersonRow])
async def read_people(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.person_rows(ctx), cursor, limit, _by("name"))


@router.get("/people/{person_id}", response_model=PersonRow)
async def read_person(ctx: Ctx, person_id: UUID) -> dict:
    return await console.person_detail(ctx, person_id) | {"stale": ctx.stale}


@router.get("/people/{person_id}/removal", response_model=RemovalPreview)
async def read_removal(ctx: Ctx, person_id: UUID) -> dict:
    return await console.removal_preview(ctx, person_id) | {"stale": ctx.stale}


@router.get("/teams", response_model=Page[TeamRow])
async def read_teams(ctx: Ctx, cursor: Cursor = None, limit: Limit = 50) -> dict:
    return listing(ctx, await console.team_rows(ctx), cursor, limit, _by("path"))
