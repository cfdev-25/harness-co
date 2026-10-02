import base64
import json
from datetime import UTC
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.api.deps import (
    can_read,
    current_principal,
    current_user_unit,
    is_admin,
    require_admin,
    require_write,
)
from app.db import get_pool, transaction
from app.domain.asset_store import decode_files, lint_files, push_version
from app.domain.audit import append_event
from app.domain.harnesses import visible_harness
from app.domain.org_tree import effective_boundary
from app.domain.resolve import (
    ancestor_version,
    descendant_owners,
    shadowed_copy,
    subtree_owner,
    version_files,
)
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["assets"])

# docs/archive/scoping.md §5.3, §5.5: a connection is a pointer to a credential the
# Every asset kind is content and may be overridden — including `connection`,
# which is a config file naming a credential, not the credential itself
# (docs/archive/scoping.md §5.5). The credential stays the owner's: `asset_scopes`
# carries a per-recipient `key_ref`, so who gets which key is decided by
# whoever owns the asset and never by the recipient.
#
# The administration surfaces that genuinely are top-down — boundary,
# connectors, people, audit — are not assets and never reach this code, so
# there is no kind here to suppress.
RESOLUTIONS = ["rename", "take_theirs", "keep_mine", "merge"]


class FileInput(BaseModel):
    path: str
    content_b64: str


class AssetCreate(BaseModel):
    org_unit_id: UUID
    kind: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=500)
    files: list[FileInput]
    # The ancestor VERSION id a 409 name_collision named, echoed back to say
    # "yes, I saw that and I am choosing to override it anyway" — docs/
    # scoping.md §5.2's "keep mine" and "merge" resolutions. It must match
    # what is colliding *now*, the same optimistic-concurrency shape push
    # already uses for `parent_version_id` (asset_store.push_version).
    override_of: UUID | None = None


