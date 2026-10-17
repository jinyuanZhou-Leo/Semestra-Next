import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not _EMAIL_RE.match(value):
        raise ValueError("invalid_email")
    return value


# Emails are case-insensitive: always compared and stored in lower case.
Email = Annotated[str, AfterValidator(_normalize_email)]
Code = Annotated[str, StringConstraints(pattern=r"^\d{6}$")]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Password = Annotated[str, StringConstraints(min_length=1, max_length=256)]

EmailPurpose = Literal["continue", "reset_password"]
TokenScope = Literal["read", "write"]


# --- output ---------------------------------------------------------------------------------


class IdentityOut(BaseModel):
    provider: Literal["google"]
    email: str
    created_at: datetime


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_url: str | None
    locale: str | None
    has_password: bool
    identities: list[IdentityOut]
    created_at: datetime


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105
    expires_in: int = Field(description="Access token lifetime in seconds")


class AuthResult(BaseModel):
    status: Literal["signed_in", "needs_profile"]
    user: UserOut | None = None
    registration_token: str | None = None
    # Present only for `?client=native`; web clients get cookies instead.
    tokens: TokenPair | None = None


class EmailStartResult(BaseModel):
    resend_in_seconds: int
    expires_in_seconds: int


class AuthConfig(BaseModel):
    google_client_id: str | None


class Done(BaseModel):
    ok: Literal[True] = True


# --- route input ----------------------------------------------------------------------------


class EmailStartIn(BaseModel):
    email: Email
    purpose: EmailPurpose = "continue"


class EmailVerifyIn(BaseModel):
    email: Email
    code: Code


class RegisterCompleteIn(BaseModel):
    registration_token: str = Field(max_length=200)
    display_name: DisplayName
    password: Password | None = None


class PasswordLoginIn(BaseModel):
    email: Email
    password: Password


class PasswordResetIn(BaseModel):
    email: Email
    code: Code
    new_password: Password


class GoogleLoginIn(BaseModel):
    id_token: str = Field(max_length=4096)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


# --- capability input / output --------------------------------------------------------------


class SessionOut(BaseModel):
    id: str
    kind: Literal["web", "native"]
    user_agent: str | None
    ip: str | None
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    current: bool


class SessionList(BaseModel):
    items: list[SessionOut]


class TokenOut(BaseModel):
    id: str
    name: str
    prefix: str
    scopes: list[TokenScope]
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None


class TokenCreated(TokenOut):
    token: str = Field(description="The plaintext token. Shown once, never stored.")


class TokenList(BaseModel):
    items: list[TokenOut]
