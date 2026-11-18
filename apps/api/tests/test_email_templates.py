"""Every email template renders in every locale, with the code and links intact."""

import re
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
    "device": "Firefox",
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
    for url in re.findall(r"https://\S+", email.text):
        assert f'href="{url}"' in email.html
