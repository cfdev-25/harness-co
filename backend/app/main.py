from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import (
    routes_api_keys,
    routes_assets,
    routes_audit,
    routes_auth,
    routes_console,
    routes_harnesses,
    routes_internal,
    routes_me,
    routes_org_units,
    routes_requests,
    routes_resolve,
    routes_sessions,
    routes_writes,
)
from app.config import get_settings
from app.db import create_pool
from app.domain import issuer
from app.errors import ApiError, api_error_handler, http_error_handler


def create_app(pool: asyncpg.Pool | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if pool is None:
            app.state.pool = await create_pool(get_settings())
            try:
                yield
            finally:
                await app.state.pool.close()
        else:
            app.state.pool = pool
            yield

    application = FastAPI(title="Harness API", version="1.0", lifespan=lifespan)
    application.add_exception_handler(ApiError, api_error_handler)
    # console D30: every error is the one envelope, an unknown route included.
    application.add_exception_handler(StarletteHTTPException, http_error_handler)

    @application.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": ".".join(str(part) for part in error["loc"][1:]), "reason": error["msg"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "code": "invalid_request",
                "message": "Please check the request and try again.",
                "detail": {"errors": details},
            },
        )

    for router in (
        routes_me.router,
        routes_auth.router,
        routes_org_units.router,
        routes_assets.router,
        routes_harnesses.router,
        routes_resolve.router,
        routes_api_keys.router,
        routes_audit.router,
        routes_sessions.router,
        routes_internal.router,
        routes_requests.router,
        routes_console.router,
        routes_writes.router,
    ):
        application.include_router(router, prefix="/v1")
    # 00 §4.10 replaces `routes_auth`'s `/v1/me`. Until that handler leaves
    # with the rest of 00 §6's deletions, the superseded route is dropped here
    # so the runtime and `/openapi.json` show one shape, not two.
    #
    # 00 §4.11 replaces three of `routes_harnesses`' writes and one of
    # `routes_org_units`': a harness is `harnesses/<id>.json` on a ref (engine
    # 01 §4.2), not a row in the legacy table, and `POST /v1/org-units` now
    # takes the console's `{ kind, parent, members }` body as well as the
    # records one. The superseded handlers are dropped here — the same
    # treatment `/v1/me` gets above — so the runtime and `/openapi.json` show
    # one shape per path and no route shadows another. Their reads
    # (`GET /v1/harnesses/{id}`, the org-unit reads) are untouched.
    superseded = {
        ("/v1/me", routes_auth.me),
        ("/v1/harnesses", routes_harnesses.create_harness),
        ("/v1/harnesses/{harness_id}", routes_harnesses.update_harness),
        ("/v1/harnesses/{harness_id}", routes_harnesses.delete_harness),
        ("/v1/org-units", routes_org_units.create_org_unit),
    }
    application.router.routes = [
        route
        for route in application.router.routes
        if (getattr(route, "path", None), getattr(route, "endpoint", None)) not in superseded
    ]
    # 11 §4: the discovery document and the JWKS live at a stable path a
    # customer's identity system fetches, so they carry no version prefix.
    application.include_router(issuer.router)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
