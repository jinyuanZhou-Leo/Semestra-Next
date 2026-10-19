"""Public auth routes (M01 §5). They set cookies, so they are plain routes, not capabilities."""

from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Path, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse

from semestra.core.context import (
    Ctx,
    client_ip,
    get_anonymous_ctx,
    get_ctx,
    get_optional_ctx,
    run_after_commit,
)
from semestra.core.errors import not_found
from semestra.modules.auth import avatar, service
from semestra.modules.auth.identity import clear_session_cookies, set_session_cookies
from semestra.modules.auth.schemas import (
    AuthConfig,
    AuthResult,
    Done,
    EmailStartIn,
    EmailStartResult,
    EmailVerifyIn,
    GoogleLoginIn,
    PasswordLoginIn,
    PasswordResetIn,
    RefreshIn,
    RegisterCompleteIn,
    TokenPair,
    UserOut,
)
from semestra.modules.auth.service import Client, SignedIn

router = APIRouter(prefix="/auth", tags=["auth"])

AnonCtx = Annotated[Ctx, Depends(get_anonymous_ctx)]
ClientParam = Annotated[
    Literal["web", "native"],
    Query(description="`native` returns tokens in the body instead of setting cookies"),
]


def _meta(request: Request, ctx: Ctx) -> service.RequestMeta:
    return service.RequestMeta(
        ip=client_ip(request, ctx.settings.trusted_proxy_hops),
        user_agent=request.headers.get("user-agent"),
    )


async def _finish(
    ctx: Ctx, response: Response, tasks: BackgroundTasks, signed_in: SignedIn, client: Client
) -> AuthResult:
    """Commits, then answers with cookies (web) or tokens (native)."""
    user = await service.user_out(ctx.db, signed_in.user)
    result = AuthResult(status="signed_in", user=user)
    if client == "native":
        result.tokens = service.token_pair(ctx, signed_in)
    else:
        set_session_cookies(
            response, ctx.settings, signed_in.token, signed_in.session.expires_at, ctx.now
        )
    await ctx.db.commit()
    tasks.add_task(run_after_commit, ctx)
    return result


@router.get("/config", operation_id="authConfig", response_model=AuthConfig)
async def auth_config(ctx: AnonCtx) -> AuthConfig:
    return AuthConfig(google_client_id=ctx.settings.google_client_id or None)


@router.post("/email/start", operation_id="authEmailStart", response_model=EmailStartResult)
async def email_start(
    body: EmailStartIn, request: Request, tasks: BackgroundTasks, ctx: AnonCtx
) -> EmailStartResult:
    result = await service.start_challenge(
        ctx, email=body.email, purpose=body.purpose, meta=_meta(request, ctx)
    )
    await ctx.db.commit()
    tasks.add_task(run_after_commit, ctx)  # the email is sent after the response: same timing
    return result


@router.post("/email/verify", operation_id="authEmailVerify", response_model=AuthResult)
async def email_verify(
    body: EmailVerifyIn,
    request: Request,
    response: Response,
    tasks: BackgroundTasks,
    ctx: AnonCtx,
    client: ClientParam = "web",
) -> AuthResult:
    signed_in, registration_token = await service.verify_email_code(
        ctx, body.email, body.code, client, _meta(request, ctx)
    )
    if signed_in is None:
        await ctx.db.commit()
        return AuthResult(status="needs_profile", registration_token=registration_token)
    return await _finish(ctx, response, tasks, signed_in, client)


@router.post("/register/complete", operation_id="authRegisterComplete", response_model=AuthResult)
async def register_complete(
    body: RegisterCompleteIn,
    request: Request,
    response: Response,
    tasks: BackgroundTasks,
    ctx: AnonCtx,
    client: ClientParam = "web",
) -> AuthResult:
    signed_in = await service.complete_registration(
        ctx, body.registration_token, body.display_name, body.password, client, _meta(request, ctx)
    )
    return await _finish(ctx, response, tasks, signed_in, client)


@router.post("/password/login", operation_id="authPasswordLogin", response_model=AuthResult)
async def password_login(
    body: PasswordLoginIn,
    request: Request,
    response: Response,
    tasks: BackgroundTasks,
    ctx: AnonCtx,
    client: ClientParam = "web",
) -> AuthResult:
    signed_in = await service.login_with_password(
        ctx, body.email, body.password, client, _meta(request, ctx)
    )
    return await _finish(ctx, response, tasks, signed_in, client)


@router.post("/password/reset", operation_id="authPasswordReset", response_model=AuthResult)
async def password_reset(
    body: PasswordResetIn,
    request: Request,
    response: Response,
    tasks: BackgroundTasks,
    ctx: AnonCtx,
    client: ClientParam = "web",
) -> AuthResult:
    signed_in = await service.reset_password(
        ctx, body.email, body.code, body.new_password, client, _meta(request, ctx)
    )
    return await _finish(ctx, response, tasks, signed_in, client)


@router.post("/google", operation_id="authGoogleLogin", response_model=AuthResult)
async def google_login(
    body: GoogleLoginIn,
    request: Request,
    response: Response,
    tasks: BackgroundTasks,
    ctx: AnonCtx,
    client: ClientParam = "web",
) -> AuthResult:
    claims = await ctx.state.auth_runtime.google.verify(body.id_token)
    signed_in = await service.login_with_google(ctx, claims, client, _meta(request, ctx))
    return await _finish(ctx, response, tasks, signed_in, client)


@router.post("/token/refresh", operation_id="authTokenRefresh", response_model=TokenPair)
async def token_refresh(body: RefreshIn, request: Request, ctx: AnonCtx) -> TokenPair:
    signed_in = await service.refresh_native(ctx, body.refresh_token, _meta(request, ctx))
    pair = service.token_pair(ctx, signed_in)
    await ctx.db.commit()
    return pair


@router.post("/logout", operation_id="authLogout", response_model=Done)
async def logout(response: Response, ctx: Annotated[Ctx, Depends(get_optional_ctx)]) -> Done:
    await service.logout(ctx)
    await ctx.db.commit()
    clear_session_cookies(response, ctx.settings)
    return Done()


account_router = APIRouter(prefix="/account", tags=["account"])

AVATAR_ID = r"^[A-Za-z0-9_-]+$"


@account_router.post(
    "/avatar",
    operation_id="accountAvatarUpload",
    response_model=UserOut,
    summary="Upload a profile picture (PNG, JPEG or WebP, up to 5 MB).",
)
async def avatar_upload(file: UploadFile, ctx: Annotated[Ctx, Depends(get_ctx)]) -> UserOut:
    raw = await file.read(avatar.MAX_UPLOAD_BYTES + 1)
    user = await service.upload_avatar(ctx, raw)
    await ctx.db.commit()
    await run_after_commit(ctx)
    return user


@account_router.get(
    "/avatars/{user_id}/{version}",
    operation_id="accountAvatarGet",
    response_class=StreamingResponse,
    responses={200: {"content": {"image/webp": {}}}},
)
async def avatar_get(
    user_id: Annotated[str, Path(pattern=AVATAR_ID)],
    version: Annotated[str, Path(pattern=AVATAR_ID)],
    request: Request,
) -> StreamingResponse:
    """Public: the URL embeds a random version, so it is unguessable and cacheable forever."""
    storage = request.app.state.storage
    key = f"users/{user_id}/avatar/{version}"
    if not await storage.exists(key):
        raise not_found()
    return StreamingResponse(
        storage.open(key),
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
        },
    )
