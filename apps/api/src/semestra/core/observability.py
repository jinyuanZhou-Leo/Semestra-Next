"""Optional Sentry error tracking. Disabled when `SEMESTRA_SENTRY_DSN` is empty."""

from typing import Any

from semestra.core.config import Settings

_REQUEST_FIELDS_TO_DROP = ("data", "cookies", "headers", "query_string", "env")


def _scrub(event: Any, hint: Any) -> Any:
    """Never ship request bodies, cookies, headers or user identity: only the error and stack."""
    request: Any = event.get("request")
    if isinstance(request, dict):
        for field in _REQUEST_FIELDS_TO_DROP:
            request.pop(field, None)  # pyright: ignore[reportUnknownMemberType]
    event.pop("user", None)
    return event


def init_sentry(settings: Settings) -> bool:
    if not settings.sentry_dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=0,
        before_send=_scrub,
    )
    return True
