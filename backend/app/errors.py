from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """The one error envelope (console 03 §7.4): `{ code, message, remedy?, detail? }`.

    `remedy` is console D30's addition, so an API error and a `Blocker` render
    through one component. It is keyword-only and optional, which is what makes
    the change additive: every existing raise still passes `detail` positionally.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        detail: dict[str, Any] | None = None,
        *,
        remedy: str | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail = detail or {}
        self.remedy = remedy


def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    body: dict[str, Any] = {"code": exc.code, "message": exc.message}
    if exc.remedy:
        body["remedy"] = exc.remedy
    body["detail"] = exc.detail
    return JSONResponse(status_code=exc.status_code, content=body)


# console 03 §8.4 and D30: **one** envelope everywhere. A route that does not
# exist is an error like any other, and the console renders it through the same
# component as a `Blocker`; Starlette's own `{"detail": "Not Found"}` is the one
# shape that used to escape (found by the screen agents, build log wave 3).
_HTTP_CODES = {
    404: ("not_found", "There is nothing at {path}.",
          "Check the address; every endpoint this server has is in its OpenAPI document."),
    405: ("method_not_allowed", "{method} is not something {path} does.",
          "See the OpenAPI document for the methods this path answers."),
}


def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code, message, remedy = _HTTP_CODES.get(
        exc.status_code,
        (
            f"http_{exc.status_code}",
            str(exc.detail) if exc.detail else "This request could not be answered.",
            "",
        ),
    )
    body: dict[str, Any] = {
        "code": code,
        "message": message.format(path=request.url.path, method=request.method),
    }
    if remedy:
        body["remedy"] = remedy
    body["detail"] = {}
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)
