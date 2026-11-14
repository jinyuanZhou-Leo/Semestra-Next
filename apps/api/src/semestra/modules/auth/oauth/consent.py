"""The consent page's side of OAuth (M12 §5.3): what an app is asking for, and the user's answer.
Approving issues a one-time authorization code; the connection itself starts when the app
redeems it (`provider.exchange_authorization_code`)."""

from pydantic import BaseModel, Field

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.auth import crypto
from semestra.modules.auth.models import AuthOAuthGrant
from semestra.modules.auth.oauth import common
from semestra.modules.auth.schemas import KnownApp, TokenScope
from semestra.modules.auth.service import require_recent_auth

HTTP_ONLY = ("http",)
CODE_PREFIX = "soac_"


def _pending(ctx: Ctx, token: str, *, allow_expired: bool = False) -> common.PendingRequest:
    req = common.read_request(ctx.settings, token, ctx.now, allow_expired=allow_expired)
    if req is None:
        raise AppError("auth.authorization_expired", 400)
    return req


class AuthorizationRequestInput(BaseModel):
    request: str = Field(max_length=8192, description="The `request` parameter of the consent page")


class AuthorizationRequestOut(BaseModel):
    client_name: str = Field(description="The app's name, as it calls itself: not checked")
    app: KnownApp | None = Field(
        description="The app this is known to be; none when it only named itself"
    )
    host: str = Field(
        description="The site the app is: where its metadata document is, or where the browser "
        "returns to after the answer"
    )
    local: bool = Field(description="The app runs on this computer (a localhost redirect)")
    scopes: list[TokenScope] = Field(description="The access levels the user may choose from")


@capability(
    name="account.authorization.get",
    summary="Describe an app's request to connect.",
    description="What the consent page shows: the app, where it returns and the access it may "
    "get. Not available to agents.",
    effect="read",
    http=Http("GET", "/account/authorizations/request"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def authorization_get(ctx: Ctx, inp: AuthorizationRequestInput) -> AuthorizationRequestOut:
    req = _pending(ctx, inp.request)
    return AuthorizationRequestOut(
        client_name=req.client_name,
        app=common.known_app(req.client_id),
        host=common.client_host(req.client_id, req.redirect_uri),
        local=common.is_loopback(req.redirect_uri),
        scopes=req.scopes or ["read", "write"],
    )


class AuthorizationApproveInput(AuthorizationRequestInput):
    scopes: list[TokenScope] = Field(
        min_length=1, description="`read`, or `read` and `write`: what the app may do"
    )


class AuthorizationAnswer(BaseModel):
    redirect_url: str = Field(description="Send the browser here: back to the app")


@capability(
    name="account.authorization.approve",
    summary="Let an app connect.",
    description="Approves the request with the chosen access and returns where to send the "
    "browser. Needs a recent sign-in. Not available to agents.",
    effect="write",
    http=Http("POST", "/account/authorizations/approve"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def authorization_approve(ctx: Ctx, inp: AuthorizationApproveInput) -> AuthorizationAnswer:
    req = _pending(ctx, inp.request)
    # The app gets a way in that outlives this session: a stolen cookie must not hand one out.
    await require_recent_auth(ctx)
    scopes = common.canonical_scopes(inp.scopes)
    if req.scopes and not set(scopes) <= set(req.scopes):
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["scopes"], "code": "not_requested"}]
        )
    code = crypto.new_token(CODE_PREFIX)
    ctx.db.add(
        AuthOAuthGrant(
            user_id=ctx.user_id,
            client_id=req.client_id,
            client_name=req.client_name,
            scopes=scopes,
            resource=common.resource(ctx.settings),
            redirect_uri=req.redirect_uri,
            redirect_uri_explicit=req.redirect_uri_explicit,
            code_hash=crypto.hash_token(code),
            code_challenge=req.code_challenge,
            code_expires_at=ctx.now + common.CODE_TTL,
            created_at=ctx.now,
        )
    )
    await ctx.db.flush()
    return AuthorizationAnswer(
        redirect_url=common.redirect_with(req.redirect_uri, code=code, state=req.state)
    )


@capability(
    name="account.authorization.deny",
    summary="Turn down an app's request to connect.",
    description="Returns where to send the browser: back to the app, told the user said no. "
    "Not available to agents.",
    effect="write",
    http=Http("POST", "/account/authorizations/deny"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def authorization_deny(ctx: Ctx, inp: AuthorizationRequestInput) -> AuthorizationAnswer:
    # Still answered after the request expired: the app is waiting either way.
    req = _pending(ctx, inp.request, allow_expired=True)
    return AuthorizationAnswer(
        redirect_url=common.redirect_with(req.redirect_uri, error="access_denied", state=req.state)
    )
