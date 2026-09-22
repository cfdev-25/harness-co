from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import (
    routes_api_keys,
    routes_assets,
    routes_audit,
    routes_auth,
    routes_harnesses,
    routes_org_units,
    routes_resolve,
    routes_sessions,
)
from app.config import get_settings
from app.db import create_pool
from app.errors import ApiError, api_error_handler


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
        routes_auth.router,
        routes_org_units.router,
        routes_assets.router,
        routes_harnesses.router,
        routes_resolve.router,
        routes_api_keys.router,
        routes_audit.router,
        routes_sessions.router,
    ):
        application.include_router(router, prefix="/v1")

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
