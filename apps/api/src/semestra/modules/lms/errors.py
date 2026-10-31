"""The module's error codes (M09 §9). Providers raise only these (and `common.not_found`)."""

from typing import Any

from semestra.core.errors import AppError, agent_hints

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
    "lms.course_link_exists": 409,
    "lms.assignment_already_imported": 409,
    "lms.credentials_missing": 409,
    # The account setting `lms.allow_writes` is off: nothing is changed on the platform.
    "lms.writes_disabled": 409,
    "lms.file_too_large": 413,
}

# Errors that say the connection itself is broken (they mark it `error`). `lms.invalid_config`
# from a saved connection means the address stopped being a Canvas API (it redirects, or the
# profile is gone).
CONNECTION_ERRORS = frozenset(
    (
        "lms.invalid_credentials",
        "lms.invalid_config",
        "lms.forbidden",
        "lms.blocked_address",
        "lms.credentials_missing",
    )
)
# A read that fails with these marks the connection broken. `lms.forbidden` is left out: on a
# read it means one resource is off limits (a course without Pages, a locked file), while a
# connection check (`validate`, the periodic refresh) reads the user's own profile, where a
# refusal does mean the token can't be used.
BROKEN_ON_READ = CONNECTION_ERRORS - {"lms.forbidden"}

agent_hints(
    {
        "lms.program_not_configured": "This Program has no LMS connection yet; the user sets it "
        "up in settings.",
        "lms.course_not_linked": "The course is not linked to an LMS course; link it with "
        "lms.course.link.set.",
        "lms.course_link_exists": "The course is already linked; pass replace=true to change the "
        "link.",
        "lms.course_already_linked": "That LMS course is linked to another course here; unlink "
        "that one first.",
        "lms.feature_unsupported": "This platform or course does not offer that; tell the user.",
        "lms.writes_disabled": "Changing things on the LMS is off in the user's settings; tell "
        "them.",
        "lms.invalid_credentials": "The LMS token stopped working; the user reconnects in "
        "settings.",
        "lms.forbidden": "The LMS refuses access to this resource (locked or hidden by the "
        "instructor).",
        "lms.unreachable": "The LMS did not answer; try again later.",
        "lms.rate_limited": "The LMS is limiting requests; wait before trying again.",
        "lms.assignment_already_imported": "This assignment is already in the gradebook; update "
        "that assessment.",
    }
)


def lms_error(code: str, **params: Any) -> AppError:
    return AppError(code, STATUS[code], **params)