class VersionCreate(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    parent_version_id: UUID | None
    files: list[FileInput]
    # Confirms "keep mine" for a collision raised at scope-grant time (docs/
    # scoping.md §5.2(c)): the asset already exists here, so no new name is
    # being created, but the admin scoping an ancestor's copy down to this
    # unit is refused (`set_asset_scopes`) until this unit's own version
    # records that it knowingly overrides it.
    override_of: UUID | None = None


class AssetUpdate(BaseModel):
    status: Literal["active", "archived"]


class HarnessAssignment(BaseModel):
    harness_ids: list[UUID] = Field(default_factory=list, max_length=200)


class ScopeGrant(BaseModel):
    org_unit_id: UUID
    key_ref: str | None = None


class ScopeReplace(BaseModel):
    scopes: list[ScopeGrant] = Field(default_factory=list, max_length=500)


class PromoteInput(BaseModel):
    target_org_unit_id: UUID
    message: str | None = None


class RollbackInput(BaseModel):
    to_version_id: UUID


async def _visible_refs(connection, org_unit_id: UUID) -> set[str]:
    rows = await connection.fetch(
        """with recursive chain as (
             select id,parent_id from org_units where id=$1
             union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
           ) select k.ref from api_keys k join chain c on c.id=k.org_unit_id""",
        org_unit_id,
    )
    return {row["ref"] for row in rows}


async def _harness_ids(connection, asset) -> list[str]:
    """Harnesses at or above this asset's unit that contain its name.

    At or above, because those are the harnesses whose audience this asset
    can reach. Someone's personal harness may also name it; that is their
    business and shows on their own harness screen.
    """
    rows = await connection.fetch(
        """with recursive chain as (
             select id,parent_id from org_units where id=$1
             union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
           )
           select h.id::text id
             from harness_assets a
             join harnesses h on h.id=a.harness_id
             join chain c on c.id=h.org_unit_id
            where a.kind=$2 and a.name=$3
            order by 1""",
        asset["org_unit_id"],
        asset["kind"],
        asset["name"],
    )
    return [row["id"] for row in rows]


async def _scope_rows(connection, asset_id: UUID) -> list[dict]:
    rows = await connection.fetch(
        """select s.org_unit_id, u.path org_unit_path, s.key_ref
             from asset_scopes s join org_units u on u.id=s.org_unit_id
            where s.asset_id=$1
            order by u.path""",
        asset_id,
    )
    return [dict(row) for row in rows]


async def _asset_access(connection, principal, user_unit, asset_id):
    asset = await connection.fetchrow("select * from assets where id=$1", asset_id)
    if not asset:
        raise ApiError(404, "asset_not_found", "This asset could not be found.")
    if not await can_read(connection, principal, user_unit["id"], asset["org_unit_id"]):
        raise ApiError(403, "asset_not_visible", "You do not have access to this asset.")
    return asset


async def _require_within_subtree(connection, owning_unit_id: UUID, target_ids: set[UUID]) -> None:
    """Refuse any scope target outside the owning unit's own subtree.

    A scope row means "this unit and everything beneath it" (0022_asset_scopes.sql),
    so a target has to be the owning unit itself or somewhere under it — that is
    what lets the owner reach its own descendants. Anything else would let the
    asset reach sideways through the tree, which docs/archive/scoping.md §0 forbids: a
    unit sees what it owns plus what an ancestor scoped to it, never what a
    cousin branch decided to hand it.
    """
    rows = await connection.fetch(
        """with recursive subtree as (
             select id from org_units where id=$1
             union all select o.id from org_units o join subtree s on o.parent_id=s.id
           ) select id from subtree where id=any($2::uuid[])""",
        owning_unit_id,
        list(target_ids),
    )
    in_subtree = {row["id"] for row in rows}
    outside = sorted(target_ids - in_subtree, key=str)
    if outside:
        raise ApiError(
            422,
            "scope_target_outside_subtree",
            f"Org unit {outside[0]} is not part of this asset's owning unit's subtree.",
            {"org_unit_id": str(outside[0])},
        )


@router.get("/org-units/{org_unit_id}/assets")
async def list_assets(
    org_unit_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    """Owned here, inherited from above, and published below.

    A session still resolves only ancestors (nearest live name wins). The
    extra rows are the ones further down the tree, so an org can see what
    its teams and people have. Each fork is its own asset id; names may
    repeat. Rows the caller cannot read are dropped.
    """
    pool = get_pool(request)
    if not await can_read(pool, principal, user_unit["id"], org_unit_id):
        raise ApiError(403, "org_unit_not_visible", "You do not have access to this org unit.")
    rows = await pool.fetch(
        """with recursive
           up as (
             select id,parent_id,0 depth from org_units where id=$1
             union all select p.id,p.parent_id,c.depth+1
             from org_units p join up c on c.parent_id=p.id
           ), down as (
             select id,parent_id,0 depth from org_units where id=$1
             union all select u.id,u.parent_id,d.depth+1
             from org_units u join down d on u.parent_id=d.id
           ), my_chain as (
             select id,parent_id from org_units where id=$2
             union all select p.id,p.parent_id
             from org_units p join my_chain c on c.parent_id=p.id
           ), admin_subtree as (
             select u.id,u.parent_id from org_units u
               join org_unit_admins a on a.org_unit_id=u.id and a.auth_user_id=$3
             union all select u.id,u.parent_id
             from org_units u join admin_subtree s on u.parent_id=s.id
           ), readable as (
             select id from my_chain
             union
             select id from admin_subtree
           ), visible as (
             select id from assets where org_unit_id=$1
             union
             select id from (
               select a.id, row_number() over(
                        partition by a.kind,a.name order by c.depth
                      ) rn
                 from up c
                 join assets a on a.org_unit_id=c.id and a.status='active'
             ) winners where rn=1
             union
             select a.id from down d
             join assets a on a.org_unit_id=d.id
             where d.depth>0
           )
           select a.*,u.path org_unit_path,
                  case
                    when a.org_unit_id=$1 then 'owned'
                    when exists(select 1 from up c where c.id=a.org_unit_id and c.depth>0)
                      then 'inherited'
                    else 'below'
                  end as origin,
                  v.seq head_seq,v.message head_message,v.created_at head_updated_at,
                  coalesce((select array_agg(h.id::text order by h.id)
                              from harness_assets ha
                              join harnesses h on h.id=ha.harness_id
                              join org_units hu on hu.id=h.org_unit_id
                              join org_units au on au.id=a.org_unit_id
                             where ha.kind=a.kind and ha.name=a.name
                               and (au.path = hu.path or au.path like hu.path || '.%')), '{}')
                  harness_ids
           from assets a
           join visible vis on vis.id=a.id
           join readable r on r.id=a.org_unit_id
           join org_units u on u.id=a.org_unit_id
           left join asset_versions v on v.id=a.head_version_id
           order by case
                      when a.org_unit_id=$1 then 0
                      when exists(select 1 from up c where c.id=a.org_unit_id and c.depth>0)
                        then 1
                      else 2
                    end,
                    a.kind, a.name, u.path""",
        org_unit_id,
        user_unit["id"],
        principal.auth_user_id,
    )
    return [dict(row) for row in rows]


@router.get("/assets/{asset_id}")
async def get_asset(
    asset_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    pool = get_pool(request)
    asset = await _asset_access(pool, principal, user_unit, asset_id)
    return {**dict(asset), "harness_ids": await _harness_ids(pool, asset)}


@router.patch("/assets/{asset_id}")
async def update_asset(
    asset_id: UUID,
    body: AssetUpdate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    """Archiving is how an asset is switched off.

    `resolved_assets` only reads active rows, so an archived asset stops
    reaching sessions while every version of it stays where it is.
    """
    async with transaction(get_pool(request)) as connection:
        asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_write(connection, principal, user_unit["id"], asset["org_unit_id"])
        row = await connection.fetchrow(
            "update assets set status=$2 where id=$1 returning *", asset_id, body.status
        )
        await append_event(
            connection,
            org_unit_id=asset["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.status",
            payload={"asset_id": str(asset_id), "status": body.status},
        )
        return dict(row)


@router.put("/assets/{asset_id}/harnesses")
async def set_asset_harnesses(
    asset_id: UUID,
    body: HarnessAssignment,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    """Which harnesses contain this asset's name.

    The same table the harness screen writes, from the other side. What is
    stored is the (kind, name), so this reads as "put triage in Support" —
    and whoever's triage wins for a given user is the one they get.

    Changing a harness needs write access to *that harness*, not to this
    asset: the list belongs to the harness. Naming something grants nobody
    access to it, because resolution is unchanged.
    """
    async with transaction(get_pool(request)) as connection:
        asset = await _asset_access(connection, principal, user_unit, asset_id)
        current = set(await _harness_ids(connection, asset))
        wanted = {str(item) for item in body.harness_ids}
        for harness_id in sorted(current ^ wanted):
            harness = await visible_harness(connection, user_unit["id"], UUID(harness_id))
            await require_write(connection, principal, user_unit["id"], harness["org_unit_id"])
        for harness_id in sorted(current - wanted):
            await connection.execute(
                "delete from harness_assets where harness_id=$1 and kind=$2 and name=$3",
                UUID(harness_id),
                asset["kind"],
                asset["name"],
            )
        for harness_id in sorted(wanted - current):
            await connection.execute(
                """insert into harness_assets(harness_id,kind,name) values($1,$2,$3)
                   on conflict do nothing""",
                UUID(harness_id),
                asset["kind"],
                asset["name"],
            )
        if current != wanted:
            await append_event(
                connection,
                org_unit_id=asset["org_unit_id"],
                actor_type="user",
                actor_id=principal.auth_user_id,
                event_class="authoritative",
                action="asset.harnesses",
                payload={
                    "asset_id": str(asset_id),
                    "kind": asset["kind"],
                    "name": asset["name"],
                    "harness_ids": sorted(wanted),
                },
            )
        return {"harness_ids": await _harness_ids(connection, asset)}


@router.get("/assets/{asset_id}/scopes")
async def list_asset_scopes(
    asset_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    """The units this asset currently reaches. Readable by anyone who can read
    the asset itself — seeing reach is not the sensitive half; changing it is.
    """
    pool = get_pool(request)
    asset = await _asset_access(pool, principal, user_unit, asset_id)
    return await _scope_rows(pool, asset["id"])


@router.put("/assets/{asset_id}/scopes")
async def set_asset_scopes(
    asset_id: UUID,
    body: ScopeReplace,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    """Replace who this asset reaches, per docs/archive/scoping.md §3.

    Write access is checked at the asset's *owning* unit, not the caller's
    own: scoping is the owner's act, the same authority `create_version`
    already requires to change the asset at all. The whole set is deleted and
    reinserted inside one transaction, so nobody outside this connection ever
    observes the old grants gone and the new ones not yet written.
    """
    async with transaction(get_pool(request)) as connection:
        asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_write(connection, principal, user_unit["id"], asset["org_unit_id"])
        wanted = {item.org_unit_id: item.key_ref for item in body.scopes}
        await _require_within_subtree(connection, asset["org_unit_id"], set(wanted))
        current = {
            row["org_unit_id"]: row["key_ref"]
            for row in await connection.fetch(
                "select org_unit_id, key_ref from asset_scopes where asset_id=$1", asset_id
            )
        }
        added = sorted(wanted.keys() - current.keys(), key=str)
        removed = sorted(current.keys() - wanted.keys(), key=str)
        # docs/archive/scoping.md §5.2(c): granting reach to a unit whose own subtree
        # already owns this (kind, name) would silently create the shadow
        # §5.2 forbids creating without a person choosing it — the org's
        # `crm` reaching a team that already wrote its own. Only *newly*
        # added units are checked: re-sending a set that already included a
        # unit must stay idempotent, and a unit already holding the grant was
        # already surfaced (or resolved) the first time it was added.
        for unit_id in added:
            collision = await subtree_owner(
                connection, unit_id, asset["kind"], asset["name"], excluding=asset_id
            )
            if not collision:
                continue
            if dict(collision["provenance"]).get("override_of") == str(asset_id):
                continue  # already knowingly kept — not a new collision
            raise ApiError(
                409,
                "name_collision",
                f"{collision['org_unit_path']} already has its own "
                f"'{asset['kind']}/{asset['name']}'. Scoping this one there "
                "would silently take it over.",
                {
                    "asset_id": str(asset_id),
                    "org_unit_id": str(unit_id),
                    "colliding_asset_id": str(collision["asset_id"]),
                    "colliding_org_unit_id": str(collision["org_unit_id"]),
                    "colliding_org_unit_path": collision["org_unit_path"],
                    "resolutions": RESOLUTIONS,
                },
            )
        # A credential swap on a unit that stays scoped changes no membership,
        # so `added` and `removed` are both empty and nothing would be recorded
        # — while the recipient's access silently changes from one key to
        # another. That is the escalation an audit is most needed for.
        recredentialed = sorted(
            (
                {
                    "org_unit_id": str(unit_id),
                    "from": current[unit_id],
                    "to": wanted[unit_id],
                }
                for unit_id in wanted.keys() & current.keys()
                if wanted[unit_id] != current[unit_id]
            ),
            key=lambda entry: entry["org_unit_id"],
        )
        await connection.execute("delete from asset_scopes where asset_id=$1", asset_id)
        for org_unit_id, key_ref in wanted.items():
            await connection.execute(
                """insert into asset_scopes(asset_id, org_unit_id, key_ref, granted_by)
                   values ($1,$2,$3,$4)""",
                asset_id,
                org_unit_id,
                key_ref,
                principal.auth_user_id,
            )
        if added or removed or recredentialed:
            # Authoritative: who could use this asset, and from when, is
            # exactly the question an audit exists to answer — the resulting
            # set alone cannot answer it once the old rows are gone.
            await append_event(
                connection,
                org_unit_id=asset["org_unit_id"],
                actor_type="user",
                actor_id=principal.auth_user_id,
                event_class="authoritative",
                action="asset.scopes",
                payload={
                    "asset_id": str(asset_id),
                    "added": [str(unit_id) for unit_id in added],
                    "removed": [str(unit_id) for unit_id in removed],
                    # References, never values — a `secret://` ref is what the
                    # console and `harness doctor` already show.
                    "recredentialed": recredentialed,
                },
            )
        return await _scope_rows(connection, asset_id)


@router.get("/assets/{asset_id}/lineage")
async def lineage(
    asset_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    """The same (kind, name) everywhere it exists above and below this asset.

    An asset resolves from the nearest active ancestor, so this is what tells
    someone whether their own copy still matches the one they took it from:
    `promoted_from_seq` is the version they copied, and the source row's `seq`
    is where that source has since got to.
    """
    pool = get_pool(request)
    asset = await _asset_access(pool, principal, user_unit, asset_id)
    rows = await pool.fetch(
        """with recursive up as (
             select id,parent_id from org_units where id=$1
             union all select p.id,p.parent_id from org_units p join up c on c.parent_id=p.id
           ), down as (
             select id,parent_id from org_units where id=$1
             union all select u.id,u.parent_id from org_units u join down d on u.parent_id=d.id
           ), related as (select id from up union select id from down)
           select u.id org_unit_id,u.name,u.role,u.path,
                  a.id asset_id,a.status,
                  v.id version_id,v.seq,v.created_at updated_at,
                  src.asset_id promoted_from_asset_id,src.seq promoted_from_seq,
                  -- The exact version this copy forked from, when it is
                  -- known — the common ancestor a merge (docs/archive/scoping.md
                  -- §5.2) needs, distinct from `promoted_from_seq`, which is
                  -- only a number and cannot be fetched by itself.
                  src.id promoted_from_version_id,
                  -- Which asset this copy's live version has already, and
                  -- knowingly, chosen to override — null on a shadow made
                  -- before this shipped, so the console can tell the two
                  -- apart instead of re-asking a question already answered.
                  v.provenance->>'override_of' override_of
             from related r
             join org_units u on u.id=r.id
             join assets a on a.org_unit_id=u.id and a.kind=$2 and a.name=$3
             left join asset_versions v on v.id=a.head_version_id
             left join asset_versions src on src.id=(v.provenance->>'promoted_from')::uuid
            order by u.path""",
        asset["org_unit_id"],
        asset["kind"],
        asset["name"],
    )
    visible = []
    for row in rows:
        if await can_read(pool, principal, user_unit["id"], row["org_unit_id"]):
            visible.append(dict(row))
    return visible


@router.post("/assets", status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    files = decode_files([item.model_dump() for item in body.files])
    async with transaction(get_pool(request)) as connection:
        await require_write(connection, principal, user_unit["id"], body.org_unit_id)
        lint_files(
            files,
            await effective_boundary(connection, body.org_unit_id),
            await _visible_refs(connection, body.org_unit_id),
        )
        known = await connection.fetchval(
            "select exists(select 1 from asset_kinds where kind=$1)", body.kind
        )
        if not known:
            rows = await connection.fetch("select kind from asset_kinds order by kind")
            kinds = ", ".join(row["kind"] for row in rows)
            raise ApiError(
                422,
                "unknown_asset_kind",
                f"Unknown kind '{body.kind}'. Known kinds: {kinds}.",
            )
        # docs/archive/scoping.md §5.2(a): a name an ancestor already has, reaching
        # here, is a collision the moment it is created — not something that
        # silently becomes a personal override. `override_of` is how the
        # console says a person already chose to override it; anything else
        # (including a stale version id from a collision that has since
        # moved) is refused with the same detail a fresh push would get.
        collision = await shadowed_copy(connection, body.org_unit_id, body.kind, body.name)
        if collision and body.override_of == collision["version_id"]:
            # Recorded by asset id, not version id: identity is what an
            # override is about ("I am consciously keeping mine instead of
            # that asset"), and it must keep meaning the same thing after the
            # overridden asset gains later versions. `override_of` on the
            # wire is the version id instead, purely so the client proves it
            # saw *this* collision rather than a stale one — the same
            # optimistic-concurrency shape as push's `parent_version_id`.
            provenance_override: dict = {"override_of": str(collision["asset_id"])}
        elif collision:
            raise ApiError(
                409,
                "name_collision",
                f"'{body.kind}/{body.name}' already exists at {collision['org_unit_path']}.",
                {
                    "asset_id": str(collision["asset_id"]),
                    "org_unit_id": str(collision["org_unit_id"]),
                    "org_unit_path": collision["org_unit_path"],
                    "version_id": str(collision["version_id"]),
                    "version_seq": collision["seq"],
                    "files": await version_files(connection, dict(collision["file_hashes"])),
                    "resolutions": RESOLUTIONS,
                },
            )
        elif body.override_of is not None:
            raise ApiError(422, "invalid_override", "There is no collision here to override.")
        else:
            provenance_override = {}
        asset = await connection.fetchrow(
            """insert into assets(org_unit_id,kind,name) values($1,$2,$3) returning *""",
            body.org_unit_id,
            body.kind,
            body.name,
        )
        pending = (await effective_boundary(connection, body.org_unit_id)).get(
            "build_policy", {}
        ).get("push_review", False) and not await is_admin(
            connection, principal.auth_user_id, body.org_unit_id
        )
        provenance = {"pending_review": True} if pending else {}
        provenance.update(provenance_override)
        version = await push_version(
            connection,
            asset_id=asset["id"],
            parent_version_id=None,
            files=files,
            author_id=principal.auth_user_id,
            message=body.message,
            provenance=provenance,
            make_head=not pending,
        )
        await append_event(
            connection,
            org_unit_id=body.org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.create",
            payload={"asset_id": str(asset["id"]), "version_id": str(version["id"])},
        )
        # docs/archive/scoping.md §5.2(b): informational only. Until this name is
        # scoped down that far these units still resolve their own copy
        # unchanged — this just says what would start shadowing if it were.
        shadows_below = await descendant_owners(connection, body.org_unit_id, body.kind, body.name)
        return {**dict(asset), "version": version, "shadows_below": shadows_below}


@router.post("/assets/{asset_id}/versions", status_code=status.HTTP_201_CREATED)
async def create_version(
    asset_id: UUID,
    body: VersionCreate,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    files = decode_files([item.model_dump() for item in body.files])
    async with transaction(get_pool(request)) as connection:
        asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_write(connection, principal, user_unit["id"], asset["org_unit_id"])
        boundary = await effective_boundary(connection, asset["org_unit_id"])
        lint_files(files, boundary, await _visible_refs(connection, asset["org_unit_id"]))
        pending = boundary["build_policy"]["push_review"] and not await is_admin(
            connection, principal.auth_user_id, asset["org_unit_id"]
        )
        # This asset already exists here, so no new name is being created and
        # nothing below is required to gate an ordinary edit — that would
        # regress every existing shadow, which docs/archive/scoping.md §5.2 explicitly
        # says this feature must not touch. `override_of` is opt-in: it
        # exists only so a unit can *confirm* "keep mine" for a collision
        # `set_asset_scopes` raised (§5.2(c)), by recording, on a real new
        # version, exactly which ancestor copy it knowingly keeps overriding.
        provenance_override: dict = {}
        if body.override_of is not None:
            ancestor = await ancestor_version(connection, asset["org_unit_id"], body.override_of)
            if (
                not ancestor
                or ancestor["kind"] != asset["kind"]
                or ancestor["name"] != asset["name"]
            ):
                raise ApiError(422, "invalid_override", "There is no collision here to override.")
            provenance_override = {"override_of": str(ancestor["asset_id"])}
        provenance = {"pending_review": True} if pending else {}
        provenance.update(provenance_override)
        version = await push_version(
            connection,
            asset_id=asset_id,
            parent_version_id=body.parent_version_id,
            files=files,
            author_id=principal.auth_user_id,
            message=body.message,
            provenance=provenance,
            make_head=not pending,
        )
        await append_event(
            connection,
            org_unit_id=asset["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.push",
            payload={"asset_id": str(asset_id), "version_id": str(version["id"])},
        )
        return version


@router.post("/assets/{asset_id}/versions/{version_id}/approve")
async def approve_version(
    asset_id: UUID,
    version_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        asset = await connection.fetchrow("select * from assets where id=$1 for update", asset_id)
        if not asset:
            raise ApiError(404, "asset_not_found", "This asset could not be found.")
        await require_admin(connection, principal, asset["org_unit_id"])
        version = await connection.fetchrow(
            "select * from asset_versions where id=$1 and asset_id=$2", version_id, asset_id
        )
        if not version:
            raise ApiError(404, "version_not_found", "This version could not be found.")
        provenance = dict(version["provenance"])
        provenance.pop("pending_review", None)
        provenance["approved_by"] = str(principal.auth_user_id)
        await connection.execute(
            "update asset_versions set provenance=$2 where id=$1",
            version_id,
            json.dumps(provenance),
        )
        await connection.execute(
            "update assets set head_version_id=$2 where id=$1", asset_id, version_id
        )
        await append_event(
            connection,
            org_unit_id=asset["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.approve",
            payload={"asset_id": str(asset_id), "version_id": str(version_id)},
        )
        return {"approved": True, "version_id": version_id}


async def _copy_version(
    connection,
    *,
    asset_id: UUID,
    parent_id: UUID | None,
    source,
    author_id: UUID,
    message: str,
    provenance: dict,
):
    seq = await connection.fetchval(
        "select coalesce(max(seq),0)+1 from asset_versions where asset_id=$1", asset_id
    )
    row = await connection.fetchrow(
        """insert into asset_versions
           (asset_id,parent_version_id,seq,file_hashes,author_auth_user_id,message,provenance)
           values($1,$2,$3,$4,$5,$6,$7) returning *""",
        asset_id,
        parent_id,
        seq,
        json.dumps(dict(source["file_hashes"])),
        author_id,
        message,
        json.dumps(provenance),
    )
    await connection.execute(
        "update assets set head_version_id=$2 where id=$1", asset_id, row["id"]
    )
    return row


@router.post("/assets/{asset_id}/promote")
async def promote(
    asset_id: UUID,
    body: PromoteInput,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        source_asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_admin(connection, principal, body.target_org_unit_id)
        source = await connection.fetchrow(
            "select * from asset_versions where id=$1", source_asset["head_version_id"]
        )
        if not source:
            raise ApiError(409, "no_active_version", "This asset does not have an active version.")
        target = await connection.fetchrow(
            "select * from assets where org_unit_id=$1 and kind=$2 and name=$3 for update",
            body.target_org_unit_id,
            source_asset["kind"],
            source_asset["name"],
        )
        # docs/archive/scoping.md §5.2(b): informational, same as a fresh push — a
        # promote to a unit that had no asset of this name yet is also this
        # name coming into existence there for the first time.
        shadows_below: list[dict] = []
        if not target:
            # Harnesses hold names, and the name has not changed, so a
            # promoted copy is already in whatever harnesses named it. There
            # is nothing to copy here and nothing that can be left behind.
            target = await connection.fetchrow(
                "insert into assets(org_unit_id,kind,name) values($1,$2,$3) returning *",
                body.target_org_unit_id,
                source_asset["kind"],
                source_asset["name"],
            )
            shadows_below = await descendant_owners(
                connection, body.target_org_unit_id, source_asset["kind"], source_asset["name"]
            )
        version = await _copy_version(
            connection,
            asset_id=target["id"],
            parent_id=target["head_version_id"],
            source=source,
            author_id=principal.auth_user_id,
            message=body.message or f"Promoted {source_asset['name']}.",
            provenance={"promoted_from": str(source["id"])},
        )
        await append_event(
            connection,
            org_unit_id=body.target_org_unit_id,
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.promote",
            payload={"asset_id": str(target["id"]), "source_version_id": str(source["id"])},
        )
        return {
            **dict(target),
            "harness_ids": await _harness_ids(connection, target),
            "version": dict(version),
            "shadows_below": shadows_below,
        }


@router.post("/assets/{asset_id}/rollback")
async def rollback(
    asset_id: UUID,
    body: RollbackInput,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        asset = await _asset_access(connection, principal, user_unit, asset_id)
        await require_write(connection, principal, user_unit["id"], asset["org_unit_id"])
        source = await connection.fetchrow(
            "select * from asset_versions where id=$1 and asset_id=$2",
            body.to_version_id,
            asset_id,
        )
        if not source:
            raise ApiError(404, "version_not_found", "The version to restore could not be found.")
        date = source["created_at"].astimezone(UTC).date().isoformat()
        version = await _copy_version(
            connection,
            asset_id=asset_id,
            parent_id=asset["head_version_id"],
            source=source,
            author_id=principal.auth_user_id,
            message=f"Restored the version from {date}.",
            provenance={"restored": str(source["id"])},
        )
        await append_event(
            connection,
            org_unit_id=asset["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="asset.rollback",
            payload={"asset_id": str(asset_id), "version_id": str(version["id"])},
        )
        return dict(version)


@router.get("/assets/{asset_id}/history")
async def history(
    asset_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    await _asset_access(get_pool(request), principal, user_unit, asset_id)
    rows = await get_pool(request).fetch(
        """select v.id,v.seq,v.message,v.created_at,v.provenance,v.author_auth_user_id,
                  v.author_auth_user_id::text author_email
           from asset_versions v where v.asset_id=$1 order by v.seq desc""",
        asset_id,
    )
    return [
        {
            "id": row["id"],
            "seq": row["seq"],
            "message": row["message"],
            "author_email": row["author_email"],
            "created_at": row["created_at"],
            "provenance": row["provenance"],
        }
        for row in rows
    ]


@router.get("/assets/{asset_id}/versions/{version_id}/files")
async def files(
    asset_id: UUID,
    version_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
    user_unit: Annotated[dict, Depends(current_user_unit)],
) -> list[dict]:
    await _asset_access(get_pool(request), principal, user_unit, asset_id)
    version = await get_pool(request).fetchrow(
        "select file_hashes from asset_versions where id=$1 and asset_id=$2", version_id, asset_id
    )
    if not version:
        raise ApiError(404, "version_not_found", "This version could not be found.")
    hashes = dict(version["file_hashes"])
    rows = await get_pool(request).fetch(
        "select hash,content from asset_files where hash=any($1::text[])", list(hashes.values())
    )
    contents = {row["hash"]: row["content"] for row in rows}
    return [
        {"path": path, "content_b64": base64.b64encode(contents[digest]).decode()}
        for path, digest in sorted(hashes.items())
    ]
