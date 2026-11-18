"""Every endpoint needs a signed-in user unless it is listed here, so a new route is covered
without its module writing its own "requires login" test.

Capability routes are refused by `Registry.invoke` unless the capability is `public`; the
other routes (uploads, downloads, streams, sign-in, MCP), including those left out of the
OpenAPI schema, each choose their own dependency, so an anonymous request is sent to each."""

import re

from fastapi import FastAPI
from fastapi.routing import iter_route_contexts
from httpx import AsyncClient

from semestra.core.capability import registry

PUBLIC_CAPABILITIES: set[str] = set()
# "METHOD path" → why it is public.
PUBLIC_ROUTES = {
    "GET /openapi.json": "API schema",
    "GET /healthz": "load balancer probe",
    "GET /readyz": "load balancer probe",
    "GET /auth/config": "the sign-in page reads it",
    "POST /auth/email/start": "signing in",
    "POST /auth/email/verify": "signing in",
    "POST /auth/register/complete": "signing in",
    "POST /auth/password/login": "signing in",
    "POST /auth/password/reset/verify": "signing in",
    "POST /auth/password/reset": "signing in",
    "POST /auth/google": "signing in",
    "POST /auth/passkey/options": "signing in",
    "POST /auth/passkey": "signing in",
    "POST /auth/token/refresh": "signing in",
    "POST /auth/logout": "succeeds whether or not a session is left",
    "GET /account/avatars/{user_id}/{version}": "unguessable, cacheable URL",
    "GET /feeds/{token}.ics": "calendar subscription link; the token is the credential",
    "GET /.well-known/caldav": "CalDAV discovery: redirects to /caldav/, which asks to sign in",
    "PROPFIND /.well-known/caldav": "CalDAV discovery: redirects to /caldav/ (sign-in there)",
    "GET /caldav-setup/{code}.mobileconfig": "device setup link; the short-lived code is the key",
    "POST /notifications/devices/renew": "the service worker renews a push subscription",
    # OAuth for MCP clients (M12 §5.3): how an app finds the server and signs the user in.
    "GET /.well-known/oauth-authorization-server": "OAuth server metadata",
    "GET /.well-known/oauth-protected-resource/mcp": "how /mcp is signed in to",
    "GET /authorize": "sends the browser to the consent page",
    "POST /authorize": "sends the browser to the consent page",
    "POST /token": "the app authenticates with its code or refresh token",
    "POST /register": "an app registers itself (rate limited)",
    "POST /revoke": "the app gives up its token",
}


async def test_only_listed_capabilities_are_public(app: FastAPI) -> None:
    assert {c.name for c in registry.list() if c.public} == PUBLIC_CAPABILITIES


async def test_other_routes_refuse_anonymous_requests(app: FastAPI, client: AsyncClient) -> None:
    capabilities = {c.operation_id for c in registry.list() if c.http is not None}
    seen: set[str] = set()
    open_routes = []
    for route in iter_route_contexts(app.routes):
        path = route.path_format
        if path is None or getattr(route.original_route, "operation_id", None) in capabilities:
            continue
        for method in sorted((route.methods or {"GET"}) - {"HEAD", "OPTIONS"}):
            key = f"{method} {path}"
            seen.add(key)
            if key in PUBLIC_ROUTES:
                continue
            r = await client.request(method, re.sub(r"{[^}]+}", "x", path))
            if r.status_code != 401:
                open_routes.append(f"{key}: {r.status_code}")
    assert open_routes == []
    assert PUBLIC_ROUTES.keys() <= seen, "a listed public route no longer exists"
