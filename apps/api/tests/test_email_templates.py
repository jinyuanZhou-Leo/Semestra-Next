"""Every email template renders in every locale, with the code and links intact."""

from pathlib import Path

import pytest

from semestra.core.context import SUPPORTED_LOCALES
from semestra.core.i18n import render_email

MODULES = Path(__file__).resolve().parents[1] / "src" / "semestra" / "modules"
NAMES = sorted({p.stem for p in MODULES.glob("*/templates/*/*.txt")})
PARAMS = {
    "code": "482913",
    "minutes": 10,
    "email": "a@example.com",
    "new_email": "b@example.com",
    "name": "Alex",
    "time": "2026-11-18 15:00",
    "device": "Evil https://phish.example/x <b>",
    "ip": "203.0.113.1",
    "login_url": "https://example.com/login",
    "reset_url": "https://example.com/login/reset",
    "settings_url": "https://example.com/?settings=account/account",
}


def test_every_template_exists_in_every_locale() -> None:
    for locale in SUPPORTED_LOCALES:
        present = {p.stem for p in MODULES.glob(f"*/templates/{locale}/*.txt")}
        assert present == set(NAMES), locale


@pytest.mark.parametrize("locale", SUPPORTED_LOCALES)
@pytest.mark.parametrize("name", NAMES)
def test_template_renders(name: str, locale: str) -> None:
    email = render_email(name, locale, PARAMS, web_origin="https://example.com")
    assert "$" not in email.subject + email.text + email.html
    assert '<html lang="' + locale + '"' in email.html
    if "482913" in email.text:  # copied as one string, not split into digits
        assert ">482913</div>" in email.html
    source = next(MODULES.glob(f"*/templates/{locale}/{name}.txt")).read_text()
    for key, url in PARAMS.items():
        if key.endswith("_url") and f"${key}" in source:
            assert f'href="{url}"' in email.html


def test_only_url_placeholders_become_links() -> None:
    email = render_email("new_sign_in", "zh-CN", PARAMS, web_origin="https://example.com")
    assert 'href="https://phish.example' not in email.html
    assert "&lt;b&gt;" in email.html
    # Text right after a link (the full stop, a line break) stays outside it.
    assert "account/account</a> 修改密码" in email.html


def test_logo_only_over_https() -> None:
    args = ("verification_code_continue", "en", PARAMS)
    assert "<img" in render_email(*args, web_origin="https://example.com").html
    assert "<img" not in render_email(*args, web_origin="http://localhost:5173").html
