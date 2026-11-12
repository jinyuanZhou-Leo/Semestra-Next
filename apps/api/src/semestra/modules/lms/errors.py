"""The module's error codes (M09 §9). Providers raise only these."""

from typing import Any

from semestra.core.errors import AppError, agent_hints

STATUS = {
    "lms.provider_unknown": 422,
    "lms.invalid_config": 422,
    # Not 401: that status means "your Semestra session expired" to the frontend.
    "lms.invalid_credentials": 400,
    "lms.forbidden": 403,
    # The platform has no such item (any more), or the course has none (no front page). Not
    # `common.not_found`: that one says an id of this app is wrong.
    "lms.not_found": 404,
    # A whole area of the course (pages, files, quizzes...) is not open to the user: the
    # instructor hid it. Its items may still be reachable through the modules.
    "lms.area_hidden": 409,
    # An LMS ref (`<kind>:<id>`) the module can't read: malformed, or a kind with no body.
    "lms.invalid_ref": 422,
    # An address on the LMS that belongs to another course than the one read.
    "lms.other_course": 422,
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
    "lms.assessment_already_bound": 409,
    "lms.assessment_not_bound": 409,
    "lms.credentials_missing": 409,
    # The pending sync item was resolved meanwhile (another tab, the next sync), or the choice
    # does not fit it (keep/delete for a conflict).
    "lms.sync_nothing_to_resolve": 409,
    # The account setting `lms.allow_writes` is off: nothing is changed on the platform.
    "lms.writes_disabled": 409,
    "lms.file_too_large": 413,
    # Signing in on the platform's page (self-hosting): off on this server, not offered for the
    # address (Canvas does not know the school), a plain-http address (the exchange sends secrets),
    # or the pasted address carried no usable code.
    "lms.sign_in_disabled": 403,
    "lms.sign_in_unavailable": 422,
    "lms.sign_in_https_required": 422,
    "lms.sign_in_failed": 400,
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
        "lms.course_already_linked": "That LMS course is linked to another course here; the user "
        "unlinks that one in its course settings first.",
        "lms.feature_unsupported": "This platform or course does not offer that; tell the user.",
        "lms.writes_disabled": "Changing things on the LMS is off in the user's settings; tell "
        "them.",
        "lms.invalid_credentials": "The LMS token stopped working; the user reconnects in "
        "settings.",
        "lms.forbidden": "The LMS refuses this item to the user (locked, or not published yet); "
        "lms.course.outline shows why an item is locked. Tell the user rather than retrying.",
        "lms.not_found": "The LMS has no such item (deleted, or the ref is wrong; a course "
        "without a front page has none). Take refs from lms.course.outline or "
        "lms.content.search instead of building them.",
        "lms.area_hidden": "The instructor hid this area of the course (params.area) from "
        "students. Its items may still be in the modules: use lms.course.outline or "
        "lms.content.search, which only read what is open.",
        "lms.invalid_ref": "Pass a ref exactly as an lms tool returned it (`<kind>:<id>`, e.g. "
        "`page:week-1`), or the item's Canvas address as `url`. A module is not an item: its "
        "items are in lms.course.outline.",
        "lms.other_course": "That address is in another course on the LMS. If one of the user's "
        "courses is linked to it, read it there; otherwise give the user the link.",
        "lms.unreachable": "The LMS did not answer; try again later.",
        "lms.rate_limited": "The LMS is limiting requests; wait before trying again.",
        "lms.assignment_already_imported": "This assignment is already in the gradebook; update "
        "that assessment.",
        "lms.assessment_already_bound": "This assessment already follows an LMS assignment; "
        "unbind it first (lms.assignment.unbind) to bind another one.",
    }
)


def lms_error(code: str, **params: Any) -> AppError:
    return AppError(code, STATUS[code], **params)
