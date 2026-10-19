"""The module's error codes (M09 §9). Providers raise only these (and `common.not_found`)."""

from typing import Any

from semestra.core.errors import AppError

STATUS = {
    "lms.provider_unknown": 422,
    "lms.invalid_config": 422,
    # Not 401: that status means "your Semestra session expired" to the frontend.
    "lms.invalid_credentials": 400,
    "lms.forbidden": 403,
    "lms.unreachable": 502,
    "lms.rate_limited": 429,
    "lms.blocked_address": 400,
    "lms.feature_unsupported": 409,
    "lms.program_not_configured": 409,
    "lms.program_has_links": 409,
    "lms.connection_in_use": 409,
    "lms.course_not_linked": 409,
    "lms.course_already_linked": 409,
    "lms.credentials_missing": 409,
}

# Errors that say the connection itself is broken (they mark it `error`).
CONNECTION_ERRORS = frozenset(
    ("lms.invalid_credentials", "lms.forbidden", "lms.blocked_address", "lms.credentials_missing")
)


def lms_error(code: str, **params: Any) -> AppError:
    return AppError(code, STATUS[code], **params)
