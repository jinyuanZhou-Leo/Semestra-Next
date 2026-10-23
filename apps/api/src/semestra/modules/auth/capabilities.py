"""Account capabilities (M01 §5). Only `account.profile.get` is open to agents and MCP clients."""

from pydantic import BaseModel, Field

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.auth import service
from semestra.modules.auth.schemas import (
    Code,
    DisplayName,
    Email,
    EmailStartResult,
    Password,
    SessionList,
    TokenCreated,
    TokenList,
    TokenScope,
    UserOut,
)

HTTP_ONLY = ("http",)


def _meta(ctx: Ctx) -> service.RequestMeta:
    # Capabilities have no request object; the security-relevant IP is only needed for sign-in.
    return service.RequestMeta(ip=None, user_agent=None)


@capability(
    name="account.profile.get",
    summary="Get the signed-in user's account profile.",
    description="""Use when you need the user's name, email address or preferred language.
Do not use to read academic data; use the academics, grading or schedule capabilities.""",
    effect="read",
    http=Http("GET", "/account/me"),
    tags=("account",),
    agent_output_fields=("display_name", "email", "locale"),
)
async def me_get(ctx: Ctx, inp: NoInput) -> UserOut:
    assert ctx.user is not None
    return await service.user_out(ctx.db, ctx.user)


class ProfileUpdateInput(BaseModel):
    display_name: DisplayName | None = Field(default=None, description="New display name")
    avatar_url: str | None = Field(
        default=None,
        max_length=2048,
        pattern=r"^https://",
        description="HTTPS URL of the avatar image; send null to fall back to initials",
    )


