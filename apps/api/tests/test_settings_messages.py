"""Every registered settings field has its texts in both languages (M11 §5.1).

The settings form is generated from the namespace schema; the labels come from the web app's
messages (`settings_<namespace>_<field>_label|_description|_option_<value>`, dots and dashes in
the namespace become underscores). A gap would show the raw field name to the user.
"""

import json
import re
import typing
from pathlib import Path

import pytest

import semestra.modules._template  # noqa: F401  (registers the plugin.template namespace)
from semestra.modules.settings.registry import SettingsDef, settings_registry

MESSAGES = Path(__file__).resolve().parents[2] / "web" / "messages"
LOCALES = ("en", "zh-CN")


def _part(value: object) -> str:
    return re.sub(r"[.-]", "_", str(value))


def _shipped() -> list[SettingsDef]:
    # Namespaces declared by test files (settings/tests/conftest.py) are not part of the product.
    return [
        d
        for d in settings_registry.list()
        if d.schema.__module__.startswith("semestra.modules.")
        and ".tests" not in d.schema.__module__
    ]


def _expected_keys(definition: SettingsDef) -> set[str]:
    prefix = f"settings_{_part(definition.namespace)}"
    keys: set[str] = set()
    for name, field in definition.schema.model_fields.items():
        keys.add(f"{prefix}_{name}_label")
        if field.description:
            keys.add(f"{prefix}_{name}_description")
        annotation = field.annotation
        if typing.get_origin(annotation) is typing.Literal:
            keys.update(f"{prefix}_{name}_option_{_part(v)}" for v in typing.get_args(annotation))
    return keys


def test_there_is_a_shipped_namespace_to_check() -> None:
    assert any(d.namespace == "plugin.template" for d in _shipped())


@pytest.mark.parametrize("locale", LOCALES)
def test_every_settings_field_has_messages(locale: str) -> None:
    messages = json.loads((MESSAGES / f"{locale}.json").read_text(encoding="utf-8"))
    missing = sorted(key for d in _shipped() for key in _expected_keys(d) if key not in messages)
    assert not missing, f"missing in {locale}.json: {missing}"
