"""LMS providers. The built-in ones register here, on import, so that the `{lms}` term (the
platforms the app connects to, "LMS (Canvas)") is known before any capability text uses it."""

from semestra.core.capability import register_term
from semestra.modules.lms.providers.base import (
    Io,
    LmsProvider,
    SignInProvider,
    all_providers,
    get_provider,
    register_lms_provider,
    sign_in_support,
    unregister_lms_provider,
)
from semestra.modules.lms.providers.canvas import CanvasProvider

register_lms_provider(CanvasProvider())


def _platforms() -> str:
    names = ", ".join(p.display_name for p in all_providers() if p.kind in BUILT_IN)
    return f"LMS ({names})" if names else "LMS"


BUILT_IN = frozenset(p.kind for p in all_providers())
register_term("lms", _platforms)

__all__ = [
    "BUILT_IN",
    "Io",
    "LmsProvider",
    "SignInProvider",
    "all_providers",
    "get_provider",
    "register_lms_provider",
    "sign_in_support",
    "unregister_lms_provider",
]
