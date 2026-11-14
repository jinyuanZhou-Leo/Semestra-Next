"""The OAuth server's routes (M12 §5.3), from the MCP SDK: metadata (RFC 8414, RFC 9728),
`/authorize`, `/token`, `/register` (RFC 7591) and `/revoke`. Built on the first request (see
`semestra.modules.auth.oauth.LazyRoutes`)."""

from datetime import timedelta
from urllib.parse import urlsplit

from mcp.server.auth.handlers.metadata import MetadataHandler, ProtectedResourceMetadataHandler
from mcp.server.auth.routes import (
    REGISTRATION_PATH,
    cors_middleware,
    create_auth_routes,
)
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.shared.auth import OAuthMetadata, ProtectedResourceMetadata
from pydantic import AnyHttpUrl
from starlette.datastructures import State
from starlette.responses import JSONResponse
from starlette.routing import Route, Router
from starlette.types import ASGIApp, Receive, Scope, Send

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.modules.auth import ratelimit
from semestra.modules.auth.oauth import common
from semestra.modules.auth.oauth.provider import Provider

METADATA_PATH = "/.well-known/oauth-authorization-server"
# Registration is open to anyone: a few per address per hour is plenty for real apps.
REGISTER_LIMIT = 20
REGISTER_WINDOW = timedelta(hours=1)


def _metadata(issuer: str) -> OAuthMetadata:
    # Validated from plain strings: the model keeps `https://host` as is, where a standalone
    # `AnyHttpUrl` would add a slash and the issuer would no longer match exactly (RFC 8414 §3.3).
    methods = ["none", "client_secret_post", "client_secret_basic"]
    return OAuthMetadata.model_validate(
        {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "registration_endpoint": f"{issuer}{REGISTRATION_PATH}",
            "revocation_endpoint": f"{issuer}/revoke",
            "scopes_supported": list(common.SCOPES),
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            # `none`: public clients, as ChatGPT and Claude are with a metadata document.
            "token_endpoint_auth_methods_supported": methods,
            "revocation_endpoint_auth_methods_supported": methods,
            "code_challenge_methods_supported": ["S256"],
            "client_id_metadata_document_supported": True,
        }
    )


def _resource_metadata(settings: Settings) -> ProtectedResourceMetadata:
    return ProtectedResourceMetadata.model_validate(
        {
            "resource": common.resource(settings),
            "authorization_servers": [common.issuer(settings)],
            "scopes_supported": list(common.SCOPES),
            "resource_name": "Semestra",
        }
    )


class _RateLimited:
    """An ASGI app: `app`, with a limit on POSTs per address (a /64 for IPv6; an object, so
    `Route` treats it as an app rather than a request handler)."""

    def __init__(self, state: State, app: ASGIApp) -> None:
        self.state = state
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("method") == "POST":
            async with self.state.session_factory() as db:
                try:
                    await ratelimit.hit(
                        db,
                        self.state.settings,
                        self.state.now(),
                        "oauth_register",
                        ratelimit.network(common.request_ip.get()),
                        limit=REGISTER_LIMIT,
                        window=REGISTER_WINDOW,
                    )
                except AppError:
                    response = JSONResponse({"error": "too_many_requests"}, status_code=429)
                    return await response(scope, receive, send)
        await self.app(scope, receive, send)


def build(state: State) -> Router:
    settings = state.settings
    if not common.available(settings):
        return Router([])
    issuer = common.issuer(settings)
    routes: list[Route] = []
    for route in create_auth_routes(
        Provider(state),
        AnyHttpUrl(issuer),
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=list(common.SCOPES), default_scopes=list(common.SCOPES)
        ),
        revocation_options=RevocationOptions(enabled=True),
    ):
        if route.path == METADATA_PATH:
            continue  # replaced below: the SDK's does not offer metadata documents
        if route.path == REGISTRATION_PATH:
            route = Route(route.path, _RateLimited(state, route.app), methods=["POST", "OPTIONS"])
        routes.append(route)
    routes.append(
        Route(
            METADATA_PATH,
            cors_middleware(MetadataHandler(_metadata(issuer)).handle, ["GET", "OPTIONS"]),
            methods=["GET", "OPTIONS"],
        )
    )
    routes.append(
        Route(
            urlsplit(common.resource_metadata_url(settings)).path,
            cors_middleware(
                ProtectedResourceMetadataHandler(_resource_metadata(settings)).handle,
                ["GET", "OPTIONS"],
            ),
            methods=["GET", "OPTIONS"],
        )
    )
    return Router(routes)
