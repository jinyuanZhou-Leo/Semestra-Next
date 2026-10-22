"""How callers authenticate, declared for the OpenAPI schema (M01 §3).

These dependencies never reject a request (`auto_error=False`) and their values are unused:
the authenticator on `app.state` does the real work. Declaring them on the context
dependencies makes every operation list the credentials it accepts, for the docs site and
generated clients.
"""

from typing import Annotated

from fastapi import Security
from fastapi.security import APIKeyCookie, HTTPAuthorizationCredentials, HTTPBearer

SESSION_COOKIE = "semestra_session"

session_cookie = APIKeyCookie(
    name=SESSION_COOKIE,
    scheme_name="sessionCookie",
    description="Set by the sign-in endpoints for the web app. Requests other than GET, HEAD "
    "and OPTIONS also need the `X-Semestra-CSRF` header set to the `semestra_csrf` cookie.",
    auto_error=False,
)
access_token = HTTPBearer(
    scheme_name="accessToken",
    bearerFormat="JWT",
    description="Short-lived access token for native clients: sign in with `?client=native`, "
    "renew with `POST /auth/token/refresh`.",
    auto_error=False,
)
personal_access_token = HTTPBearer(
    scheme_name="personalAccessToken",
    bearerFormat="spat_…",
    description="Personal access token from account settings, with `read` or `read` + `write` "
    "scope. Accepted by `/mcp` and by the endpoints of capabilities exposed to MCP; a `read` "
    "token can only call read capabilities.",
    auto_error=False,
)

SessionCookie = Annotated[str | None, Security(session_cookie)]
AccessToken = Annotated[HTTPAuthorizationCredentials | None, Security(access_token)]
PersonalAccessToken = Annotated[
    HTTPAuthorizationCredentials | None, Security(personal_access_token)
]
