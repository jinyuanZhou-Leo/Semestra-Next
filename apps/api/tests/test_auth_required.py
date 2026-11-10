"""Every endpoint needs a signed-in user unless it is listed here, so a new route is covered
without its module writing its own "requires login" test.

Capability routes are refused by `Registry.invoke` unless the capability is `public`; the
other routes (uploads, downloads, sign-in) each choose their own dependency, so an anonymous
request is sent to each of them."""

import re

from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.capability import registry

PUBLIC_CAPABILITIES: set[str] = set()
# operationId → why it is public.
PUBLIC_ROUTES = {
    "healthz": "load balancer probe",
    "readyz": "load balancer probe",
    "authConfig": "the sign-in page reads it",
    "authEmailStart": "signing in",
    "authEmailVerify": "signing in",
    "authRegisterComplete": "signing in",
    "authPasswordLogin": "signing in",
    "authPasswordReset": "signing in",
    "authGoogleLogin": "signing in",
    "authTokenRefresh": "signing in",
    "authLogout": "succeeds whether or not a session is left",
    "accountAvatarGet": "unguessable, cacheable URL",
}


async def test_only_listed_capabilities_are_public(app: FastAPI) -> None:
    assert {c.name for c in registry.list() if c.public} == PUBLIC_CAPABILITIES


async def test_other_routes_refuse_anonymous_requests(app: FastAPI, client: AsyncClient) -> None:
    capabilities = {c.operation_id for c in registry.list() if c.http is not None}
    open_routes = []
    for path, operations in app.openapi()["paths"].items():
        for method, operation in operations.items():
            op_id = operation["operationId"]
            if op_id in capabilities or op_id in PUBLIC_ROUTES:
                continue
            url = re.sub(r"{[^}]+}", "x", path)
            r = await client.request(method, url)
            if r.status_code != 401 or r.json()["error"]["code"] != "common.unauthenticated":
                open_routes.append(f"{method.upper()} {path}: {r.status_code}")
    assert open_routes == []
