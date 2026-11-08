"""Notification texts (M18 §6). Like emails (M00 §3.11), pushes are rendered here, in the user's
language: the service worker shows what it receives, so the text cannot wait for the app.

`texts/<locale>.json` holds `{kind: {title, body}}` with `$name` placeholders plus the `words`
used to build them; both locales must have the same keys (tested)."""

import json
import re
from datetime import datetime
from functools import cache
from pathlib import Path
from string import Template
from typing import Any

from semestra.core.context import DEFAULT_LOCALE, SUPPORTED_LOCALES

_DIR = Path(__file__).resolve().parent / "texts"


@cache
def catalog(locale: str) -> dict[str, Any]:
    if locale not in SUPPORTED_LOCALES:
        locale = DEFAULT_LOCALE
    return json.loads((_DIR / f"{locale}.json").read_text(encoding="utf-8"))


def word(locale: str, key: str, **params: object) -> str:
    return Template(catalog(locale)["words"][key]).safe_substitute(params)


def count(locale: str, key: str, n: int) -> str:
    return word(locale, f"{key}_{'one' if n == 1 else 'other'}", n=n)


def lead(locale: str, minutes: int) -> str:
    """`90` → "1 hour 30 minutes" is never needed: leads are whole minutes, hours or days."""
    if minutes % 1440 == 0:
        return count(locale, "day", minutes // 1440)
    if minutes % 60 == 0:
        return count(locale, "hour", minutes // 60)
    return count(locale, "minute", minutes)


def clock(value: datetime, locale: str, time_format: str) -> str:
    """`time_format` is the account preference: `12`, `24` or `auto` (24 h in Chinese)."""
    twelve = time_format == "12" or (time_format == "auto" and locale == "en")
    if twelve:
        hour = value.hour % 12 or 12
        return f"{hour}:{value.minute:02d} {'AM' if value.hour < 12 else 'PM'}"
    return f"{value.hour}:{value.minute:02d}"


def details(locale: str, *parts: str | None) -> str:
    return word(locale, "separator").join(p for p in parts if p)


def device_label(user_agent: str | None) -> str | None:
    """ "Chrome · macOS", like the sessions list in the app (`lib/device.ts`)."""
    if not user_agent:
        return None
    ua = user_agent
    browser = next(
        (
            name
            for pattern, name in (
                (r"Edg/", "Edge"),
                (r"OPR/", "Opera"),
                (r"Firefox/", "Firefox"),
                (r"Chrome/", "Chrome"),
                (r"Safari/", "Safari"),
            )
            if re.search(pattern, ua)
        ),
        None,
    )
    system = next(
        (
            name
            for pattern, name in (
                (r"Windows", "Windows"),
                (r"iPhone|iPad|iPod", "iOS"),
                (r"Android", "Android"),
                (r"Mac OS X|Macintosh", "macOS"),
                (r"Linux", "Linux"),
            )
            if re.search(pattern, ua)
        ),
        None,
    )
    if browser and system:
        return f"{browser} · {system}"
    return browser or system or ua[:40]


def render(kind: str, locale: str, **params: object) -> tuple[str, str]:
    entry = catalog(locale)[kind]
    values = {k: str(v) for k, v in params.items()}
    return (
        Template(entry["title"]).safe_substitute(values),
        Template(entry["body"]).safe_substitute(values),
    )