@capability(
    name="account.profile.update",
    summary="Update the display name or avatar.",
    description="Change the signed-in user's profile. Not available to agents.",
    effect="write",
    http=Http("PATCH", "/account/profile"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def profile_update(ctx: Ctx, inp: ProfileUpdateInput) -> UserOut:
    return await service.update_profile(
        ctx, inp.display_name, inp.avatar_url, set_avatar="avatar_url" in inp.model_fields_set
    )


class PasswordChangeInput(BaseModel):
    current_password: Password | None = Field(
        default=None, description="Current password; omit when the account has none yet"
    )
    new_password: Password = Field(description="The new password")


@capability(
    name="account.password.change",
    summary="Change or set the account password.",
    description="Change the password (or set the first one). Signs out all other sessions.",
    effect="write",
    http=Http("POST", "/account/password/change"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def password_change(ctx: Ctx, inp: PasswordChangeInput) -> UserOut:
    return await service.change_password(ctx, inp.current_password, inp.new_password)


REAUTH_PASSWORD = Field(
    default=None,
    description="Current password; needed unless the session signed in during the last 10 minutes",
)


class EmailChangeStartInput(BaseModel):
    new_email: Email = Field(description="The new email address; a code is sent to it")
    password: Password | None = REAUTH_PASSWORD


@capability(
    name="account.email.change_start",
    summary="Start changing the account email.",
    description="Sends a verification code to the new address. Not available to agents.",
    effect="write",
    http=Http("POST", "/account/email/change-start"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def email_change_start(ctx: Ctx, inp: EmailChangeStartInput) -> EmailStartResult:
    return await service.change_email_start(ctx, inp.new_email, _meta(ctx), inp.password)


class EmailChangeConfirmInput(BaseModel):
    code: Code = Field(description="The 6-digit code sent to the new address")


@capability(
    name="account.email.change_confirm",
    summary="Confirm the new account email with its code.",
    description="Finishes an email change started with account.email.change_start.",
    effect="write",
    http=Http("POST", "/account/email/change-confirm"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def email_change_confirm(ctx: Ctx, inp: EmailChangeConfirmInput) -> UserOut:
    return await service.change_email_confirm(ctx, inp.code)


class GoogleLinkInput(BaseModel):
    id_token: str = Field(max_length=4096, description="Google Identity Services ID token")


@capability(
    name="account.google.link",
    summary="Link a Google account to the signed-in user.",
    description="Links the Google account behind the given ID token. Not available to agents.",
    effect="write",
    http=Http("POST", "/account/google/link"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def google_link(ctx: Ctx, inp: GoogleLinkInput) -> UserOut:
    claims = await ctx.state.auth_runtime.google.verify(inp.id_token)
    return await service.link_google(ctx, claims)


@capability(
    name="account.google.unlink",
    summary="Unlink Google from the signed-in user.",
    description="Removes the Google sign-in. Email code sign-in always remains available.",
    effect="destructive",
    http=Http("POST", "/account/google/unlink"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def google_unlink(ctx: Ctx, inp: NoInput) -> UserOut:
    return await service.unlink_google(ctx)


@capability(
    name="account.session.list",
    summary="List the signed-in devices.",
    description="Lists active sessions of the signed-in user. Not available to agents.",
    effect="read",
    http=Http("GET", "/account/sessions"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def sessions_list(ctx: Ctx, inp: NoInput) -> SessionList:
    return SessionList(items=await service.list_sessions(ctx))


class SessionRevokeInput(BaseModel):
    session_id: str = Field(description="Id of the session to sign out")


class Revoked(BaseModel):
    ok: bool = True


@capability(
    name="account.session.revoke",
    summary="Sign out one device.",
    description="Revokes a session. Revoking the current session signs this browser out.",
    effect="destructive",
    http=Http("DELETE", "/account/sessions/{session_id}"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def sessions_revoke(ctx: Ctx, inp: SessionRevokeInput) -> Revoked:
    await service.revoke_session(ctx, inp.session_id)
    return Revoked()


@capability(
    name="account.session.revoke_others",
    summary="Sign out all other devices.",
    description="Revokes every session except the current one.",
    effect="destructive",
    http=Http("POST", "/account/sessions/revoke-others"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def sessions_revoke_others(ctx: Ctx, inp: NoInput) -> Revoked:
    await service.revoke_other_sessions(ctx)
    return Revoked()


@capability(
    name="account.token.list",
    summary="List personal access tokens.",
    description="Lists the user's non-revoked personal access tokens (never the secrets).",
    effect="read",
    http=Http("GET", "/account/tokens"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def tokens_list(ctx: Ctx, inp: NoInput) -> TokenList:
    return TokenList(items=await service.list_tokens(ctx))


class TokenCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=60, description="A label, e.g. the client name")
    scopes: list[TokenScope] = Field(
        default_factory=lambda: ["read"],
        min_length=1,
        description="`read` allows read capabilities only; `write` also allows changes",
    )
    expires_in_days: int | None = Field(
        default=None, ge=1, le=3650, description="Lifetime in days; omit for no expiry"
    )
    password: Password | None = REAUTH_PASSWORD


@capability(
    name="account.token.create",
    summary="Create a personal access token for an MCP client.",
    description="Creates a token. The plaintext is returned once and cannot be retrieved again.",
    effect="write",
    http=Http("POST", "/account/tokens"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def tokens_create(ctx: Ctx, inp: TokenCreateInput) -> TokenCreated:
    return await service.create_token(
        ctx, inp.name.strip(), inp.scopes, inp.expires_in_days, inp.password
    )


class TokenRevokeInput(BaseModel):
    id: str = Field(description="Id of the token to revoke")


@capability(
    name="account.token.revoke",
    summary="Revoke a personal access token.",
    description="Revokes the token immediately.",
    effect="destructive",
    http=Http("DELETE", "/account/tokens/{id}"),
    expose=HTTP_ONLY,
    tags=("account",),
)
async def tokens_revoke(ctx: Ctx, inp: TokenRevokeInput) -> Revoked:
    await service.revoke_token(ctx, inp.id)
    return Revoked()
