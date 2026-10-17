"""Serve the built SPA from the API process (all-in-one image, `SEMESTRA_SERVE_WEB=true`)."""

from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}
_NO_CACHE = {"Cache-Control": "no-cache"}


def install_web(app: FastAPI, dist_dir: Path) -> None:
    """Add a catch-all GET route for the SPA.

    Must be called after every API route is registered: Starlette matches routes in order, so
    real endpoints win and only otherwise-unmatched GETs fall through to the SPA. A request that
    does not ask for HTML and finds no file still gets the normal 404 error envelope.
    """
    root = dist_dir.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"SEMESTRA_SERVE_WEB is set but {index} does not exist")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def spa(path: str, request: Request) -> Response:  # pyright: ignore[reportUnusedFunction]
        try:
            candidate = (root / path).resolve()
        except ValueError:  # e.g. NUL byte in the path
            raise StarletteHTTPException(404) from None
        if path and candidate.is_file() and candidate.is_relative_to(root):
            hashed = candidate.is_relative_to(root / "assets")
            return FileResponse(candidate, headers=_IMMUTABLE if hashed else _NO_CACHE)
        if "text/html" in request.headers.get("accept", ""):
            return FileResponse(index, headers=_NO_CACHE)
        raise StarletteHTTPException(404)
