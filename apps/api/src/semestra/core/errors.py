from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorBody(BaseModel):
    code: str
    params: dict[str, Any] = {}
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class AppError(Exception):
    """Domain error. `code` is dotted and module-prefixed; the frontend translates it."""

    def __init__(self, code: str, status: int = 400, **params: Any) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.params = params


def not_found(kind: str | None = None, id: str | None = None) -> AppError:
    """`kind` and `id` name what was not found (`("course", "01…")`), so an agent that passed
    several ids can tell which one was wrong."""
    if kind is None:
        return AppError("common.not_found", 404)
    return AppError("common.not_found", 404, kind=kind, id=id)


def field_errors(errors: Sequence[Any], prefix: Sequence[str | int] = ()) -> list[dict[str, Any]]:
    """Pydantic errors as `{loc, code, msg, ctx}`. The message and its limits (the allowed values,
    `le`, the pattern) tell an agent how to fix its call; the rejected input is left out, it can
    be large."""
    out: list[dict[str, Any]] = []
    for e in errors:
        err: dict[str, Any] = {"loc": [*prefix, *e["loc"]], "code": e["type"], "msg": e["msg"]}
        limits = e.get("ctx")
        if limits:
            err["ctx"] = {
                k: v if v is None or isinstance(v, str | int | float | bool) else str(v)
                for k, v in limits.items()
            }
        out.append(err)
    return out


def validation_error(exc: ValidationError, prefix: Sequence[str | int] = ()) -> AppError:
    return AppError("common.validation", 422, errors=field_errors(exc.errors(), prefix))


def _response(request: Request, code: str, status: int, params: dict[str, Any]) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    body = ErrorResponse(error=ErrorBody(code=code, params=params, request_id=request_id))
    return JSONResponse(body.model_dump(), status_code=status)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        return _response(request, exc.code, exc.status, exc.params)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        errors = field_errors(exc.errors())
        return _response(request, "common.validation", 422, {"errors": errors})

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        code = "common.not_found" if exc.status_code == 404 else "common.internal"
        return _response(request, code, exc.status_code, {})
