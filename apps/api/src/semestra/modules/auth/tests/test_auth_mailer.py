import json

import httpx
import pytest
from pydantic import ValidationError

from semestra.core.config import Settings
from semestra.core.i18n import RenderedEmail
from semestra.modules.auth.mailer import OutgoingEmail, ResendMailer


async def test_resend_request_matches_the_old_semestra_shape() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "re_msg_1"})

    mailer = ResendMailer(
        "re_key",
        "Semestra <no-reply@auth.example.com>",
        reply_to="support@example.com",
        transport=httpx.MockTransport(handler),
    )
    msg = OutgoingEmail(
        "ada@example.com",
        RenderedEmail("Your code", "123456", "<p>123456</p>"),
        idempotency_key="challenge-1",
        tags=(("category", "auth_verification"), ("purpose", "verification_code_continue")),
    )
    assert await mailer.send(msg) == "re_msg_1"

    (request,) = seen
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["authorization"] == "Bearer re_key"
    assert request.headers["idempotency-key"] == "challenge-1"
    body = json.loads(request.content)
    assert body["from"] == "Semestra <no-reply@auth.example.com>"
    assert body["to"] == ["ada@example.com"]
    assert body["reply_to"] == "support@example.com"
    assert body["tags"] == [
        {"name": "category", "value": "auth_verification"},
        {"name": "purpose", "value": "verification_code_continue"},
    ]


async def test_a_resend_error_is_raised_not_swallowed() -> None:
    mailer = ResendMailer(
        "re_key", "a@b.c", transport=httpx.MockTransport(lambda _: httpx.Response(422))
    )
    with pytest.raises(httpx.HTTPStatusError):
        await mailer.send(OutgoingEmail("x@y.z", RenderedEmail("s", "t", "<p>t</p>")))


def test_resend_backend_requires_the_key_and_sender() -> None:
    with pytest.raises(ValidationError, match="SEMESTRA_RESEND_API_KEY"):
        Settings(_env_file=None, email_backend="resend", resend_api_key="")  # pyright: ignore[reportCallIssue]
    ok = Settings(_env_file=None, email_backend="resend", resend_api_key="re_key")  # pyright: ignore[reportCallIssue]
    assert ok.resend_api_key == "re_key"
