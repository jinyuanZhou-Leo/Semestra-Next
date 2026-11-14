"""OAuth for MCP clients (M12 §5.3): apps such as ChatGPT and Claude connect by signing in
instead of with a pasted token. The server's routes come from the MCP SDK (`routes.py`), the
storage behind them is `provider.py`, the consent page's capabilities are `consent.py`."""

import asyncio
import importlib
from typing import TYPE_CHECKING

from fastapi import FastAPI
from starlette.requests import Request
from starlette.routing import Route
from starlette.types import Receive, Scope, Send

from semestra.core.context import client_ip
from semestra.core.errors import AppError
from semestra.core.uploads import limit_upload
from semestra.modules.auth.oauth import common, consent  # noqa: F401  (registers on import)

if TYPE_CHECKING:
    from starlette.routing import Router

# Path → methods, as `routes.build` serves them (OPTIONS: CORS preflight for browser clients).
PATHS = {
    "/.well-known/oauth-authorization-server": ["GET", "OPTIONS"],
    "/.well-known/oauth-protected-resource/mcp": ["GET", "OPTIONS"],
    "/authorize": ["GET", "POST"],
    "/token": ["POST", "OPTIONS"],
    "/register": ["POST", "OPTIONS"],
    "/revoke": ["POST", "OPTIONS"],
}

# A registration is a few hundred bytes; nothing bigger is read.
MAX_REGISTRATION_BYTES = 8 * 1024
limit_upload(
    "/register",
    lambda _: (
        MAX_REGISTRATION_BYTES,
        AppError("common.payload_too_large", 413, limit_bytes=MAX_REGISTRATION_BYTES),
    ),
)


class LazyRoutes:
    """The OAuth routes, importing the MCP SDK on their first request instead of at start (as
    `/mcp` does)."""

    def __init__(self) -> None:
        self.router: Router | None = None
        self.lock = asyncio.Lock()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        settings = scope["app"].state.settings
        common.request_ip.set(client_ip(Request(scope), settings.trusted_proxy_hops) or "unknown")
        router = self.router
        if router is None:
            async with self.lock:
                router = self.router
                if router is None:
                    routes = await asyncio.to_thread(
                        importlib.import_module, "semestra.modules.auth.oauth.routes"
                    )
                    router = self.router = routes.build(scope["app"].state)
        await router(scope, receive, send)


def register(app: FastAPI) -> None:
    lazy = LazyRoutes()
    for path, methods in PATHS.items():
        app.router.routes.append(Route(path, endpoint=lazy, methods=methods))
