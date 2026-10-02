"""The request primitive (prd-v2 §13; 00 §4.10): one endpoint, three subjects.

The CLI opens the promotion kind (`harness offer`); the console opens role
requests; `publish` is D30g's reservation.

Deciding one lives here too (00 §4.11): **accept** promotes the author's files
onto the team's ref — one `definitions:/internal/commit` taking the blobs
`from` the author's commit, through `domain/writes.py` like every other ref
write (00 D9) — and then closes the request. Decline and comment touch records
only. Accepting a *role* request appoints the admin instead; there is no second
verb for it (D43) and no second screen.
"""

import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field

from app.api.deps import current_principal
from app.db import get_pool, transaction
from app.domain import writes
from app.domain.audit import append_event
from app.errors import ApiError
from app.identity import Principal

router = APIRouter(tags=["requests"])

# 04 §7's *Verbs by role* refusal, verbatim (P13: it names who decides).
ACCEPT_IS_TEAM_ADMINS = (
    "Accepting a request publishes it to everyone on {team}, so a team admin decides it."
)
APPOINT_IS_ORG_ADMINS = (
    "Appointing a team admin is an organisation admin's decision. Anyone may ask; "
    "the request appears above."
)


class Promotion(BaseModel):
    kind: Literal["promotion"]
    paths: list[str] = Field(min_length=1, max_length=200)
    commit: str
    harness: UUID | None = None


class RoleSubject(BaseModel):
    kind: Literal["role"]
    level: Literal["team-admin"]
    team: str


class PublishFrom(BaseModel):
    repo: Literal["platform"]
    ref: str
    paths: list[str]


class PublishTo(BaseModel):
    org: UUID
    ref: str


class Publish(BaseModel):
    kind: Literal["publish"]
    from_: PublishFrom = Field(alias="from")
    to: PublishTo


class OpenRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    reasoning: str = ""
    subject: Promotion | RoleSubject | Publish = Field(discriminator="kind")


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def open_request(
    body: OpenRequest,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    async with transaction(get_pool(request)) as connection:
        unit = await connection.fetchrow(
            """select u.id, u.path, u.parent_id from org_unit_members m
                 join org_units u on u.id=m.user_unit_id
                where m.auth_user_id=$1""",
            principal.auth_user_id,
        )
        if unit is None:
            raise ApiError(404, "no_workspace", "You do not have a workspace yet.")
        subject = body.subject
        if isinstance(subject, Publish):
            staff = await connection.fetchval(
                "select exists(select 1 from platform_staff where auth_user_id=$1)",
                principal.auth_user_id,
            )
            if not staff:
                raise ApiError(
                    404,
                    "platform.not_built",
                    "The platform scope is reserved and not built.",
                    {"remedy": "See docs/console/08-platform-panel.md."},
                )
            team = await connection.fetchrow(
                "select id, path from org_units where id=$1", subject.to.org
            )
        elif isinstance(subject, RoleSubject):
            team = await connection.fetchrow(
                "select id, path from org_units where path=$1", subject.team
            )
        else:
            # The team decided at is the one the author's user node sits in.
            team = await connection.fetchrow(
                "select id, path from org_units where id=$1", unit["parent_id"]
            )
        if team is None:
            raise ApiError(404, "org_unit_not_found", "This org unit could not be found.")
        harness_id = getattr(subject, "harness", None)
        base = await connection.fetchval(
            """select commit from idx_refs
                where ref = 'refs/heads/teams/' || $1
                  and org = (select id from org_units where path = split_part($1, '.', 1))""",
            team["path"],
        )
        row = await connection.fetchrow(
            """insert into requests
                 (org_unit_id, harness_id, author_auth_user_id, title, reasoning,
                  subject, subject_kind, base_commit)
               values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, state""",
            team["id"],
            harness_id,
            principal.auth_user_id,
            body.title,
            body.reasoning,
            json.dumps(body.subject.model_dump(by_alias=True, mode="json")),
            subject.kind,
            base,
        )
        await append_event(
            connection,
            org_unit_id=team["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="request.open",
            payload={"request_id": str(row["id"]), "title": body.title, "kind": subject.kind},
        )
        return {"id": str(row["id"]), "team": team["path"], "state": row["state"]}


@router.post("/requests/{request_id}/withdraw", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_request(
    request_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> Response:
    async with transaction(get_pool(request)) as connection:
        row = await connection.fetchrow("select * from requests where id=$1", request_id)
        if row is None:
            raise ApiError(404, "request_not_found", "This request could not be found.")
        if row["author_auth_user_id"] != principal.auth_user_id:
            raise ApiError(
                403, "request.not_author", "Only the author can withdraw a request."
            )
        if row["state"] != "open":
            raise ApiError(
                409,
                "request.not_open",
                f"This request was {row['decision']} by {row['decided_by']} "
                f"on {row['decided_at']}.",
            )
        await connection.execute(
            """update requests set state='closed', decision='withdrawn',
                   decided_by=$2, decided_at=now() where id=$1""",
            request_id,
            principal.auth_user_id,
        )
        await append_event(
            connection,
            org_unit_id=row["org_unit_id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="request.withdraw",
            payload={"request_id": str(request_id), "title": row["title"]},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class Decision(BaseModel):
    reason: str = ""


class Comment(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


async def _open_request(connection, request_id: UUID) -> dict:
    row = await connection.fetchrow("select * from requests where id=$1", request_id)
    if row is None:
        raise ApiError(404, "request_not_found", "This request could not be found.")
    if row["state"] != "open":
        raise ApiError(
            409,
            "request.not_open",
            f"This request was {row['decision']} on {row['decided_at']}.",
            {"decision": row["decision"]},
            remedy="Open the request to read the decision.",
        )
    return dict(row)


async def _close(connection, request_id: UUID, decision: str, by: UUID, reason: str) -> None:
    await connection.execute(
        """update requests set state='closed', decision=$2, decided_by=$3,
               decided_at=now(), reason=$4 where id=$1""",
        request_id,
        decision,
        by,
        reason,
    )


@router.post("/requests/{request_id}/accept")
async def accept_request(
    request_id: UUID,
    body: Decision,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    """PRD §17.3's *accept all n*: the whole request, in one commit.

    The files are taken `from` the author's commit as it stood when they
    offered it (02 §5.3's `changes`), so accepting publishes exactly what the
    two-column compare showed and nothing the author has pushed since.
    """
    async with transaction(get_pool(request)) as connection:
        row = await _open_request(connection, request_id)
        who = await writes.authority(connection, principal)
        team = await connection.fetchrow(
            "select id, path, name from org_units where id=$1", row["org_unit_id"]
        )
        subject = row["subject"]
        author_email = await connection.fetchval(
            "select email from auth.users where id=$1", row["author_auth_user_id"]
        )
        if row["subject_kind"] == "publish":
            raise ApiError(
                404,
                "platform.not_built",
                "The platform scope is reserved and not built.",
                remedy="See docs/console/08-platform-panel.md.",
            )
        if row["subject_kind"] == "role":
            # D43: the same primitive, a different act. Appointing is the
            # organisation's decision even when the team's admin can see it.
            if not who.is_org_admin:
                raise ApiError(
                    403,
                    "request.not_yours",
                    APPOINT_IS_ORG_ADMINS,
                    {"team": team["path"]},
                )
            await connection.execute(
                """insert into org_unit_admins(auth_user_id,org_unit_id,level)
                   values($1,$2,'admin')
                   on conflict (auth_user_id,org_unit_id) do update set level='admin'""",
                row["author_auth_user_id"],
                team["id"],
            )
            await append_event(
                connection,
                org_unit_id=team["id"],
                actor_type="user",
                actor_id=principal.auth_user_id,
                event_class="authoritative",
                action="request.accept",
                payload={
                    "request_id": str(request_id),
                    "title": row["title"],
                    "author": author_email,
                    "team": team["name"],
                    "role": "team admin",
                },
            )
            await _close(connection, request_id, "accepted", principal.auth_user_id, body.reason)
            return {"id": str(request_id), "state": "closed", "decision": "accepted"}

        if await who.administers(team["path"]) is None:
            raise ApiError(
                403,
                "request.not_yours",
                ACCEPT_IS_TEAM_ADMINS.format(team=team["name"]),
                {"team": team["path"]},
                remedy=f"Ask an admin of {team['name']}.",
            )
        paths = subject.get("paths") or []
        result = await writes.commit(
            connection,
            org_id=who.org_id,
            ref=f"refs/heads/teams/{team['path']}",
            changes=[
                {"path": path, "from": {"commit": subject["commit"], "path": path}}
                for path in paths
            ],
            message=f'accept "{row["title"]}"',
            reason={"kind": "accept", "request": str(request_id)},
            author=who.author,
            actor_id=principal.auth_user_id,
            audit_unit=team["id"],
            action="request.accept",
            payload={
                "request_id": str(request_id),
                "title": row["title"],
                "author": author_email,
                "team": team["name"],
                "n": len(paths),
            },
        )
        await _close(connection, request_id, "accepted", principal.auth_user_id, body.reason)
        return {"id": str(request_id), "state": "closed", "decision": "accepted", **result}


@router.post("/requests/{request_id}/decline")
async def decline_request(
    request_id: UUID,
    body: Decision,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    """A reason is required (04 §7): the author reads it, and it is the row."""
    async with transaction(get_pool(request)) as connection:
        row = await _open_request(connection, request_id)
        who = await writes.authority(connection, principal)
        team = await connection.fetchrow(
            "select id, path, name from org_units where id=$1", row["org_unit_id"]
        )
        decides = (
            who.is_org_admin
            if row["subject_kind"] == "role"
            else await who.administers(team["path"]) is not None
        )
        if not decides:
            raise ApiError(
                403,
                "request.not_yours",
                APPOINT_IS_ORG_ADMINS
                if row["subject_kind"] == "role"
                else ACCEPT_IS_TEAM_ADMINS.format(team=team["name"]),
                {"team": team["path"]},
            )
        if not body.reason.strip():
            raise ApiError(
                422,
                "invalid_request",
                "Say why: the author reads the reason and nothing else explains it.",
                {"errors": [{"field": "reason", "reason": "A declined request carries a reason."}]},
            )
        await append_event(
            connection,
            org_unit_id=team["id"],
            actor_type="user",
            actor_id=principal.auth_user_id,
            event_class="authoritative",
            action="request.decline",
            payload={
                "request_id": str(request_id),
                "title": row["title"],
                "reason": body.reason,
                "team": team["name"],
            },
        )
        await _close(connection, request_id, "declined", principal.auth_user_id, body.reason)
        return {"id": str(request_id), "state": "closed", "decision": "declined",
                "reason": body.reason}


@router.post("/requests/{request_id}/comments", status_code=status.HTTP_201_CREATED)
async def comment_on_request(
    request_id: UUID,
    body: Comment,
    request: Request,
    principal: Annotated[Principal, Depends(current_principal)],
) -> dict:
    """Anyone who can see the request may comment (04 §7): the author, the team
    it was offered to, and whoever administers that team. A comment is not an
    act on the definitions, so it is a record and no audit row — 03 §6 has no
    sentence for one and inventing an action string would make a log row
    nobody can read.
    """
    async with transaction(get_pool(request)) as connection:
        row = await connection.fetchrow("select * from requests where id=$1", request_id)
        if row is None:
            raise ApiError(404, "request_not_found", "This request could not be found.")
        who = await writes.authority(connection, principal)
        team = await connection.fetchrow(
            "select id, path, name from org_units where id=$1", row["org_unit_id"]
        )
        visible = (
            row["author_auth_user_id"] == principal.auth_user_id
            or who.user_path.startswith(team["path"] + ".")
            or await who.administers(team["path"]) is not None
        )
        if not visible:
            raise ApiError(404, "request.not_visible", "No such request in your view.")
        comment = await connection.fetchrow(
            """insert into request_comments(request_id, author_auth_user_id, text)
               values($1,$2,$3) returning id, created_at""",
            request_id,
            principal.auth_user_id,
            body.text,
        )
        return {
            "id": str(comment["id"]),
            "request": str(request_id),
            "text": body.text,
            "at": comment["created_at"].isoformat(),
        }
