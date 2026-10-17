"""M01 认证与账户: sign-in, sessions, tokens and account management."""

from fastapi import FastAPI

from semestra.modules.auth import capabilities, models  # noqa: F401  (registers on import)
from semestra.modules.auth.google import HttpGoogleVerifier
from semestra.modules.auth.identity import authenticate
from semestra.modules.auth.mailer import build_mailer
from semestra.modules.auth.routes import router
from semestra.modules.auth.service import AuthRuntime


def register(app: FastAPI) -> None:
    settings = app.state.settings
    app.state.authenticator = authenticate
    app.state.auth_runtime = AuthRuntime(
        mailer=build_mailer(settings), google=HttpGoogleVerifier(settings)
    )
    app.include_router(router)
