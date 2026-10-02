"""`api` → `definitions`, the two creation endpoints (02 §5.3, 00 §4.10).

One client, one bearer, two calls. `definitions` is the source of truth for
what a node *is* (02 §1), so a node recorded in Postgres without a branch is a
node nobody can compose: every caller here runs inside the creating
transaction, and a refusal rolls the records back with it. That is the whole
of D6's fail-closed rule stated in code — **a node that has no branch must not
exist**.

Environment, per D42 (a shared bearer on a private network, never a person's
token):

    DEFINITIONS_URL        http://127.0.0.1:8402   the service's origin
    HARNESS_SERVICE_TOKEN  the same token `routes_internal._service` checks

Neither has a default. An unset `DEFINITIONS_URL` is not "skip the call": it
is a deployment that cannot create a branch, so creation is refused rather
than allowed to write a half-node (I5's shape, applied to records).
"""

import os

import httpx

from app.errors import ApiError

# A branch is an orphan commit with an empty tree (D43) — a fast local write —
# so a slow answer means the network, not the work.
TIMEOUT = 10.0

# 10 rule 17's one permitted mock, at the network edge: the tests point this at
# an `httpx.MockTransport` standing in for the service. Nothing else sets it.
transport: httpx.AsyncBaseTransport | None = None


def ref_for_team(node_path: str) -> str:
    """02 §5.3. A team's ref carries its dotted path; a user's carries an id."""
    return f"refs/heads/teams/{node_path}"


def ref_for_user(auth_user_id: object) -> str:
    return f"refs/heads/users/{auth_user_id}"


async def _post(path: str, body: dict[str, object]) -> dict:
    base = os.environ.get("DEFINITIONS_URL", "").rstrip("/")
    token = os.environ.get("HARNESS_SERVICE_TOKEN", "")
    if not base or not token:
        raise ApiError(
            503,
            "definitions_unconfigured",
            "The definition service is not configured, so nothing can be created yet.",
        )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=transport) as client:
            response = await client.post(
                f"{base}{path}",
                headers={"authorization": f"Bearer {token}"},
                json=body,
            )
    except httpx.HTTPError as exc:
        # Fail closed. The caller is inside a transaction; raising here is what
        # keeps the records and the repository from disagreeing.
        raise ApiError(
            503,
            "definitions_unreachable",
            "The definition service could not be reached. Nothing was created; try again.",
        ) from exc
    if response.status_code >= 300:
        raise ApiError(
            503,
            "definitions_refused",
            "The definition service refused to create this branch. Nothing was created.",
            {"status": response.status_code},
        )
    try:
        return response.json()
    except ValueError:
        return {}


async def create_org(org_id: object, node_path: str) -> dict:
    """`POST /internal/orgs` — the bare repo and `refs/heads/org` (02 §5.3).

    `node_path` is the dotted org path; nothing in the repository derives it
    from the id, so it travels with it.
    """
    return await _post("/internal/orgs", {"org_id": str(org_id), "node_path": node_path})


async def create_branch(org_id: object, ref: str, node_path: str) -> dict:
    """`POST /internal/branches` — a team or user branch (D43)."""
    return await _post(
        "/internal/branches",
        {"org_id": str(org_id), "ref": ref, "node_path": node_path},
    )
